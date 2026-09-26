import React, { useEffect, useState } from 'react';
import { useWorldPolling } from '../../hooks/useWorldPolling';
import { useQianjiPolling } from '../../hooks/useQianjiPolling';
import { startRun, stopRun } from '../../api/run';
import { QianjiCard } from '../qianji/QianjiCard';
import { QianjiProfilePanel } from '../qianji/QianjiProfilePanel';

const neutralEventLabels: Record<string, string> = {
  QIANJI_PROFILE_CREATED: '人物建立',
  QIANJI_NARRATIVE_UPDATED: '人设更新',
  QIANJI_BOUND: '绑定载体',
  QIANJI_UNBOUND: '解除绑定',
  QIANJI_RETIRED: '人物退役',
};

export interface TianJiHallProps {
  selectedQianjiId: string | null;
  onSelectedQianji: (id: string | null) => void;
  onSelectedPixel: (id: string | null) => void;
  onOpenEngine: () => void;
  onOpenOrganization: () => void;
}

export const TianJiHall: React.FC<TianJiHallProps> = ({ selectedQianjiId, onSelectedQianji, onSelectedPixel, onOpenEngine, onOpenOrganization }) => {
  const { items, events, presentation, error: qianjiError, loading, refresh } = useQianjiPolling();
  const { world, runStatus, error: worldError, refreshImmediately } = useWorldPolling();
  const [rounds, setRounds] = useState(1);
  const [budget, setBudget] = useState(100000);
  const [runError, setRunError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const selected = items.find(item => item.profile.qianjiId === selectedQianjiId) ?? null;
  const recoveryRequired = Boolean(runStatus?.unfinalized_operations?.hasUnfinalized);

  useEffect(() => {
    if (!selectedQianjiId && items.length > 0 && items[0]) onSelectedQianji(items[0].profile.qianjiId);
  }, [items, onSelectedQianji, selectedQianjiId]);

  useEffect(() => {
    onSelectedPixel(selected?.currentBinding?.pixelId ?? null);
  }, [selected?.currentBinding?.pixelId, onSelectedPixel]);

  const start = async () => {
    if (submitting || runStatus?.running || recoveryRequired) return;
    if (!Number.isSafeInteger(rounds) || rounds < 1 || !Number.isSafeInteger(budget) || budget < 1) {
      setRunError('轮数和预算必须是大于 0 的整数。');
      return;
    }
    setSubmitting(true);
    setRunError(null);
    try {
      await startRun({ rounds, run_budget_tokens: budget });
      await refreshImmediately();
    } catch (err) { setRunError(err instanceof Error ? err.message : String(err)); }
    finally { setSubmitting(false); }
  };

  const stop = async () => {
    if (submitting) return;
    setSubmitting(true);
    setRunError(null);
    try { await stopRun(); await refreshImmediately(); }
    catch (err) { setRunError(err instanceof Error ? err.message : String(err)); }
    finally { setSubmitting(false); }
  };

  const runState = runStatus?.running ? `运行中 · ${runStatus.completed_rounds}/${runStatus.requested_rounds} 轮`
    : recoveryRequired ? '需要恢复处理' : runStatus?.result_status === 'FAILED' ? '上次运行失败' : '空闲';

  return (
    <div className="tianji-hall" data-testid="tianji-hall">
      <header className="hall-header">
        <div className="hall-brand"><span className="hall-mark">天</span><div><h1>{presentation?.hallName ?? '天机阁'}</h1><p>{presentation?.organizationName ?? 'EmergentInc 元胞会社'}</p></div></div>
        <div className="hall-run-summary"><span>第 {world?.round ?? runStatus?.current_round ?? 0} 轮</span><span className={runStatus?.running ? 'is-running' : recoveryRequired ? 'is-error' : ''}>{runState}</span></div>
        <div className="hall-navigation"><button className="btn btn-sm" type="button" onClick={onOpenOrganization}>组织控制台</button><button className="btn btn-sm" type="button" onClick={onOpenEngine}>进入 {presentation?.sectionLabels?.engine ?? 'Engine'}</button></div>
      </header>

      {(qianjiError || worldError || runError) && <div className="hall-error" role="alert">{qianjiError || worldError || runError}</div>}

      <main className="hall-grid">
        <section className="hall-roster" aria-label="人物列表">
          <div className="hall-section-heading"><div><p className="qj-eyebrow">{presentation?.sectionLabels?.members ?? '人物'}</p><h2>千机名录</h2></div><span>{items.length} 位</span></div>
          {loading && items.length === 0 && <p className="qj-empty">正在读取人物…</p>}
          {!loading && !qianjiError && items.length === 0 && <p className="qj-empty">暂无人物身份。已有载体迁移后会显示在这里。</p>}
          <div className="qj-roster-list">{items.map(item => (
            <QianjiCard key={item.profile.qianjiId} item={item} selected={selectedQianjiId === item.profile.qianjiId}
              onSelect={id => { onSelectedQianji(id); onSelectedPixel(items.find(entry => entry.profile.qianjiId === id)?.currentBinding?.pixelId ?? null); }} />
          ))}</div>
        </section>

        <section className="hall-detail-column">
          {selected ? <QianjiProfilePanel item={selected} onRefresh={async () => { await refresh(); await refreshImmediately(); }} />
            : <div className="qj-panel-placeholder">选择一位人物查看详情。</div>}
        </section>

        <aside className="hall-side-column">
          <section className="hall-side-panel">
            <div className="hall-section-heading"><div><p className="qj-eyebrow">世界推进</p><h2>运行控制</h2></div><span className={runStatus?.running ? 'is-running' : ''}>{runState}</span></div>
            {recoveryRequired && <p className="hall-warning">存在未决操作。请进入 Engine 的 Recovery 面板处理后再运行。</p>}
            <div className="hall-run-fields"><label>轮数<input type="number" min={1} value={rounds} disabled={Boolean(runStatus?.running) || submitting} onChange={event => setRounds(Number(event.target.value))} /></label><label>本次 Run Token 上限<input type="number" min={1} value={budget} disabled={Boolean(runStatus?.running) || submitting} onChange={event => setBudget(Number(event.target.value))} /></label></div>
            {runStatus?.running
              ? <button className="btn btn-danger hall-run-button" type="button" disabled={submitting} onClick={stop}>停止运行</button>
              : <button className="btn btn-primary hall-run-button" type="button" disabled={submitting || recoveryRequired || !world?.pixels.some(pixel => pixel.active)} onClick={start}>{submitting ? '处理中…' : '启动 Run'}</button>}
            <p className="hall-run-hint">对话只会排队；Run 由阁主手动启动。</p>
          </section>
          <section className="hall-side-panel hall-metrics">
            <div className="hall-section-heading"><div><p className="qj-eyebrow">运行事实</p><h2>{presentation?.sectionLabels?.energyCost ?? '能量与成本'}</h2></div></div>
            <p><span>活跃载体</span><b>{world?.metrics.alive_pixels ?? '—'}</b></p>
            <p><span>能量</span><b>{world?.metrics.total_energy ?? '—'} Token</b></p>
            <p><span>累计成本</span><b>{world?.metrics.total_spent_cny == null ? '未知' : `${world.metrics.total_spent_cny.toFixed(4)} CNY`}</b></p>
          </section>
          <section className="hall-side-panel hall-events">
            <div className="hall-section-heading"><div><p className="qj-eyebrow">可追溯事实</p><h2>{presentation?.sectionLabels?.events ?? '最近事件'}</h2></div><button className="btn btn-sm" type="button" onClick={() => void refresh()}>刷新</button></div>
            {events.length === 0 ? <p className="qj-empty">暂无事实事件。</p> : events.slice(0, 10).map(event => (
              <article className="hall-event" key={event.eventId}><span>{presentation?.eventLabels?.[event.eventType] ?? neutralEventLabels[event.eventType] ?? event.eventType}</span><small>{new Date(event.createdAt * 1000).toLocaleString()}</small></article>
            ))}
          </section>
        </aside>
      </main>
    </div>
  );
};
