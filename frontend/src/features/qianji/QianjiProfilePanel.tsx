import React, { useCallback, useEffect, useState } from 'react';
import { fetchQianjiChat, fetchQianjiHistory, markQianjiConclusion, qianjiArtifactUrl, retireQianji } from '../../api/qianji';
import type { QianjiChatTurnDto, QianjiHistoryDto, QianjiListItemDto } from '../../api/qianji';
import { Modal } from '../../components/Modal';
import { QianjiChatPanel } from './QianjiChatPanel';
import { QianjiNarrativeEditor } from './QianjiNarrativeEditor';

export type QianjiProfileModal = 'history' | 'narrative' | 'retire';

const reasonText = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);
const isAbort = (reason: unknown) => reason instanceof DOMException && reason.name === 'AbortError';

export const QianjiProfilePanel: React.FC<{
  item: QianjiListItemDto;
  onRefresh: () => Promise<void>;
  onSent: () => Promise<void>;
  sendBlocked?: string | null;
  modalRequest?: { modal: QianjiProfileModal; nonce: number } | null;
}> = ({ item, onRefresh, onSent, sendBlocked, modalRequest }) => {
  const qianjiId = item.profile.qianjiId;
  const [openModal, setOpenModal] = useState<QianjiProfileModal | null>(null);
  const [history, setHistory] = useState<QianjiHistoryDto | null>(null);
  const [turns, setTurns] = useState<QianjiChatTurnDto[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [marking, setMarking] = useState<string | null>(null);
  const [retireReason, setRetireReason] = useState('');
  const [retireError, setRetireError] = useState<string | null>(null);
  const [retiring, setRetiring] = useState(false);

  useEffect(() => {
    setOpenModal(null); setHistory(null); setTurns([]); setHistoryError(null); setRetireReason(''); setRetireError(null);
  }, [qianjiId]);
  useEffect(() => { if (modalRequest) setOpenModal(modalRequest.modal); }, [modalRequest?.nonce]);

  const reloadHistory = useCallback(async (signal?: AbortSignal) => {
    const [nextHistory, nextTurns] = await Promise.allSettled([
      fetchQianjiHistory(qianjiId, signal),
      fetchQianjiChat(qianjiId, signal),
    ]);
    if (signal?.aborted) return;
    setHistoryLoading(false);
    if (nextHistory.status === 'fulfilled') { setHistory(nextHistory.value); setHistoryError(null); }
    else if (!isAbort(nextHistory.reason)) setHistoryError(reasonText(nextHistory.reason));
    if (nextTurns.status === 'fulfilled') setTurns(nextTurns.value);
  }, [qianjiId]);

  useEffect(() => {
    if (openModal !== 'history') return;
    const controller = new AbortController();
    setHistoryLoading(true);
    void reloadHistory(controller.signal);
    return () => controller.abort();
  }, [openModal, reloadHistory]);

  const physicalText = !item.currentBinding ? '未绑定 Pixel'
    : item.physical?.active ? `载体活跃 · ${item.physical.energy ?? '未知'} Token`
      : `载体失活 · ${item.physical?.energy ?? '未知'} Token`;

  const submitRetirement = async (event: React.FormEvent) => {
    event.preventDefault();
    if (retiring || !retireReason.trim()) return;
    setRetiring(true); setRetireError(null);
    try {
      const key = globalThis.crypto?.randomUUID?.() ?? `retire-${Date.now()}`;
      await retireQianji(qianjiId, retireReason.trim(), key);
      setOpenModal(null); setRetireReason(''); await onRefresh();
    } catch (error) { setRetireError(reasonText(error)); }
    finally { setRetiring(false); }
  };

  const markConclusion = async (turnId: string) => {
    setMarking(turnId);
    try { await markQianjiConclusion(qianjiId, turnId); await reloadHistory(); }
    catch (reason) { if (!isAbort(reason)) setHistoryError(reasonText(reason)); }
    finally { setMarking(null); }
  };

  const repliedTurns = turns.filter(turn => turn.status === 'replied' && turn.reply !== null);

  return (
    <section className="qj-profile-panel" aria-label="人物详情">
      <header className="qj-profile-header">
        <div><p className="qj-eyebrow">{item.profile.careerStatus === 'active' ? '可对话' : item.profile.careerStatus}</p><h2>{item.profile.narrative.displayName}</h2><p>{item.profile.birthIdentity
          ? `${item.profile.birthIdentity.primaryHexagram} → ${item.profile.birthIdentity.changedHexagram}` : '旧人物'}</p></div>
        <div className="qj-physical-state"><b>{physicalText}</b>{item.currentBinding && <small>{item.currentBinding.pixelId} · 第 {item.currentBinding.incarnation} 代</small>}</div>
      </header>
      <QianjiChatPanel item={item} onSent={onSent} sendBlocked={sendBlocked} />

      <Modal isOpen={openModal === 'history'} title="经历" contentClassName="doc-modal-content" onClose={() => setOpenModal(null)}>
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
            <h3>可记入的对话</h3>
            {repliedTurns.length === 0 && <p className="qj-empty">还没有可直接记入的回复。</p>}
            {repliedTurns.map(turn => <p className="qj-history-row" key={turn.turnId}>
              {turn.reply}
              <button className="btn btn-xs" type="button" disabled={Boolean(turn.isMilestone) || marking === turn.turnId}
                onClick={() => void markConclusion(turn.turnId)}>{turn.isMilestone ? '已记入经历' : '记入经历'}</button>
            </p>)}
            <h3>交付物</h3>
            {history.artifacts.current?.files.map(file => <p className="qj-history-row" key={file.name}>
              <a href={qianjiArtifactUrl(qianjiId, history.artifacts.current!.bindingId, file.name)} download>{file.name}</a>
            </p>)}
            {history.artifacts.archives.flatMap(archive => archive.files.map(file => <p className="qj-history-row"
              key={`${archive.bindingId}-${file.name}`}><a href={qianjiArtifactUrl(qianjiId, archive.bindingId, file.name)} download>{file.name}</a></p>))}
            {!history.artifacts.current?.files.length && !history.artifacts.archives.some(archive => archive.files.length) &&
              <p className="qj-empty">暂无交付物。</p>}
            <p>已知模型与工具成本：{history.attributed.costSummary.knownCostCny.toFixed(4)} CNY
              {history.attributed.costSummary.totalCostCny === null ? '（完整成本未知）' : ''}</p>
          </>}
        </section>
      </Modal>

      <Modal isOpen={openModal === 'narrative'} title={item.profile.birthIdentity ? '出生' : '人设'}
        contentClassName="doc-modal-content" onClose={() => setOpenModal(null)}>
        <QianjiNarrativeEditor profile={item.profile} onSaved={onRefresh} />
      </Modal>

      <Modal isOpen={openModal === 'retire'} title={`办理退役 · ${item.profile.narrative.displayName}`} onClose={() => setOpenModal(null)}>
        <form className="qj-retire-form" onSubmit={submitRetirement}>
          <label>退役原因<textarea value={retireReason} onChange={event => setRetireReason(event.target.value)} maxLength={1000} rows={4} required /></label>
          <div className="qj-form-footer">
            <button className="btn btn-xs" type="button" disabled={retiring} onClick={() => setOpenModal(null)}>取消</button>
            <button className="btn btn-xs btn-primary" type="submit" disabled={retiring || !retireReason.trim()}>{retiring ? '处理中…' : '确认退役'}</button>
          </div>
          {retireError && <p className="qj-inline-error" role="alert">{retireError}</p>}
        </form>
      </Modal>
    </section>
  );
};
