import { t as tr, useLanguage } from '../../i18n';
import { useState } from 'react';
import { businessApi } from './business_api';

export function StrategyHistory({ id, revision, busy, act }: {
  id: string; revision: number; busy: boolean; act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  useLanguage();
  const [history, setHistory] = useState<any[]>([]);
  return <details><summary onClick={() => { void act(async () => { setHistory(await businessApi(`business/plans/${id}/revisions`)); }); }}>{tr("历史方案与策略恢复")}</summary>
    <p>{tr("恢复会形成待批准的新版本，不调用模型。原有费用、订单、对外动作和反馈保留；批准后可能再次执行旧策略中的动作，请核对行动范围。")}</p>
    {history.filter(r => r.revision < revision).map(r => <details key={r.revision}><summary>{tr("第") + " "}{r.revision} {" " + tr("版 ·") + " "}{r.plan.title}</summary>
      <p>{r.plan.objective}{tr("；原累计预算 ¥")}{r.plan.budgetMicros / 1000000}。</p>
      <form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void act(() => businessApi(`business/plans/${id}/restore`, {
        revision: r.revision, hash: r.hash, currentRevision: revision, budgetMicros: Math.round(Number(f.get('budget')) * 1000000),
        expiresAt: new Date(String(f.get('expires'))).getTime(),
      })); }}>
        <label>{tr("恢复方案的累计预算（元）")}<input name="budget" type="number" min="0" step="0.000001" defaultValue={r.plan.budgetMicros / 1000000} required /></label>
        <label>{tr("恢复方案的有效期")}<input name="expires" type="datetime-local" required /></label>
        <button disabled={busy}>{tr("恢复为新草案，等待批准")}</button>
      </form>
    </details>)}
  </details>;
}
