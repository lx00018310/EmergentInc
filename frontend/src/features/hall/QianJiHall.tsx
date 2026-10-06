import { t as tr, useLanguage } from '../../i18n';
import {selectWorld,worldsEnabled} from '../../api/worldScope';
import {WorldSummary} from '../qianji/WorldSummary';
import React, { useEffect, useRef, useState } from 'react';
import { useWorldPolling } from '../../hooks/useWorldPolling';
import { useQianjiPolling } from '../../hooks/useQianjiPolling';
import { startRun } from '../../api/run';
import { QianjiCard, type QianjiMenuAction } from '../qianji/QianjiCard';
import { QianjiProfilePanel, type QianjiProfileModal } from '../qianji/QianjiProfilePanel';
import { ApprovalPanel } from './ApprovalPanel';
import { RecoveryOperations } from '../run/RecoveryOperations';

const chatRunRequest = { rounds: 1, run_budget_tokens: 100000 };

export interface QianJiHallProps {
  selectedQianjiId: string | null;
  onSelectedQianji: (id: string | null) => void;
  onSelectedPixel: (id: string | null) => void;
  onOpenEngine: () => void;
  onOpenGacha?: () => void;
  onOpenMeeting?: () => void;
}

export const QianJiHall: React.FC<QianJiHallProps> = ({ selectedQianjiId, onSelectedQianji, onSelectedPixel, onOpenEngine, onOpenGacha, onOpenMeeting }) => {
  useLanguage();
  const { items, presentation, error: qianjiError, loading, refresh } = useQianjiPolling();
  const { world, runStatus, error: worldError, refreshImmediately } = useWorldPolling();
  const [runError, setRunError] = useState<string | null>(null);
  const [modalRequest, setModalRequest] = useState<{ modal: QianjiProfileModal; nonce: number } | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [isRecoveryOpen, setIsRecoveryOpen] = useState(false);
  const addMenuRef = useRef<HTMLDivElement | null>(null);
  const selected = items.find(item => item.profile.qianjiId === selectedQianjiId) ?? null;
  const recoveryRequired = Boolean(runStatus?.unfinalized_operations?.hasUnfinalized && !runStatus?.running);

  useEffect(() => {
    if (!addMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(event.target as Node)) setAddMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAddMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [addMenuOpen]);

  const selectPerson = (id: string) => {
    const entry=items.find(e=>e.profile.qianjiId===id);if(entry?.world)selectWorld(entry.world.world_id);
    onSelectedQianji(id);
    onSelectedPixel(items.find(entry => entry.profile.qianjiId === id)?.currentBinding?.pixelId ?? null);
  };

  const handleMenuAction = (id: string, action: QianjiMenuAction) => {
    selectPerson(id);
    if (action === 'meeting') { onOpenMeeting?.(); return; }
    setModalRequest(previous => ({ modal: action, nonce: (previous?.nonce ?? 0) + 1 }));
  };

  const handleSent = async () => {
    await refresh();
    if (runStatus?.running || recoveryRequired) { await refreshImmediately(); return; }
    setRunError(null);
    try { if(!worldsEnabled())await startRun(chatRunRequest); }
    catch (err) { setRunError(err instanceof Error ? err.message : String(err)); }
    await refreshImmediately();
  };

  const sendBlocked = runStatus?.running ? (tr("Run 进行中，等本轮结束后可继续发送。")) : null;

  useEffect(() => {
    if (!selectedQianjiId && items.length > 0 && items[0]) onSelectedQianji(items[0].profile.qianjiId);
  }, [items, onSelectedQianji, selectedQianjiId]);

  useEffect(() => {
    if(selected?.world){selectWorld(selected.world.world_id);void refreshImmediately();}
    onSelectedPixel(selected?.currentBinding?.pixelId ?? null);
  }, [selected?.currentBinding?.pixelId, selected?.world?.world_id, onSelectedPixel,refreshImmediately]);

  const runState = runStatus?.running ? tr("运行中 · {0}/{1} 轮", [runStatus.completed_rounds, runStatus.requested_rounds])
    : recoveryRequired ? (tr("需要恢复处理")) : runStatus?.result_status === 'FAILED' ? (tr("上次运行失败")) : (tr("空闲"));

  return (
    <div className="qianji-hall" data-testid="qianji-hall">
      {/* 极地全息琉璃雪莲与光纤经脉微光背景 (图3意象) */}
      <div className="qianji-lotus-bg" aria-hidden="true">
        <svg viewBox="0 0 600 600" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="lotusGlow" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#00e5ff" stopOpacity="0.22" />
              <stop offset="45%" stopColor="#f472b6" stopOpacity="0.18" />
              <stop offset="80%" stopColor="#ffd700" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.15" />
            </linearGradient>
            <radialGradient id="lotusCenter" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#00e5ff" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#00e5ff" stopOpacity="0" />
            </radialGradient>
          </defs>
          <path d="M300 600 C300 450, 290 380, 300 300" stroke="#00e5ff" strokeWidth="1.5" strokeDasharray="6 4" strokeOpacity="0.35" />
          <circle cx="300" cy="300" r="140" fill="url(#lotusCenter)" />
          <path d="M300 120 C240 200, 260 280, 300 300 C340 280, 360 200, 300 120 Z" fill="url(#lotusGlow)" stroke="#00e5ff" strokeWidth="1" strokeOpacity="0.45" />
          <path d="M300 140 C200 190, 210 270, 300 300 C390 270, 400 190, 300 140 Z" fill="url(#lotusGlow)" stroke="#f472b6" strokeWidth="1" strokeOpacity="0.4" />
          <path d="M300 160 C160 210, 180 290, 300 300 C420 290, 440 210, 300 160 Z" fill="url(#lotusGlow)" stroke="#ffd700" strokeWidth="1" strokeOpacity="0.35" />
          <circle cx="300" cy="280" r="160" stroke="#0284c7" strokeWidth="0.6" strokeDasharray="4 8" strokeOpacity="0.3" />
        </svg>
      </div>

      <header className="hall-header">
        <div className="hall-brand"><span className="hall-mark">{tr("千")}</span><div><h1>{presentation?.revision ? presentation.hallName : tr(presentation?.hallName ?? '千机阁')}</h1><p>{presentation?.revision ? presentation.organizationName : tr(presentation?.organizationName ?? 'EmergentInc 元胞会社')}</p></div></div>
        <div className="hall-run-summary"><span>{tr("第") + " "}{world?.round ?? runStatus?.current_round ?? 0} {" " + tr("轮")}</span><span className={runStatus?.running ? 'is-running' : recoveryRequired ? 'is-error' : ''}>{runState}</span></div>
        <div className="hall-navigation"><button className="btn btn-sm" type="button" onClick={onOpenEngine}>{tr("进入") + " "}{presentation?.sectionLabels?.engine ?? 'Engine'}</button></div>
      </header>

      {(qianjiError || worldError || runError) && <div className="hall-error" role="alert">{qianjiError || worldError || runError}</div>}
      {recoveryRequired && (
        <div
          className="hall-warning-bar"
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            borderRadius: '8px',
            padding: '10px 16px',
            margin: '0 0 16px 0',
            backdropFilter: 'blur(8px)',
          }}
        >
          <p className="hall-warning" style={{ margin: 0, color: '#f87171', fontSize: '13px', lineHeight: 1.5 }}>
            {tr("存在未决操作。请进入 Engine 的 Recovery 面板处理后再运行。")}</p>
          <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              style={{
                background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                borderColor: '#ef4444',
                color: '#fff',
                fontSize: '12px',
                padding: '4px 12px',
                boxShadow: '0 2px 8px rgba(239, 68, 68, 0.35)',
                cursor: 'pointer',
              }}
              onClick={() => setIsRecoveryOpen(true)}
            >
              {tr("立即在此对账决策")}</button>
            <button
              type="button"
              className="btn btn-sm"
              style={{
                fontSize: '12px',
                padding: '4px 10px',
                cursor: 'pointer',
              }}
              onClick={onOpenEngine}
            >
              {tr("进入 Engine")}</button>
          </div>
        </div>
      )}

      <main className="hall-grid">
        <section className="hall-roster" aria-label={tr("人物列表")}>
          <div className="hall-section-heading"><div><p className="qj-eyebrow">{presentation?.revision ? presentation.sectionLabels?.members : tr(presentation?.sectionLabels?.members ?? '人物')}</p><h2>{tr("千机名录")}</h2></div><span>{items.length} {" " + tr("位")}</span></div>
          {loading && items.length === 0 && <p className="qj-empty">{tr("正在读取人物…")}</p>}
          {!loading && !qianjiError && items.length === 0 && <p className="qj-empty">{tr("暂无人物，点击下方 + 招募第一位人物。")}</p>}
          <div className="qj-roster-list">{items.map(item => (
            <QianjiCard key={item.profile.qianjiId} item={item} selected={selectedQianjiId === item.profile.qianjiId}
              onSelect={selectPerson} onMenuAction={handleMenuAction} showMeetingAction={Boolean(onOpenMeeting)} />
          ))}
            <div className="qj-roster-add" ref={addMenuRef}>
              <button className="qj-add-button" type="button" aria-label={tr("新建人物位")} aria-haspopup="menu" aria-expanded={addMenuOpen} onClick={() => setAddMenuOpen(open => !open)}>+</button>
              {addMenuOpen && (
                <div className="qj-menu-popover qj-add-popover" role="menu" aria-label={tr("新建菜单")}>
                  <button type="button" role="menuitem" onClick={() => { setAddMenuOpen(false); onOpenGacha?.(); }}>{tr("招募人物")}</button>
                  {onOpenMeeting&&<button type="button" role="menuitem" onClick={() => { setAddMenuOpen(false); onOpenMeeting?.(); }}>{tr("发起会议")}</button>}
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="hall-detail-column">
          {selected ? <QianjiProfilePanel item={selected} modalRequest={modalRequest} onSent={handleSent} sendBlocked={sendBlocked}
            onRefresh={async () => { await refresh(); await refreshImmediately(); }} />
            : <div className="qj-panel-placeholder">{tr("选择一位人物查看详情。")}</div>}
        </section>

        <aside className="hall-side-column" aria-label={tr("需要阁主决定")}>
          {selected?.world?<WorldSummary item={selected} onRefresh={refresh}/>:!worldsEnabled()&&<ApprovalPanel />}
        </aside>
      </main>

      {isRecoveryOpen && runStatus && (
        <RecoveryOperations
          status={runStatus}
          onRefresh={async () => {
            await refreshImmediately();
            await refresh();
          }}
          onClose={() => setIsRecoveryOpen(false)}
        />
      )}
    </div>
  );
};
