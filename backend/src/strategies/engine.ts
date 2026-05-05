import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { priceStream, type PriceTick } from '../services/birdeye/wsPrice.js';
import { tokenRepo, positionRepo, alertRepo } from '../db/repo.js';
import { sendDropAlert, sendInfo } from '../services/discord/client.js';
import { sellToken } from '../services/jupiter/executor.js';
import { refreshTokenMetadata } from './metadata.js';
import { xApi } from '../services/xapi/client.js';
import type { Token } from '../types/index.js';

class StrategyEngine {
  private monitorTimer: NodeJS.Timeout | null = null;
  private xRefreshTimer: NodeJS.Timeout | null = null;
  private pricePruneTimer: NodeJS.Timeout | null = null;
  private metadataTimer: NodeJS.Timeout | null = null;
  private isProcessingPrice = new Set<string>();   // 简单互斥，避免同时触发多次卖出

  start(): void {
    // 1. 启动价格 WebSocket
    priceStream.on('price', (tick) => this.onPriceTick(tick));
    priceStream.on('open', () => {
      // 重新订阅活跃代币
      const active = tokenRepo.listActive();
      for (const t of active) priceStream.subscribe(t.address);
      logger.info({ count: active.length }, '已重新订阅价格');
    });
    priceStream.start();

    // 2. 订阅当前所有活跃代币
    for (const t of tokenRepo.listActive()) {
      priceStream.subscribe(t.address);
    }

    // 3. 定期巡检 FDV/LP 阈值（5 分钟）
    this.monitorTimer = setInterval(() => this.runMonitorCheck().catch(e => logger.error({ err: e }, '巡检失败')), config.MONITOR_CHECK_INTERVAL_MS);

    // 4. 定期刷新 X 热度（默认 15 分钟，预算紧张时降级到 60 分钟）
    this.scheduleXRefresh();

    // 5. 元数据全量刷新（10 分钟刷一次 FDV/LP/holders）
    this.metadataTimer = setInterval(() => this.runMetadataRefresh().catch(e => logger.error({ err: e }, '元数据刷新失败')), 10 * 60 * 1000);

    // 6. 价格历史清理（每天清一次 7 天前的）
    this.pricePruneTimer = setInterval(() => {
      const removed = tokenRepo.pruneOldPriceHistory(7);
      logger.info({ removed }, '清理旧价格历史');
    }, 24 * 60 * 60 * 1000);

    // 启动后立刻跑一次元数据刷新和 X 刷新
    setTimeout(() => this.runMetadataRefresh().catch(() => {}), 5_000);
    setTimeout(() => this.runXRefresh().catch(() => {}), 10_000);

    logger.info('策略引擎已启动');
  }

  stop(): void {
    priceStream.stop();
    if (this.monitorTimer) clearInterval(this.monitorTimer);
    if (this.xRefreshTimer) clearTimeout(this.xRefreshTimer);
    if (this.metadataTimer) clearInterval(this.metadataTimer);
    if (this.pricePruneTimer) clearInterval(this.pricePruneTimer);
  }

  /** 手动添加监控时调用 */
  subscribeToken(address: string): void {
    priceStream.subscribe(address);
  }

  /** 移除监控 */
  unsubscribeToken(address: string): void {
    priceStream.unsubscribe(address);
  }

  // ============== 核心：价格 tick 处理 ==============
  private async onPriceTick(tick: PriceTick): Promise<void> {
    const t0 = tokenRepo.get(tick.address);
    if (!t0 || t0.monitor_active === 0) return;

    // 更新价格 + 24h 高点
    tokenRepo.updatePrice(tick.address, tick.priceUsd, null, tick.ts);

    // 互斥保护
    if (this.isProcessingPrice.has(tick.address)) return;
    this.isProcessingPrice.add(tick.address);
    try {
      // ★ BUG #14 修：updatePrice 之后重新读，拿到刷新后的 high_24h
      const t = tokenRepo.get(tick.address);
      if (!t || t.monitor_active === 0) return;
      await this.evaluateStopLossAlert(t, tick.priceUsd);
      await this.evaluateTakeProfit(t, tick.priceUsd);
    } catch (e: any) {
      logger.error({ err: e?.message, addr: tick.address }, '价格策略处理失败');
    } finally {
      this.isProcessingPrice.delete(tick.address);
    }
  }

