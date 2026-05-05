import { useEffect, useState } from 'react';
import { api } from '../api/client';

export function SettingsPage() {
  const [config, setConfig] = useState<any>(null);
  const [health, setHealth] = useState<any>(null);

  useEffect(() => {
    api.config().then(setConfig).catch(() => {});
    api.health().then(setHealth).catch(() => {});
  }, []);

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">设置</h2>

      <div className="bg-panel border border-border rounded-lg p-5 mb-4">
        <h3 className="text-sm font-semibold mb-3">运行状态</h3>
        {health ? (
          <dl className="text-sm space-y-2">
            <Row label="服务" value={health.ok ? '✅ 运行中' : '❌ 异常'} />
            <Row label="钱包" value={health.walletUnlocked ? '🔓 已解锁' : '🔒 未解锁'} />
            <Row label="钱包地址" value={<code className="text-xs">{health.walletAddress ?? '—'}</code>} mono />
          </dl>
        ) : <div className="text-muted text-sm">加载中...</div>}
      </div>

      <div className="bg-panel border border-border rounded-lg p-5 mb-4">
        <h3 className="text-sm font-semibold mb-3">策略参数</h3>
        <p className="text-xs text-muted mb-3">这些值通过后端 <code>.env</code> 配置，修改后需重启后端。</p>
        {config ? (
          <dl className="text-sm space-y-2">
            <Row label="默认买入金额" value={`${config.defaultBuySol} SOL`} />
            <Row label="默认滑点" value={`${(config.defaultSlippageBps / 100).toFixed(2)}%`} />
            <Row label="自动止盈阈值" value={`涨 ${config.takeProfitGainPct}% 全仓卖出`} />
            <Row label="跌幅报警阈值" value={`24h 高点回落 ${config.stopLossDropPct}%`} />
            <Row label="最低 FDV" value={`$${config.fdvMinUsd}`} />
            <Row label="最低 LP" value={`$${config.lpMinUsd}`} />
            <Row label="MEV 保护 (Jito)" value={config.jitoMevProtectEnabled ? '✓ 启用' : '✗ 禁用'} />
          </dl>
        ) : <div className="text-muted text-sm">加载中...</div>}
      </div>

      <div className="bg-panel border border-border rounded-lg p-5">
        <h3 className="text-sm font-semibold mb-3">Webhook 接入</h3>
        <p className="text-xs text-muted mb-2">外部系统可通过 POST 请求往以下地址推送代币：</p>
        <pre className="bg-bg border border-border rounded p-3 text-xs overflow-x-auto">{`curl -X POST ${window.location.origin}/webhook/add-token \\
  -H "Content-Type: application/json" \\
  -H "x-webhook-secret: <你在 .env 里设置的 WEBHOOK_SECRET>" \\
  -d '{"network":"solana","address":"<CA>","symbol":"<可选>"}'`}</pre>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: any; mono?: boolean }) {
  return (
    <div className="flex justify-between py-1 border-b border-border last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className={mono ? 'font-mono text-xs' : ''}>{value}</dd>
    </div>
  );
}
