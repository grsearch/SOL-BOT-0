import { tokenRepo } from '../db/repo.js';
import { birdeye } from '../services/birdeye/client.js';
import { helius } from '../services/helius/client.js';
import { logger } from '../utils/logger.js';

const HOLDERS_REFRESH_INTERVAL_MS = 30 * 60 * 1000;  // holders 比较慢，30 分钟刷一次

/**
 * 刷新单个代币的链上元数据：FDV、LP、价格、24h vol、holders、age
 * - FDV/LP/价格/vol：Birdeye token_overview
 * - age：Birdeye token_creation_info（一次性，结果缓存到 created_at_unix）
 * - holders：Helius getTokenAccounts（慢，间隔刷新）
 */
export async function refreshTokenMetadata(address: string): Promise<void> {
  const t = tokenRepo.get(address);
  if (!t) return;

  // 1. Birdeye overview
  const ov = await birdeye.getTokenOverview(address);
  if (ov) {
    tokenRepo.upsert({
      address,
      symbol: ov.symbol ?? t.symbol,
      name: ov.name ?? t.name,
      decimals: ov.decimals ?? t.decimals,
      fdv_usd: ov.fdv ?? null,
      lp_usd: ov.liquidity ?? null,
      volume_24h_usd: ov.v24hUSD ?? null,
      holders: ov.holder ?? t.holders,    // Birdeye 也返回 holder，优先用它
      price_usd: ov.price ?? t.price_usd,
    });
  }

  // 2. age（用代币创建时间算）
  if (!t.created_at_unix) {
    const ci = await birdeye.getTokenCreationInfo(address);
    if (ci) {
      const ageSec = Math.floor(Date.now() / 1000) - ci.createdAtUnix;
      tokenRepo.upsert({ address, created_at_unix: ci.createdAtUnix, age_seconds: ageSec });
    }
  } else {
    // 持续更新 age（创建时间是固定的，age 由现在时间减去）
    tokenRepo.upsert({ address, age_seconds: Math.floor(Date.now() / 1000) - t.created_at_unix });
  }

  // 3. holders（Birdeye 没给的话用 Helius）
  if (!ov?.holder) {
    const lastRefresh = t.last_metadata_refresh_at ?? 0;
    if (Date.now() - lastRefresh > HOLDERS_REFRESH_INTERVAL_MS) {
      const h = await helius.getHoldersCount(address);
      if (h !== null) {
        tokenRepo.upsert({ address, holders: h });
      }
    }
  }

  tokenRepo.setLastMetadataRefreshAt(address, Date.now());
  logger.debug({ address, symbol: ov?.symbol }, '元数据已刷新');
}

/** 添加代币到监控列表（CA 自动补全 symbol/decimals 等） */
export async function addTokenToMonitor(address: string, addedBy: 'manual' | 'webhook', symbolHint?: string): Promise<void> {
  const existing = tokenRepo.get(address);
  if (existing && existing.monitor_active === 1) {
    logger.info({ address }, '代币已在监控');
    return;
  }
  // 重新激活/首次加入：清理过期状态
  // - last_alert_at = null 让冷却重置
  // - 如果 high_24h_at 已超 24h，清掉让 updatePrice 重算
  const now = Date.now();
  const reactivate: Partial<{ last_alert_at: number | null; high_24h: number | null; high_24h_at: number | null }> = {};
  if (existing) {
    reactivate.last_alert_at = null;
    if (!existing.high_24h_at || now - existing.high_24h_at > 24 * 3600 * 1000) {
      reactivate.high_24h = null;
      reactivate.high_24h_at = null;
    }
  }

  tokenRepo.upsert({
    address,
    symbol: symbolHint ?? existing?.symbol ?? null,
    added_at: now,
    added_by: addedBy,
    monitor_active: 1,
    ...reactivate,
  });
  await refreshTokenMetadata(address);
}
