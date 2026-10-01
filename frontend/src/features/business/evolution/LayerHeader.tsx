import type { ReactNode } from 'react';

export function StateBadge({ state }: { state: string }) {
  const tone = /FAILED|FAILURE|UNKNOWN|RECOVERY_REQUIRED|REQUIRES_REVIEW/.test(state) ? 'error'
    : /NOT_|UNAVAILABLE|UNVERIFIED|DEV_LOCAL|WAIT|PROPOSED|REVALIDATION/.test(state) ? 'waiting' : 'neutral';
  return <span className={`life-state life-state-${tone}`}>{state}</span>;
}
export function LayerHeader({ number, code, title, description, state }: {
  number: number; code: string; title: string; description: string; state: string;
}) {
  return <header className="life-layer-header"><span className="life-layer-number">L{number}</span>
    <div><small>{code}</small><h2>{title}</h2><p>{description}</p></div><StateBadge state={state} /></header>;
}
export function LayerSummary({ current, recent, next }: { current: ReactNode; recent: ReactNode; next: ReactNode }) {
  return <div className="life-summary"><div><h3>当前状态</h3><p>{current}</p></div>
    <div><h3>最近发生</h3><p>{recent}</p></div><div><h3>等待 / 下一步</h3><p>{next}</p></div></div>;
}
