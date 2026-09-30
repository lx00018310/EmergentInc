import { useCallback, useEffect, useState } from 'react';
import { businessApi } from './business_api';

export function EvolutionPanel() {
  const [data, setData] = useState<any>(), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => setData(await businessApi('evolution/overview')), []);
  useEffect(() => { void refresh().catch(e => setError(e.message));
    const timer = setInterval(() => void refresh().catch(e => setError(e.message)), 5000); return () => clearInterval(timer); }, [refresh]);
  async function act(fn: () => Promise<unknown>) {
    setBusy(true); setError(''); try { await fn(); await refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section aria-label="生命循环"><h2>生命循环</h2>
    {error && <p role="alert">{error}</p>}
    {!data ? <p>正在读取生命记录…</p> : <>
      <p>当前代：<strong>{data.current.generation_id}</strong> · 身体 R{data.current.body_revision}</p>
      <h3>身体能力</h3>{data.skills.length ? data.skills.map((s: any) => <p key={s.skill_id}>{s.name} · {s.state} · 成功 {s.successful_runs} / 失败 {s.failed_runs}</p>) : <p>尚无动态能力。</p>}
      <h3>最近记忆</h3>{data.memories.map((m: any) => <dl key={m.id}><dt>{m.point}</dt><dd>原因：{m.reason}</dd><dd>效果：{m.effect}</dd></dl>)}
      <button disabled={busy} onClick={() => void act(() => businessApi('evolution/dream', {}))}>整理新经历</button>
      {data.dream.failure && <p role="alert">上次整理未完成：{data.dream.failure}</p>}
      {(data.dreamRuns ?? []).filter((r: any) => ['FAILED', 'RUNNING', 'OUTCOME_UNKNOWN'].includes(r.status)).map((r: any) => <p key={r.id}>
        {r.generation_id} 整理待处理：{r.error ?? r.status}{Boolean(r.retry_available) && <button disabled={busy}
          onClick={() => void act(() => businessApi(`evolution/dream/${r.id}/retry`, {}))}>恢复已保存的响应</button>}
      </p>)}
      <h3>待决定的基因提案</h3>{data.proposals.filter((p: any) => p.state === 'PROPOSED').map((p: any) => <div key={p.id} className="business-task">
        <strong>{p.point}</strong><p>原因：{p.reason}</p><p>效果：{p.effect}</p>
        <button disabled={busy} onClick={() => void act(() => businessApi(`evolution/proposals/${p.id}/decision`, { decision: 'APPROVED' }))}>批准方向</button>
        <button disabled={busy} onClick={() => void act(() => businessApi(`evolution/proposals/${p.id}/decision`, { decision: 'REJECTED' }))}>拒绝</button>
      </div>)}<p>批准方向后，由管理员验证具体版本并批准准确候选 Hash，才会出生下一代。</p>
      <h3>代际历史</h3>{data.generations.map((g: any) => <p key={g.id}>{g.id} · {g.state}{g.failure_reason && ` · ${g.failure_reason}`}</p>)}
    </>}
  </section>;
}
