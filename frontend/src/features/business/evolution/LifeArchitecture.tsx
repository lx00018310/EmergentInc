import { useCallback, useEffect, useState } from 'react';
import { businessApi } from '../business_api';
import { TrustRootLayer } from './TrustRootLayer';
import { GenomeLayer } from './GenomeLayer';
import { EvolutionLayer } from './EvolutionLayer';
import { BodyLayer } from './BodyLayer';
import type { BusinessTab, LifeOverview } from './life_types';
import './life.css';

export function LifeArchitecture({ onNavigate }: { onNavigate?: (tab: BusinessTab) => void }) {
  const [data, setData] = useState<LifeOverview>(), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => { setData(await businessApi('evolution/overview')); setError(''); }, []);
  useEffect(() => {
    let mounted = true, running = false;
    const poll = async () => {
      if (running) return;
      running = true;
      try { const result = await businessApi('evolution/overview'); if (mounted) { setData(result); setError(''); } }
      catch (e) { if (mounted) setError((e as Error).message); } finally { running = false; }
    };
    void poll(); const timer = setInterval(() => void poll(), 5000);
    return () => { mounted = false; clearInterval(timer); };
  }, []);
  async function act(fn: () => Promise<unknown>) {
    setBusy(true); setError(''); try { await fn(); await refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="life-architecture" aria-label="生命总览">
    {error && <p className="business-error" role="alert">{error}{data && ' · 当前显示上次读取的记录。'}</p>}
    {!data ? <p>正在读取生命记录…</p> : <>
      <div className="life-identity"><h2>当前生命：{data.body.current.generation_id}</h2><p>上层约束下层 · Gene {data.genome.geneHash.slice(0, 12)}… · Body R{data.body.current.body_revision}</p></div>
      <TrustRootLayer trust={data.trust} />
      <div className="life-connector" aria-hidden="true">↓ 约束</div>
      <GenomeLayer genome={data.genome} currentGeneration={data.body.current.generation_id} busy={busy} act={act} />
      <div className="life-connector" aria-hidden="true">↓ 定义可变边界</div>
      <EvolutionLayer evolution={data.evolution} currentGeneration={data.body.current.generation_id} busy={busy} act={act} />
      <div className="life-connector" aria-hidden="true">↓ 产生变化</div>
      <BodyLayer body={data.body} proposals={data.genome.proposals} onNavigate={onNavigate} />
    </>}
  </div>;
}
