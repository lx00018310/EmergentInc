import React, { useEffect, useRef, useState } from 'react';
import { useWorldPolling } from '../../hooks/useWorldPolling';
import { useQianjiPolling } from '../../hooks/useQianjiPolling';
import { startRun } from '../../api/run';
import { QianjiCard, type QianjiMenuAction } from '../qianji/QianjiCard';
import { QianjiProfilePanel, type QianjiProfileModal } from '../qianji/QianjiProfilePanel';
import { ApprovalPanel } from './ApprovalPanel';

const chatRunRequest = { rounds: 1, run_budget_tokens: 100000 };

export interface TianJiHallProps {
  selectedQianjiId: string | null;
  onSelectedQianji: (id: string | null) => void;
  onSelectedPixel: (id: string | null) => void;
  onOpenEngine: () => void;
  onOpenGacha?: () => void;
  onOpenMeeting?: () => void;
}

export const TianJiHall: React.FC<TianJiHallProps> = ({ selectedQianjiId, onSelectedQianji, onSelectedPixel, onOpenEngine, onOpenGacha, onOpenMeeting }) => {
  const { items, presentation, error: qianjiError, loading, refresh } = useQianjiPolling();
  const { world, runStatus, error: worldError, refreshImmediately } = useWorldPolling();
  const [runError, setRunError] = useState<string | null>(null);
  const [modalRequest, setModalRequest] = useState<{ modal: QianjiProfileModal; nonce: number } | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addMenuRef = useRef<HTMLDivElement | null>(null);
  const selected = items.find(item => item.profile.qianjiId === selectedQianjiId) ?? null;
  const recoveryRequired = Boolean(runStatus?.unfinalized_operations?.hasUnfinalized);

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
    try { await startRun(chatRunRequest); }
    catch (err) { setRunError(err instanceof Error ? err.message : String(err)); }
    await refreshImmediately();
  };

  const sendBlocked = runStatus?.running ? 'Run 进行中，等本轮结束后可继续发送。' : null;

  useEffect(() => {
    if (!selectedQianjiId && items.length > 0 && items[0]) onSelectedQianji(items[0].profile.qianjiId);
  }, [items, onSelectedQianji, selectedQianjiId]);

  useEffect(() => {
    onSelectedPixel(selected?.currentBinding?.pixelId ?? null);
  }, [selected?.currentBinding?.pixelId, onSelectedPixel]);

  const runState = runStatus?.running ? `运行中 · ${runStatus.completed_rounds}/${runStatus.requested_rounds} 轮`
    : recoveryRequired ? '需要恢复处理' : runStatus?.result_status === 'FAILED' ? '上次运行失败' : '空闲';

  return (
    <div className="tianji-hall" data-testid="tianji-hall">
      <header className="hall-header">
        <div className="hall-brand"><span className="hall-mark">千</span><div><h1>{presentation?.hallName ?? '千机阁'}</h1><p>{presentation?.organizationName ?? 'EmergentInc 元胞会社'}</p></div></div>
        <div className="hall-run-summary"><span>第 {world?.round ?? runStatus?.current_round ?? 0} 轮</span><span className={runStatus?.running ? 'is-running' : recoveryRequired ? 'is-error' : ''}>{runState}</span></div>
        <div className="hall-navigation"><button className="btn btn-sm" type="button" onClick={onOpenEngine}>进入 {presentation?.sectionLabels?.engine ?? 'Engine'}</button></div>
      </header>

      {(qianjiError || worldError || runError) && <div className="hall-error" role="alert">{qianjiError || worldError || runError}</div>}
      {recoveryRequired && <p className="hall-warning">存在未决操作。请进入 Engine 的 Recovery 面板处理后再运行。</p>}

      <main className="hall-grid">
        <section className="hall-roster" aria-label="人物列表">
          <div className="hall-section-heading"><div><p className="qj-eyebrow">{presentation?.sectionLabels?.members ?? '人物'}</p><h2>千机名录</h2></div><span>{items.length} 位</span></div>
          {loading && items.length === 0 && <p className="qj-empty">正在读取人物…</p>}
          {!loading && !qianjiError && items.length === 0 && <p className="qj-empty">暂无人物，点击下方 + 招募第一位人物。</p>}
          <div className="qj-roster-list">{items.map(item => (
            <QianjiCard key={item.profile.qianjiId} item={item} selected={selectedQianjiId === item.profile.qianjiId}
              onSelect={selectPerson} onMenuAction={handleMenuAction} showMeetingAction={Boolean(onOpenMeeting)} />
          ))}
            <div className="qj-roster-add" ref={addMenuRef}>
              <button className="qj-add-button" type="button" aria-label="新建人物位" aria-haspopup="menu" aria-expanded={addMenuOpen} onClick={() => setAddMenuOpen(open => !open)}>+</button>
              {addMenuOpen && (
                <div className="qj-menu-popover qj-add-popover" role="menu" aria-label="新建菜单">
                  <button type="button" role="menuitem" onClick={() => { setAddMenuOpen(false); onOpenGacha?.(); }}>招募人物</button>
                  <button type="button" role="menuitem" onClick={() => { setAddMenuOpen(false); onOpenMeeting?.(); }}>发起会议</button>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="hall-detail-column">
          {selected ? <QianjiProfilePanel item={selected} modalRequest={modalRequest} onSent={handleSent} sendBlocked={sendBlocked}
            onRefresh={async () => { await refresh(); await refreshImmediately(); }} />
            : <div className="qj-panel-placeholder">选择一位人物查看详情。</div>}
        </section>

        <aside className="hall-side-column" aria-label="需要阁主决定">
          <ApprovalPanel />
        </aside>
      </main>
    </div>
  );
};
