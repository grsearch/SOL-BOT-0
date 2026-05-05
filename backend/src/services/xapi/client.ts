import axios, { AxiosInstance } from 'axios';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { xUsageRepo } from '../../db/repo.js';

const X_BASE = 'https://api.x.com/2';

// 通用词/常见票据/法币缩写 - cashtag 容易匹配到大量无关推文
const CASHTAG_BLACKLIST = new Set([
  'AI', 'ETH', 'BTC', 'SOL', 'USD', 'USDT', 'USDC', 'EUR', 'JPY', 'CNY', 'GBP',
  'AAPL', 'TSLA', 'NVDA', 'MSFT', 'AMZN', 'META', 'GOOG', 'GOOGL',
  'SPY', 'QQQ', 'GLD', 'SLV', 'TQQQ',
]);

export interface XHeatStats {
  mentions60m: number;
  avgEngagement: number;
  heatScore: number;
  newReadsCharged: number;   // 本次实际计费的 read 数
}

class XApiClient {
  private http: AxiosInstance | null = null;

  private get client(): AxiosInstance | null {
    if (!config.X_BEARER_TOKEN) return null;
    if (!this.http) {
      this.http = axios.create({
        baseURL: X_BASE,
        timeout: 15_000,
        headers: { Authorization: `Bearer ${config.X_BEARER_TOKEN}` },
      });
    }
    return this.http;
  }

  /** 是否可用（配置了 token 且预算未超） */
  available(): { ok: boolean; reason?: string } {
    if (!this.client) return { ok: false, reason: 'X_BEARER_TOKEN 未配置' };
    const usage = xUsageRepo.todayUsage();
    if (config.X_DAILY_BUDGET_USD > 0 && usage.cost_usd >= config.X_DAILY_BUDGET_USD) {
      return { ok: false, reason: `今日预算 $${config.X_DAILY_BUDGET_USD} 已用完` };
    }
    return { ok: true };
  }

  /**
   * 查询某个 ticker 的近 60 分钟热度
   *
   * 实现：用 recent search 查 $TICKER 出现的 tweets（cashtag 必须）
   * 计费策略：去掉 24h 内已计费过的 post_id（本地缓存）后才计入扣费
   */
  async getHeat(ticker: string, tokenAddress: string): Promise<XHeatStats | null> {
    const av = this.available();
    if (!av.ok) {
      logger.debug({ reason: av.reason, ticker }, 'X API 不可用');
      return null;
    }
    // ★ BUG #8 修：太短或太通用的 ticker 会拉到无关推文，跳过
    const upper = ticker.toUpperCase();
    if (upper.length < 3 || CASHTAG_BLACKLIST.has(upper)) {
      logger.debug({ ticker }, 'cashtag 太短或在黑名单中，跳过 X 查询');
      return null;
    }
    const c = this.client!;
    const query = `$${ticker} -is:retweet lang:en`;
    const startTime = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    try {
      const r = await c.get('/tweets/search/recent', {
        params: {
          query,
          'tweet.fields': 'public_metrics,author_id,created_at',
          start_time: startTime,
          max_results: 100,
        },
      });
      const data: any[] = r.data?.data ?? [];

      // ★ BUG #21 修：X 按 search 返回的总条数计费（实际请求量），与本地缓存无关
      // 24h 去重缓存只用于"统计上"避免把同一帖反复计入热度，不影响计费。
      if (data.length > 0) {
        xUsageRepo.addReads(data.length, config.X_COST_PER_READ_USD);
      }

      let mentions = 0;
      let totalEngagement = 0;
      for (const tw of data) {
        const id = tw.id as string;
        if (xUsageRepo.isPostCached(id, 24)) continue;     // 仅跳过统计，但 X 已计费
        xUsageRepo.cachePost(id, tokenAddress);
        mentions++;
        const m = tw.public_metrics ?? {};
        totalEngagement += (m.like_count ?? 0) + (m.retweet_count ?? 0) + (m.reply_count ?? 0);
      }
      const avgEng = mentions > 0 ? totalEngagement / mentions : 0;
      const heatScore = mentions * (1 + avgEng / 100);
      return { mentions60m: mentions, avgEngagement: avgEng, heatScore, newReadsCharged: data.length };
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 429) {
        logger.warn({ ticker }, 'X API 限流');
      } else {
        logger.warn({ err: e?.response?.data ?? e?.message, ticker }, 'X getHeat 失败');
      }
      return null;
    }
  }
}

export const xApi = new XApiClient();
