import { useState } from 'react';
import { api, type TokenView } from '../api/client';

interface Props {
  token: TokenView;
  defaultBuySol: number;
  defaultSlippageBps: number;
  onTraded: () => void;
}

export function TradeButtons({ token, defaultBuySol, defaultSlippageBps, onTraded }: Props) {
  const [open, setOpen] = useState<null | 'buy' | 'sell'>(null);
  const [solAmount, setSolAmount] = useState<number>(defaultBuySol);
  const [sellPct, setSellPct] = useState<number>(100);
  const [slippageBps, setSlippageBps] = useState<number>(defaultSlippageBps);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function doBuy() {
    setBusy(true); setErr(null);
    try {
      await api.buy(token.address, solAmount, slippageBps);
      setOpen(null);
      onTraded();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function doSell() {
    setBusy(true); setErr(null);
    try {
      const amt = token.position_amount_ui ? token.position_amount_ui * (sellPct / 100) : undefined;
      await api.sell(token.address, amt, slippageBps);
      setOpen(null);
      onTraded();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex gap-1">
      <button
        onClick={() => { setErr(null); setOpen('buy'); }}
        className="bg-green/20 hover:bg-green/30 text-green px-2 py-1 rounded text-xs font-medium"
      >买入</button>
      <button
        onClick={() => { setErr(null); setOpen('sell'); }}
        disabled={!token.has_open_position}
        className="bg-red/20 hover:bg-red/30 text-red px-2 py-1 rounded text-xs font-medium disabled:opacity-30 disabled:cursor-not-allowed"
      >卖出</button>

      {open === 'buy' && (
        <Modal title={`买入 ${token.symbol ?? '?'}`} onClose={() => setOpen(null)}>
          <Field label="买入金额 (SOL)">
            <input type="number" step="0.01" min="0.001" max="100" value={solAmount}
              onChange={e => setSolAmount(parseFloat(e.target.value) || 0)}
              className="w-full bg-bg border border-border rounded px-3 py-2 text-sm" />
          </Field>
          <Field label="滑点 (bps，100 = 1%)">
            <input type="number" step="50" min="50" max="5000" value={slippageBps}
              onChange={e => setSlippageBps(parseInt(e.target.value) || 300)}
              className="w-full bg-bg border border-border rounded px-3 py-2 text-sm" />
          </Field>
          {err && <div className="text-xs text-red mb-3">{err}</div>}
          <div className="flex gap-2 justify-end">
            <button onClick={() => setOpen(null)} className="px-4 py-2 text-sm border border-border rounded">取消</button>
            <button onClick={doBuy} disabled={busy || solAmount <= 0}
              className="px-4 py-2 text-sm bg-green text-bg rounded font-medium disabled:opacity-50">
              {busy ? '提交中...' : `确认买入 ${solAmount} SOL`}
            </button>
          </div>
        </Modal>
      )}

      {open === 'sell' && (
        <Modal title={`卖出 ${token.symbol ?? '?'}`} onClose={() => setOpen(null)}>
          <div className="text-xs text-muted mb-2">当前持仓：{token.position_amount_ui?.toFixed(2) ?? '0'} {token.symbol}</div>
          <Field label="卖出比例 (%)">
            <div className="flex gap-2">
              {[25, 50, 75, 100].map(p => (
                <button key={p} type="button" onClick={() => setSellPct(p)}
                  className={`px-3 py-1 text-xs rounded border ${sellPct === p ? 'border-accent text-accent' : 'border-border'}`}>
                  {p}%
                </button>
              ))}
              <input type="number" step="1" min="1" max="100" value={sellPct}
                onChange={e => setSellPct(parseInt(e.target.value) || 100)}
                className="flex-1 bg-bg border border-border rounded px-3 py-1 text-sm" />
            </div>
          </Field>
          <Field label="滑点 (bps)">
            <input type="number" step="50" min="50" max="5000" value={slippageBps}
              onChange={e => setSlippageBps(parseInt(e.target.value) || 300)}
              className="w-full bg-bg border border-border rounded px-3 py-2 text-sm" />
          </Field>
          {err && <div className="text-xs text-red mb-3">{err}</div>}
          <div className="flex gap-2 justify-end">
            <button onClick={() => setOpen(null)} className="px-4 py-2 text-sm border border-border rounded">取消</button>
            <button onClick={doSell} disabled={busy}
              className="px-4 py-2 text-sm bg-red text-bg rounded font-medium disabled:opacity-50">
              {busy ? '提交中...' : `确认卖出 ${sellPct}%`}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-panel border border-border rounded-lg p-5 w-[420px] max-w-[90vw]" onClick={e => e.stopPropagation()}>
        <div className="text-base font-semibold mb-4">{title}</div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <label className="block text-xs text-muted mb-1">{label}</label>
      {children}
    </div>
  );
}