  /** 跌幅报警：从 24h 高点回落 >= 阈值 */
  private async evaluateStopLossAlert(t: Token, currentPrice: number): Promise<void> {
    if (!t.high_24h || t.high_24h <= 0) return;
    const dropPct = ((t.high_24h - currentPrice) / t.high_24h) * 100;
    if (dropPct < config.STOP_LOSS_DROP_PCT) return;

    // 冷却：上次报警 < 2 小时则跳过
    const cooldownMs = config.STOP_LOSS_COOLDOWN_HOURS * 3600 * 1000;
    if (t.last_alert_at && Date.now() - t.last_alert_at < cooldownMs) return;

    // 重新拉一份完整 token（带最新元数据）
    const fresh = tokenRepo.get(t.address)!;
    const ok = await sendDropAlert(fresh, currentPrice, dropPct);
    alertRepo.insert(t.address, 'drop_50pct', { currentPrice, dropPct, high24h: t.high_24h }, ok);
    if (ok) {
      tokenRepo.setLastAlertAt(t.address, Date.now());
      logger.warn({ token: t.symbol, drop: dropPct.toFixed(1) + '%' }, '已发送跌幅报警');
    }
  }

  /** 止盈：当前价 >= 买入均价 * (1 + TAKE_PROFIT_GAIN_PCT/100) */
  private async evaluateTakeProfit(t: Token, currentPrice: number): Promise<void> {
    const pos = positionRepo.getOpenByToken(t.address);
    if (!pos || pos.is_open === 0 || pos.auto_take_profit_active === 0) return;
    if (!pos.avg_entry_price_usd || pos.avg_entry_price_usd <= 0) return;

    const target = pos.avg_entry_price_usd * (1 + config.TAKE_PROFIT_GAIN_PCT / 100);
    if (currentPrice < target) return;

    logger.info({ token: t.symbol, entry: pos.avg_entry_price_usd, current: currentPrice, target }, '触发自动止盈');
    try {
      // 先停掉自动止盈以免重复触发
      positionRepo.setAutoTakeProfit(pos.id, false);
      const r = await sellToken({
        tokenAddress: t.address,
        trigger: 'auto_take_profit',
      });
      alertRepo.insert(t.address, 'take_profit', { entry: pos.avg_entry_price_usd, exit: currentPrice, sig: r.signature });
      await sendInfo(`✅ 自动止盈：${t.symbol ?? t.address.slice(0, 8)}`,
        `买入价 $${pos.avg_entry_price_usd.toFixed(6)}\n卖出价 $${currentPrice.toFixed(6)}\n收回 ${r.solReceived.toFixed(4)} SOL\n[tx](https://solscan.io/tx/${r.signature})`);
    } catch (e: any) {
      logger.error({ err: e.message, addr: t.address }, '自动止盈卖出失败');
      // 卖失败了重新打开止盈，下一次 tick 还会再尝试
      positionRepo.setAutoTakeProfit(pos.id, true);
    }
  }

  // ============== 巡检：FDV/LP 阈值 ==============
  // sell 失败的 token 退避，避免每 5 分钟反复重试
  private autoRemoveBackoff = new Map<string, number>();   // address -> 下一次允许尝试的时间戳
  private static readonly AUTO_REMOVE_BACKOFF_MS = 10 * 60 * 1000;

