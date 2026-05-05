import { tokenRepo, positionRepo, tradeRepo } from '../db/repo.js';
import { wallet } from '../wallet/index.js';
import { birdeye } from '../services/birdeye/client.js';
import type { TokenView, DashboardStats } from '../types/index.js';
import { SOL_MINT } from '../db/repo.js';

// SOL 价格 30 秒缓存，避免每次 dashboard 刷新都 hit Birdeye
let solPriceCache: { price: number | null; ts: number } = { price: null, ts: 0 };
const SOL_PRICE_TTL_MS = 30_000;
async function cachedSolPrice(): Promise<number | null> {
  if (Date.now() - solPriceCache.ts < SOL_PRICE_TTL_MS && solPriceCache.price !== null) {
    return solPriceCache.price;
  }
  const p = await birdeye.getPrice(SOL_MINT);
  solPriceCache = { price: p, ts: Date.now() };
  return p;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const since24h = Date.now() - 24 * 3600 * 1000;
  const realized = positionRepo.pnlSince(since24h);
  const trades24h = tradeRepo.countSince(since24h);

  // 未实现盈亏 = sum(open positions: (current_price - avg_entry) * amount / sol_price)
  const positions = positionRepo.listOpen();
  const solPrice = await cachedSolPrice();
  let unrealized = 0;
  for (const p of positions) {
    const t = tokenRepo.get(p.token_address);
    if (!t?.price_usd || !solPrice) continue;
    const valueUsd = t.price_usd * p.amount_ui;
    const valueSol = valueUsd / solPrice;
    unrealized += valueSol - p.sol_spent;
  }

  let solBalance = 0;
  let address = '';
  if (wallet.isUnlocked) {
    address = wallet.address;
    try { solBalance = await wallet.getSolBalance(); } catch { /* ignore */ }
  }

  return {
    pnl_24h_sol: realized.realized + unrealized,
    realized_pnl_24h_sol: realized.realized,
    unrealized_pnl_sol: unrealized,
    trades_24h: trades24h,
    active_tokens: tokenRepo.listActive().length,
    open_positions: positions.length,
    wallet_sol_balance: solBalance,
    wallet_address: address,
  };
}

export async function getTokenViews(): Promise<TokenView[]> {
  const tokens = tokenRepo.listActive();
  const positions = new Map(positionRepo.listOpen().map(p => [p.token_address, p]));
  const solPrice = await cachedSolPrice();

  return tokens.map((t) => {
    let pctFromHigh: number | null = null;
    if (t.high_24h && t.high_24h > 0 && t.price_usd) {
      pctFromHigh = ((t.price_usd - t.high_24h) / t.high_24h) * 100;
    }
    const pos = positions.get(t.address);
    let unrealized: number | null = null;
    if (pos && t.price_usd && solPrice) {
      const valueSol = (t.price_usd * pos.amount_ui) / solPrice;
      unrealized = valueSol - pos.sol_spent;
    }
    return {
      ...t,
      pct_from_high_24h: pctFromHigh,
      pct_change_24h: pctFromHigh,
      has_open_position: !!pos,
      position_amount_ui: pos?.amount_ui ?? null,
      unrealized_pnl_sol: unrealized,
    };
  });
}
