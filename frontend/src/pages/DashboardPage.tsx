import { useEffect, useState, useCallback } from 'react';
import { api, type DashboardStats, type TokenView } from '../api/client';
import { StatsBar } from '../components/StatsBar';
import { AddTokenForm } from '../components/AddTokenForm';
import { TokenTable } from '../components/TokenTable';
import { useLivePrices } from '../hooks/useLivePrices';

export function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [tokens, setTokens] = useState<TokenView[]>([]);
  const [config, setConfig] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const { livePrices, connected } = useLivePrices();

  const refresh = useCallback(async () => {
    try {
      setErr(null);
      const [s, t, c] = await Promise.all([api.stats(), api.tokens(), api.config()]);
      setStats(s);
      setTokens(t);
      setConfig(c);
    } catch (e: any) {
      setErr(e.message ?? String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15_000);    // 后端数据每 15 秒拉一次（价格走 WS）
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="text-xs text-muted">
          实时价格 WS: {connected ? <span className="text-green">●连接中</span> : <span className="text-yellow">○未连接</span>}
        </div>
        <button onClick={refresh} className="text-xs text-muted hover:text-text">↻ 刷新</button>
      </div>

      <StatsBar stats={stats} />

      <AddTokenForm onAdded={refresh} />

      {err && <div className="bg-red/10 border border-red/30 text-red p-3 rounded mb-4 text-sm">{err}</div>}

      <TokenTable
        tokens={tokens}
        livePrices={livePrices}
        defaultBuySol={config?.defaultBuySol ?? 1}
        defaultSlippageBps={config?.defaultSlippageBps ?? 300}
        onChanged={refresh}
      />

      {config && (
        <div className="mt-4 text-xs text-muted">
          策略: 涨 {config.takeProfitGainPct}% 自动止盈 · 跌 {config.stopLossDropPct}% 报警
          · FDV ≥ ${config.fdvMinUsd} · LP ≥ ${config.lpMinUsd}
          · MEV 保护: {config.jitoMevProtectEnabled ? '✓ Jito' : '✗'}
        </div>
      )}
    </div>
  );
}
