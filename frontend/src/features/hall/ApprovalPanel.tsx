import { useEffect, useState } from 'react';
import { decideApproval, listApprovals, type ApprovalDto } from '../../api/meetings';

export function ApprovalPanel() {
  const [items, setItems] = useState<ApprovalDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = () => void listApprovals().then(setItems).catch(reason =>
    setError(reason instanceof Error ? reason.message : String(reason)));
  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 10000);
    return () => window.clearInterval(timer);
  }, []);
  const decide = async (id: string, decision: 'approved' | 'rejected') => {
    setBusy(id); setError(null);
    try { await decideApproval(id, decision); refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(null); }
  };
  const pending = items.filter(item => item.status === 'pending');
  return <section className="hall-side-panel">
    <div className="hall-section-heading"><div><p className="qj-eyebrow">需要阁主决定</p><h2>请求</h2></div>
      <button className="btn btn-sm" type="button" onClick={refresh}>刷新</button></div>
    {pending.length === 0 && <p className="qj-empty">暂无待处理请求。</p>}
    {pending.map(item => (
      <article className="hall-event qj-approval-event" key={item.requestId}>
        <div className="qj-approval-header">
          <span className="qj-approval-dot" aria-hidden="true" />
          <strong>{item.capability}</strong>
        </div>
        <div className="qj-approval-meta">
          <small>申请载体：{item.qianjiId ?? item.pixelId}</small>
        </div>
        <div className="org-actions">
          <button
            className="btn btn-xs btn-approve-cyan"
            type="button"
            disabled={busy === item.requestId}
            onClick={() => void decide(item.requestId, 'approved')}
          >
            {busy === item.requestId ? '处理中…' : '批准授权'}
          </button>
          <button
            className="btn btn-xs btn-reject-soft"
            type="button"
            disabled={busy === item.requestId}
            onClick={() => void decide(item.requestId, 'rejected')}
          >
            拒绝
          </button>
        </div>
      </article>
    ))}
    <small>批准会记录决定，权限仍须由阁主在相应配置中开启。</small>
    {error && <p role="alert" className="org-error-text">{error}</p>}
  </section>;
}
