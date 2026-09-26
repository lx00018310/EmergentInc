import React, { useEffect, useState } from 'react';
import { fetchQianjiHistory, qianjiArtifactUrl, retireQianji } from '../../api/qianji';
import type { QianjiHistoryDto, QianjiListItemDto } from '../../api/qianji';
import { QianjiChatPanel } from './QianjiChatPanel';
import { QianjiNarrativeEditor } from './QianjiNarrativeEditor';

type ProfileTab = 'chat' | 'history' | 'narrative';

export const QianjiProfilePanel: React.FC<{ item: QianjiListItemDto; onRefresh: () => Promise<void> }> = ({ item, onRefresh }) => {
  const [tab, setTab] = useState<ProfileTab>('chat');
  const [history, setHistory] = useState<QianjiHistoryDto | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [retireOpen, setRetireOpen] = useState(false);
  const [retireReason, setRetireReason] = useState('');
  const [retireError, setRetireError] = useState<string | null>(null);
  const [retiring, setRetiring] = useState(false);

  useEffect(() => { setTab('chat'); setHistory(null); setHistoryError(null); }, [item.profile.qianjiId]);
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
        <div><p className="qj-eyebrow">{item.profile.careerStatus === 'active' ? '正式成员' : item.profile.careerStatus}</p><h2>{item.profile.narrative.displayName}</h2><p>{item.profile.narrative.title || item.profile.narrative.roleLabel || '尚未设置称号'}</p></div>
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
        <button type="button" role="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')}>经历与交付物</button>
        <button type="button" role="tab" aria-selected={tab === 'narrative'} onClick={() => setTab('narrative')}>人设与图片</button>
      </div>
      {tab === 'chat' && <QianjiChatPanel item={item} onQueued={onRefresh} />}
      {tab === 'narrative' && <QianjiNarrativeEditor profile={item.profile} onSaved={onRefresh} />}
      {tab === 'history' && (
        <section className="qj-history-panel">
          {historyLoading && <p>正在读取履历…</p>}
          {historyError && <p className="qj-inline-error" role="alert">{historyError}</p>}
          {history && <>
            <h3>身份建立后的归属记录</h3>
            {history.career && <><h3>生涯统计</h3>
              <p>模型调用 {history.career.modelCallCount} 次 · 实际 Token {history.career.actualTokens} · 工具记录 {history.career.toolExecutionCount} · 试炼 {history.career.trialCount} 次</p>
              <p>任务完成 {history.career.completedMissionCount} · 失败 {history.career.failedMissionCount} · 成功率 {history.career.successRate === null ? '暂无样本' : `${(history.career.successRate * 100).toFixed(1)}%`}</p>
              {history.career.acceptedByMissionType.map(group => <p className="qj-history-row" key={group.missionType}>已验收「{group.missionType}」{group.count} 项 · 证据 {group.evidenceIds.length ? group.evidenceIds.join('、') : '无'}</p>)}
            </>}
            <p>模型调用 {history.attributed.modelCalls.length} 次 · 工具 {history.attributed.toolExecutions.length} 次 · 能量账本 {history.attributed.ledgerEntries.length} 条</p>
            <p>人物归属成本：{history.attributed.costSummary.totalCostCny === null ? `未知（已知小计 ${history.attributed.costSummary.knownCostCny.toFixed(4)} CNY）` : `${history.attributed.costSummary.totalCostCny.toFixed(4)} CNY`}</p>
            {history.attributed.modelCalls.map(call => <p className="qj-history-row" key={call.callId}>模型调用 · {String(call.outcome)} · {call.costCny === null ? '成本未知' : `${call.costCny} CNY`} · {call.callId}</p>)}
            <h3>当前载体交付物</h3>
            {history.artifacts.current?.files.map(file => <p className="qj-history-row" key={file.name}><a href={qianjiArtifactUrl(item.profile.qianjiId, history.artifacts.current!.bindingId, file.name)} download>{file.name}</a> · {file.size} bytes</p>)}
            {history.artifacts.current?.files.length === 0 && <p className="qj-empty">当前载体没有交付物。</p>}
            {history.artifacts.archives.map(archive => <div key={archive.bindingId}><h3>归档载体 · {archive.pixelId}</h3>{archive.files.map(file => <p className="qj-history-row" key={`${archive.bindingId}-${file.name}`}><a href={qianjiArtifactUrl(item.profile.qianjiId, archive.bindingId, file.name)} download>{file.name}</a> · {file.size} bytes</p>)}</div>)}
            <h3>载体旧记录（未归属，仅供参考）</h3>
            <p>模型调用 {history.attributed.carrierLegacy.modelCalls.length} 次 · 工具 {history.attributed.carrierLegacy.toolExecutions.length} 次 · 账本 {history.attributed.carrierLegacy.ledgerEntries.length} 条；不计入人物归属。</p>
            <p>旧记录已知成本小计 {history.attributed.carrierLegacy.costSummary.knownCostCny.toFixed(4)} CNY{history.attributed.carrierLegacy.costSummary.totalCostCny === null ? ` · 完整成本未知（模型 ${history.attributed.carrierLegacy.costSummary.unknownModelCount}、工具 ${history.attributed.carrierLegacy.costSummary.unknownToolCount} 项）` : ''}</p>
            {history.attributed.carrierLegacy.modelCalls.map(call => <p className="qj-history-row" key={call.callId}>旧模型调用 · {call.costCny === null ? '成本未知' : `${call.costCny} CNY`} · {call.callId}</p>)}
          </>}
        </section>
      )}
    </section>
  );
};
