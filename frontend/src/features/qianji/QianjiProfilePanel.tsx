import { t as tr, useLanguage } from '../../i18n';
import React, { useCallback, useEffect, useState } from 'react';
import { fetchQianjiChat, fetchQianjiHistory, markQianjiConclusion, qianjiArtifactUrl, qianjiPortraitUrl, retireQianji } from '../../api/qianji';
import type { QianjiChatTurnDto, QianjiHistoryDto, QianjiListItemDto } from '../../api/qianji';
import { Modal } from '../../components/Modal';
import { QianjiChatPanel } from './QianjiChatPanel';
import { QianjiNarrativeEditor } from './QianjiNarrativeEditor';
import { TechGoggleAvatar } from './TechGoggleAvatar';

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
  useLanguage();
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
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setOpenModal(null); setHistory(null); setTurns([]); setHistoryError(null); setRetireReason(''); setRetireError(null); setImageFailed(false);
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

  const physicalText = item.world?tr("World {0} · {1} 活跃元胞", [item.world.status, item.world.activePixels??0]) : !item.currentBinding ? (tr("未绑定 Pixel"))
    : item.physical?.active ? tr("载体活跃 · {0} Token", [item.physical.energy ?? '未知'])
      : tr("载体失活 · {0} Token", [item.physical?.energy ?? '未知']);

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
    <section className="qj-profile-panel" aria-label={tr("人物详情")}>
      <div className="qj-hero-stage">
        <div className="qj-hero-portrait-frame">
          {item.profile.narrative.portraitAsset && !imageFailed ? (
            <img
              src={qianjiPortraitUrl(qianjiId)}
              alt={item.profile.narrative.displayName}
              onError={() => setImageFailed(true)}
            />
          ) : (
            <TechGoggleAvatar variant="hero" />
          )}
          <div className="qj-lens-reticle" aria-hidden="true" />
        </div>

        <div className="qj-hero-content">
          <div className="qj-hero-title-row">
            <div>
              <p className="qj-eyebrow">
                {item.profile.careerStatus === 'active' ? (tr("● 活跃服役中")) : item.profile.careerStatus === 'trial' ? (tr("◇ 试炼考核中")) : item.profile.careerStatus === 'candidate' ? (tr("○ 候选整备")) : (tr("已退役"))}
              </p>
              <h2>{item.profile.narrative.displayName}</h2>
              {item.profile.birthIdentity ? (
                <div className="qj-hexagram-tag hero-tag">
                  <span className="qj-hex-symbol">☯</span>
                  <span>{tr("本卦 ·") + " "}{item.profile.birthIdentity.primaryHexagram}</span>
                  <span className="qj-hex-arrow">→</span>
                  <span>{tr("变卦 ·") + " "}{item.profile.birthIdentity.changedHexagram}</span>
                </div>
              ) : (
                <span className="qj-hexagram-tag hero-tag">{tr("旧人物载体")}</span>
              )}
            </div>

            <div className="qj-hero-actions">
              <button className="btn btn-xs" type="button" onClick={() => setOpenModal('history')}>{tr("查阅经历")}</button>
              <button className="btn btn-xs" type="button" onClick={() => setOpenModal('narrative')}>
                {item.profile.birthIdentity ? (tr("出生生辰")) : (tr("编辑人设"))}
              </button>
              {item.profile.careerStatus !== 'retired' && (
                <button className="btn btn-xs btn-outline-danger" type="button" onClick={() => setOpenModal('retire')}>{tr("办理退役")}</button>
              )}
            </div>
          </div>

          <div className="qj-ortho-specs">
            <div className="qj-ortho-header">
              <span>{tr("正交机能规格 // SCHEMATIC SPECS")}</span>
              <span className="qj-ortho-code">{item.world?item.world.world_id:item.currentBinding ? tr("{0} · 第 {1} 代", [item.currentBinding.pixelId, item.currentBinding.incarnation]) : (tr("未绑定 PIXEL"))}</span>
            </div>
            <div className="qj-ortho-grid">
              <div className="qj-ortho-cell">
                <small>{item.world?(tr("所属世界")):(tr("载体运行状态"))}</small>
                <strong>{physicalText}</strong>
              </div>
              <div className="qj-ortho-cell">
                <small>{tr("剩余机能能元")}</small>
                <strong>{item.physical?.energy != null ? `${item.physical.energy.toLocaleString()} T` : (tr("未知"))}</strong>
              </div>
              <div className="qj-ortho-cell">
                <small>{tr("亏损补偿状态")}</small>
                <strong>{(item.physical?.refundDeficitTokens ?? 0) === 0 ? (tr("NOMINAL · 正常")) : `DEFICIT · ${item.physical?.refundDeficitTokens}`}</strong>
              </div>
            </div>
          </div>
        </div>
      </div>

      <QianjiChatPanel item={item} onSent={onSent} sendBlocked={sendBlocked} />

      <Modal isOpen={openModal === 'history'} title={tr("经历")} contentClassName="doc-modal-content" overlayClassName="qj-modal-overlay" onClose={() => setOpenModal(null)}>
        <section className="qj-history-panel">
          {historyLoading && <p>{tr("正在读取履历…")}</p>}
          {historyError && <p className="qj-inline-error" role="alert">{historyError}</p>}
          {history && <>
            <h3>{tr("关键经历")}</h3>
            {history.conclusions?.map(conclusion => <p className="qj-history-row" key={conclusion.turnId}>
              {tr("对话结论 ·") + " "}{conclusion.summary}</p>)}
            {history.events.filter(event => ['MISSION_COMPLETED', 'TRIAL_COMPLETED', 'QIANJI_RECRUITED', 'DELIVERY_STATUS_CHANGED'].includes(event.eventType))
              .map(event => <p className="qj-history-row" key={event.eventId}>
                {event.eventType === 'MISSION_COMPLETED' ? (tr("完成任务")) : event.eventType === 'TRIAL_COMPLETED' ? (tr("完成试炼")) :
                  event.eventType === 'QIANJI_RECRUITED' ? (tr("正式加入")) : (tr("交付状态更新"))} · {new Date(event.createdAt * 1000).toLocaleString()}
              </p>)}
            <h3>{tr("可记入的对话")}</h3>
            {repliedTurns.length === 0 && <p className="qj-empty">{tr("还没有可直接记入的回复。")}</p>}
            {repliedTurns.map(turn => <p className="qj-history-row" key={turn.turnId}>
              {turn.reply}
              <button className="btn btn-xs" type="button" disabled={Boolean(turn.isMilestone) || marking === turn.turnId}
                onClick={() => void markConclusion(turn.turnId)}>{turn.isMilestone ? (tr("已记入经历")) : (tr("记入经历"))}</button>
            </p>)}
            <h3>{tr("交付物")}</h3>
            {history.artifacts.current?.files.map(file => <p className="qj-history-row" key={file.name}>
              <a href={qianjiArtifactUrl(qianjiId, history.artifacts.current!.bindingId, file.name)} download>{file.name}</a>
            </p>)}
            {history.artifacts.archives.flatMap(archive => archive.files.map(file => <p className="qj-history-row"
              key={`${archive.bindingId}-${file.name}`}><a href={qianjiArtifactUrl(qianjiId, archive.bindingId, file.name)} download>{file.name}</a></p>))}
            {!history.artifacts.current?.files.length && !history.artifacts.archives.some(archive => archive.files.length) &&
              <p className="qj-empty">{tr("暂无交付物。")}</p>}
            <p>{tr("已知模型与工具成本：")}{history.attributed.costSummary.knownCostCny.toFixed(4)} CNY
              {history.attributed.costSummary.totalCostCny === null ? (tr("（完整成本未知）")) : ''}</p>
          </>}
        </section>
      </Modal>

      <Modal isOpen={openModal === 'narrative'} title={item.profile.birthIdentity ? (tr("出生")) : (tr("人设"))}
        contentClassName="doc-modal-content" overlayClassName="qj-modal-overlay" onClose={() => setOpenModal(null)}>
        <QianjiNarrativeEditor profile={item.profile} onSaved={onRefresh} />
      </Modal>

      <Modal isOpen={openModal === 'retire'} title={tr("办理退役 · {0}", [item.profile.narrative.displayName])}
        contentClassName="qj-retire-modal-content" overlayClassName="qj-modal-overlay" onClose={() => setOpenModal(null)}>
        <form className="qj-retire-form" onSubmit={submitRetirement}>
          <label>{tr("退役原因")}<textarea value={retireReason} onChange={event => setRetireReason(event.target.value)} maxLength={1000} rows={4} required /></label>
          <div className="qj-form-footer">
            <button className="btn btn-xs" type="button" disabled={retiring} onClick={() => setOpenModal(null)}>{tr("取消")}</button>
            <button className="btn btn-xs btn-primary" type="submit" disabled={retiring || !retireReason.trim()}>{retiring ? (tr("处理中…")) : (tr("确认退役"))}</button>
          </div>
          {retireError && <p className="qj-inline-error" role="alert">{retireError}</p>}
        </form>
      </Modal>
    </section>
  );
};
