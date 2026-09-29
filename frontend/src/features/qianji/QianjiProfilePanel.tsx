import React, { useEffect, useState } from 'react';
import { fetchQianjiHistory, qianjiArtifactUrl, retireQianji } from '../../api/qianji';
import type { QianjiHistoryDto, QianjiListItemDto } from '../../api/qianji';
import { QianjiChatPanel } from './QianjiChatPanel';
import { QianjiNarrativeEditor } from './QianjiNarrativeEditor';

export type QianjiProfileTab = 'chat' | 'history' | 'narrative';

export const QianjiProfilePanel: React.FC<{ item: QianjiListItemDto; onRefresh: () => Promise<void>; tabRequest?: { tab: QianjiProfileTab; nonce: number } | null; retireRequestNonce?: number }> = ({ item, onRefresh, tabRequest, retireRequestNonce }) => {
  const [tab, setTab] = useState<QianjiProfileTab>('chat');
  const [history, setHistory] = useState<QianjiHistoryDto | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [retireOpen, setRetireOpen] = useState(false);
  const [retireReason, setRetireReason] = useState('');
  const [retireError, setRetireError] = useState<string | null>(null);
  const [retiring, setRetiring] = useState(false);

  useEffect(() => { setTab('chat'); setHistory(null); setHistoryError(null); setRetireOpen(false); setRetireReason(''); }, [item.profile.qianjiId]);
  useEffect(() => { if (tabRequest) setTab(tabRequest.tab); }, [tabRequest?.nonce]);
  useEffect(() => { if (retireRequestNonce) setRetireOpen(true); }, [retireRequestNonce]);
  useEffect(() => {
    if (tab !== 'history') return;
    const controller = new AbortController();
    setHistoryLoading(true);
    fetchQianjiHistory(item.profile.qianjiId, controller.signal)
      .then(result => { setHistory(result); setHistoryError(null); })
      .catch(err => { if (!(err instanceof DOMException && err.name === 'AbortError')) setHistoryError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!controller.signal.aborted) setHistoryLoading(false); });
    return () => controller.abort();
  }, [tab, item.profile.qianjiId]);

  const physicalText = !item.currentBinding ? '未绑定 Pixel'
    : item.physical?.active ? `载体活跃 · ${item.physical.energy ?? '未知'} Token`
      : `载体失活 · ${item.physical?.energy ?? '未知'} Token`;

  return (
    <section className="qj-profile-panel" aria-label="人物详情">
      <header className="qj-profile-header">
        <div><p className="qj-eyebrow">{item.profile.careerStatus === 'active' ? '可对话' : item.profile.careerStatus}</p><h2>{item.profile.narrative.displayName}</h2><p>{item.profile.birthIdentity
          ? `${item.profile.birthIdentity.primaryHexagram} → ${item.profile.birthIdentity.changedHexagram}` : '旧人物'}</p></div>
        <div className="qj-physical-state"><b>{physicalText}</b>{item.currentBinding && <small>{item.currentBinding.pixelId} · 第 {item.currentBinding.incarnation} 代</small>}</div>
      </header>
      {item.profile.careerStatus === 'active' && <div className="qj-retirement-control">
        {!retireOpen ? <button className="btn btn-xs" type="button" onClick={() => setRetireOpen(true)}>办理退役</button> : <form onSubmit={async event => {
          event.preventDefault();
          if (retiring || !retireReason.trim()) return;
          setRetiring(true); setRetireError(null);
          try {
            const key = globalThis.crypto?.randomUUID?.() ?? `retire-${Date.now()}`;
            await retireQianji(item.profile.qianjiId, retireReason.trim(), key);
            setRetireOpen(false); setRetireReason(''); await onRefresh();
          } catch (error) { setRetireError(error instanceof Error ? error.message : String(error)); }
          finally { setRetiring(false); }
        }}>
          <label>退役原因<textarea value={retireReason} onChange={event => setRetireReason(event.target.value)} maxLength={1000} required /></label>
          <div className="qj-form-footer"><button className="btn btn-xs" type="button" disabled={retiring} onClick={() => setRetireOpen(false)}>取消</button><button className="btn btn-xs btn-primary" type="submit" disabled={retiring || !retireReason.trim()}>{retiring ? '处理中…' : '确认退役'}</button></div>
          {retireError && <p className="qj-inline-error" role="alert">{retireError}</p>}
        </form>}
      </div>}
      <div className="qj-tabs" role="tablist" aria-label="人物栏目">
        <button type="button" role="tab" aria-selected={tab === 'chat'} onClick={() => setTab('chat')}>对话</button>
        <button type="button" role="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')}>经历</button>
        <button type="button" role="tab" aria-selected={tab === 'narrative'} onClick={() => setTab('narrative')}>出生</button>
      </div>
      {tab === 'chat' && <QianjiChatPanel item={item} onQueued={onRefresh} />}
      {tab === 'narrative' && <QianjiNarrativeEditor profile={item.profile} onSaved={onRefresh} />}
      {tab === 'history' && (
        <section className="qj-history-panel">
          {historyLoading && <p>正在读取履历…</p>}
          {historyError && <p className="qj-inline-error" role="alert">{historyError}</p>}
          {history && <>
            <h3>关键经历</h3>
            {history.conclusions?.map(conclusion => <p className="qj-history-row" key={conclusion.turnId}>
              对话结论 · {conclusion.summary}</p>)}
            {history.events.filter(event => ['MISSION_COMPLETED', 'TRIAL_COMPLETED', 'QIANJI_RECRUITED', 'DELIVERY_STATUS_CHANGED'].includes(event.eventType))
              .map(event => <p className="qj-history-row" key={event.eventId}>
                {event.eventType === 'MISSION_COMPLETED' ? '完成任务' : event.eventType === 'TRIAL_COMPLETED' ? '完成试炼' :
                  event.eventType === 'QIANJI_RECRUITED' ? '正式加入' : '交付状态更新'} · {new Date(event.createdAt * 1000).toLocaleString()}
              </p>)}
            <h3>交付物</h3>
            {history.artifacts.current?.files.map(file => <p className="qj-history-row" key={file.name}>
              <a href={qianjiArtifactUrl(item.profile.qianjiId, history.artifacts.current!.bindingId, file.name)} download>{file.name}</a>
            </p>)}
            {history.artifacts.archives.flatMap(archive => archive.files.map(file => <p className="qj-history-row"
              key={`${archive.bindingId}-${file.name}`}><a href={qianjiArtifactUrl(item.profile.qianjiId, archive.bindingId, file.name)} download>{file.name}</a></p>))}
            {!history.artifacts.current?.files.length && !history.artifacts.archives.some(archive => archive.files.length) &&
              <p className="qj-empty">暂无交付物。</p>}
            <p>已知模型与工具成本：{history.attributed.costSummary.knownCostCny.toFixed(4)} CNY
              {history.attributed.costSummary.totalCostCny === null ? '（完整成本未知）' : ''}</p>
          </>}
        </section>
      )}
    </section>
  );
};