  private async runMonitorCheck(): Promise<void> {
    const tokens = tokenRepo.listActive();
    const now = Date.now();
    for (const t of tokens) {
      // ★ BUG #7 修：fdv/lp 为 null 或 0 都视为"暂未知"不触发移除（新发币早期常见）
      const fdv = t.fdv_usd;
      const lp = t.lp_usd;
      const fdvOk = fdv == null || fdv === 0 || fdv >= config.FDV_MIN_USD;
      const lpOk = lp == null || lp === 0 || lp >= config.LP_MIN_USD;
      if (fdvOk && lpOk) continue;

      // ★ BUG #9 修：退避，避免 sell 失败的 token 每 5 分钟反复重试
      const backoffUntil = this.autoRemoveBackoff.get(t.address) ?? 0;
      if (now < backoffUntil) continue;

      logger.warn({ token: t.symbol, fdv: t.fdv_usd, lp: t.lp_usd }, '触发自动移除');

      // 先看有没有持仓
      const pos = positionRepo.getOpenByToken(t.address);
      if (pos && pos.amount_ui > 0) {
        try {
          const r = await sellToken({ tokenAddress: t.address, trigger: 'auto_remove_sell' });
          await sendInfo(`🔻 自动移除前已卖出：${t.symbol ?? t.address.slice(0, 8)}`,
            `原因: FDV=${t.fdv_usd ?? 'N/A'} LP=${t.lp_usd ?? 'N/A'}\n收回 ${r.solReceived.toFixed(4)} SOL\n[tx](https://solscan.io/tx/${r.signature})`);
        } catch (e: any) {
          logger.error({ err: e.message, token: t.symbol }, '自动移除前卖出失败，暂不移除');
          this.autoRemoveBackoff.set(t.address, now + StrategyEngine.AUTO_REMOVE_BACKOFF_MS);
          continue;  // 卖失败就先不移除，下次重试
        }
      }

      tokenRepo.setActive(t.address, false);
      this.unsubscribeToken(t.address);
      this.autoRemoveBackoff.delete(t.address);
      alertRepo.insert(t.address, 'auto_remove', { reason: 'fdv_or_lp_low', fdv: t.fdv_usd, lp: t.lp_usd });
      await sendInfo(`📤 已退出监控：${t.symbol ?? t.address.slice(0, 8)}`,
        `FDV=${t.fdv_usd ?? 'N/A'}, LP=${t.lp_usd ?? 'N/A'}`);
    }
  }

  // ============== 元数据刷新 ==============
  private async runMetadataRefresh(): Promise<void> {
    const tokens = tokenRepo.listActive();
    for (const t of tokens) {
      try {
        await refreshTokenMetadata(t.address);
      } catch (e: any) {
        logger.warn({ err: e.message, addr: t.address }, '元数据刷新单币失败');
      }
    }
  }

  // ============== X 热度刷新 ==============
  private scheduleXRefresh(): void {
    const av = xApi.available();
    const interval = av.ok ? config.X_REFRESH_INTERVAL_MS : config.X_FALLBACK_INTERVAL_MS;
    this.xRefreshTimer = setTimeout(async () => {
      try { await this.runXRefresh(); } catch (e: any) { logger.warn({ err: e.message }, 'X 刷新失败'); }
      this.scheduleXRefresh();    // 滚动调度
    }, interval);
  }

  private async runXRefresh(): Promise<void> {
    if (!xApi.available().ok) return;
    const tokens = tokenRepo.listActive();
    // 限制最多 10 个币
    const targets = tokens.slice(0, 10);
    for (const t of targets) {
      const sym = t.symbol;
      if (!sym || sym.length < 2) continue;
      const stats = await xApi.getHeat(sym, t.address);
      if (!stats) continue;
      tokenRepo.upsert({
        address: t.address,
        x_mentions_60m: stats.mentions60m,
        x_engagement_avg: stats.avgEngagement,
        x_heat_score: stats.heatScore,
        x_last_query_at: Date.now(),
      });
    }
  }
}

export const strategyEngine = new StrategyEngine();
