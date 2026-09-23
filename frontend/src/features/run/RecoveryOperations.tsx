import { useState } from 'react';
import type { RunStatusDto } from '../../api/types';
import { fetchRunStatus, resolveRecovery, type RecoveryKind, type RecoveryDecision } from '../../api/run';

type RecoveryItem = { kind: RecoveryKind; id: string; status?: string };

function findPendingItem(status: RunStatusDto, item: RecoveryItem): RecoveryItem | null {
  const ops = status.unfinalized_operations;
  if (!ops) return null;
  switch (item.kind) {
    case 'model':
      return [...(ops.unsettledReservations ?? []), ...(ops.unknownCalls ?? [])].some(call => call.callId === item.id) ? item : null;
    case 'tool':
      return ops.startedToolExecutions?.includes(item.id) ? item : null;
    case 'run':
      return ops.pendingRuns?.includes(item.id) ? item : null;
    case 'message': {
      const message = ops.callingMessages?.find(msg => msg.messageId === item.id);
      return message ? { ...item, status: message.status } : null;
    }
  }
}

export function RecoveryOperations({
  status,
  onRefresh,
  onClose,
}: {
  status: RunStatusDto;
  onRefresh: () => Promise<void>;
  onClose?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');

  const ops = status.unfinalized_operations;

  // 整理拦截原因概要
  const summaryLines: string[] = [];
  if (ops?.unsettledReservations?.length) {
    summaryLines.push(`UNSETTLED_RESERVATIONS: ${ops.unsettledReservations.length} 笔未决预留`);
  }
  if (ops?.unknownCalls?.length) {
    summaryLines.push(`UNKNOWN_CALLS: ${ops.unknownCalls.length} 笔未知结果调用`);
  }
  if (ops?.callingMessages?.length) {
    summaryLines.push(`CALLING_MESSAGES: ${ops.callingMessages.length} 条未决消息`);
  }
  if (ops?.startedToolExecutions?.length) {
    summaryLines.push(`STARTED_TOOLS: ${ops.startedToolExecutions.length} 个未完结工具执行`);
  }
  if (ops?.pendingRuns?.length) {
    summaryLines.push(`PENDING_RUNS: ${ops.pendingRuns.length} 个未决运行`);
  }
  if (summaryLines.length === 0 && status.stop_reason) {
    summaryLines.push(`状态原因: ${status.stop_reason}`);
  }

  // 整理待审批项目
  const items = new Map<string, RecoveryItem>();
  for (const call of [...(ops?.unsettledReservations ?? []), ...(ops?.unknownCalls ?? [])]) {
    items.set(`model:${call.callId}`, { kind: 'model', id: call.callId });
  }
  for (const id of ops?.startedToolExecutions ?? []) {
    items.set(`tool:${id}`, { kind: 'tool', id });
  }
  for (const id of ops?.pendingRuns ?? []) {
    items.set(`run:${id}`, { kind: 'run', id });
  }
  for (const msg of ops?.callingMessages ?? []) {
    items.set(`message:${msg.messageId}`, { kind: 'message', id: msg.messageId, status: msg.status });
  }

  // 单项决议：通过或拒绝
  const resolveItem = async (item: RecoveryItem, action: 'approve' | 'reject') => {
    const { kind, id } = item;
    if (kind === 'message' && item.status === 'AWAITING_SETTLEMENT' && action === 'approve') {
      throw new Error('该消息等待模型结算，无法确认未计费后重试；请先处理关联模型调用，或选择放弃消息。');
    }
    let decision: RecoveryDecision;
    if (action === 'approve') {
      decision = kind === 'tool' || kind === 'run' ? 'acknowledge' : 'confirm_not_billed';
    } else {
      decision = kind === 'run' ? 'acknowledge' : 'abandon';
    }

    await resolveRecovery({
      kind,
      id,
      decision,
      reason: reason.trim(), // 理由选填，留空由系统自动记录标准审计说明
    });
  };

  const handleResolveSingle = async (kind: RecoveryKind, id: string, action: 'approve' | 'reject') => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await resolveItem(items.get(`${kind}:${id}`) ?? { kind, id }, action);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // 全部通过 / 全部拒绝
  const handleResolveAll = async (action: 'approve' | 'reject') => {
    if (busy || items.size === 0) return;
    setBusy(true);
    setError('');
    try {
      for (const item of items.values()) {
        const current = findPendingItem(await fetchRunStatus(), item);
        if (current) await resolveItem(current, action);
      }
      await onRefresh();
      setReason('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      try {
        await onRefresh();
      } catch {
        // 保留导致批量决议中断的原始错误。
      }
    } finally {
      setBusy(false);
    }
  };

  // 提取用于大白话翻译的元数据
  const primaryPixelId =
    ops?.unsettledReservations?.[0]?.pixelId ||
    ops?.unknownCalls?.[0]?.pixelId ||
    ops?.callingMessages?.[0]?.recipient ||
    null;
  const primaryModel = ops?.unknownCalls?.[0]?.model || null;
  const primaryAmount = ops?.unsettledReservations?.[0]?.amount || 0;
  const primaryMsg = ops?.callingMessages?.[0];
  const primaryMsgSender = primaryMsg?.sender || null;
  const primaryMsgRecipient = primaryMsg?.recipient || null;
  const primaryMsgSnippet = primaryMsg?.contentSnippet || '';

  // 整理直白易懂的事件起因解读
  let errorReasonText = '网络连接超时或远端接口未在规定时间内回复';
  if (status.error_code === 'UND_ERR_SOCKET') {
    errorReasonText = '与大模型 API 的网络 Socket 连接意外断开 (UND_ERR_SOCKET，等待超过 2 分钟未收到响应)';
  } else if (status.error_code === 'REQUEST_TIMEOUT') {
    errorReasonText = '大模型调用超时 (超过 120 秒未返回数据)';
  } else if (status.error_summary) {
    errorReasonText = status.error_summary;
  }

  return (
    <div
      role="dialog"
      aria-label="逐项恢复决策"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(15, 23, 42, 0.45)',
        backdropFilter: 'blur(3px)',
        WebkitBackdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        padding: '16px',
        pointerEvents: 'auto',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && onClose) {
          onClose();
        }
      }}
    >
      <div
        className="alert-box"
        style={{
          width: '640px',
          maxWidth: '96%',
          maxHeight: '92%',
          overflowY: 'auto',
          background: 'var(--bg-card)',
          borderRadius: '8px',
          boxShadow: '0 16px 40px rgba(0, 0, 0, 0.28), 0 0 0 1px rgba(207, 34, 46, 0.3)',
          borderLeft: '5px solid var(--accent-red)',
          padding: '16px 18px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '10px',
            borderBottom: '1px solid rgba(0,0,0,0.08)',
            paddingBottom: '8px',
          }}
        >
          <div
            className="alert-title"
            style={{
              color: 'var(--accent-red)',
              fontWeight: 'bold',
              fontSize: '14px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>⚠️</span> 启动受阻：需逐项审计决策 (PAUSED_RECOVERY_REQUIRED)
          </div>
          {onClose && (
            <button
              type="button"
              className="btn-close"
              style={{
                background: 'transparent',
                border: 'none',
                fontSize: '20px',
                cursor: 'pointer',
                color: 'var(--text-dim)',
                lineHeight: 1,
                padding: '2px 8px',
              }}
              onClick={onClose}
              title="暂缓决策（最小化至工具栏）"
            >
              &times;
            </button>
          )}
        </div>

        {/* 1. 白话事件解读卡片 */}
        <div
          style={{
            background: 'rgba(255, 255, 255, 0.95)',
            border: '1px solid rgba(207, 34, 46, 0.25)',
            borderRadius: '6px',
            padding: '10px 12px',
            marginBottom: '10px',
            fontSize: '12px',
            color: '#111111',
            lineHeight: 1.6,
          }}
        >
          <div style={{ fontWeight: 'bold', color: 'var(--accent-red)', marginBottom: '4px' }}>
            📌 【事件简述：为什么需要您审批？】
          </div>
          <div>
            上一轮运行中，元胞 <strong>{primaryPixelId ? `[${primaryPixelId}]` : '智能体'}</strong> 调用大模型
            {primaryModel ? ` (${primaryModel}) ` : ' '}时发生了
            <strong style={{ color: 'var(--accent-red)' }}> {errorReasonText} </strong>
            。系统无法确认大模型是否已实际扣费，为<strong>防止重复扣款与数据混乱</strong>，已保护性拦截启动，由您人工决策后续处置。
          </div>
          {primaryAmount > 0 && (
            <div style={{ marginTop: '4px' }}>
              • <strong>暂扣冻结额度</strong>：本次调用预留了 <code>{primaryAmount} Tokens</code>
            </div>
          )}
          {primaryMsgSnippet && (
            <div style={{ marginTop: '4px', wordBreak: 'break-all' }}>
              • <strong>关联元胞消息</strong>：
              {primaryMsgSender ? <code>{primaryMsgSender} → {primaryMsgRecipient}</code> : ''}
              {` “${primaryMsgSnippet}”`}
            </div>
          )}
        </div>

        {/* 2. 审批决策指南 (同意什么 vs 拒绝什么) */}
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid #e2e8f0',
            borderRadius: '6px',
            padding: '10px 12px',
            marginBottom: '10px',
            fontSize: '12px',
            color: '#111111',
            lineHeight: 1.5,
          }}
        >
          <div style={{ fontWeight: 'bold', marginBottom: '6px' }}>👉 【审批含义：同意什么 vs 拒绝什么？】</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div>
              <span className="badge badge-primary" style={{ marginRight: '6px', padding: '2px 6px', fontWeight: 'bold' }}>
                通过 (推荐)
              </span>
              <strong>安全退款并重新排队</strong>：代表您确认“大模型没有给出有效回复（或未产生计费）”。系统将
              <strong>立即退还</strong>预留的 Tokens 到元胞账户，并将该消息<strong>重新放回就绪队列</strong>，后续启动时将自动重新呼叫。
            </div>
            <div>
              <span className="badge badge-danger" style={{ marginRight: '6px', padding: '2px 6px', fontWeight: 'bold' }}>
                拒绝
              </span>
              <strong>彻底放弃此任务</strong>：代表您决定“作废这次大模型调用，不要再试了”。系统将
              <strong>丢弃该消息</strong>，跳过本次处理，防止产生重复副作用。
            </div>
          </div>
        </div>

        {/* 3. 理由/备注输入框（选填） */}
        <div style={{ marginBottom: '10px' }}>
          <label
            htmlFor="recovery-reason"
            style={{
              display: 'block',
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--text-main)',
              marginBottom: '4px',
            }}
          >
            核实依据 / 理由 (选填)
          </label>
          <input
            id="recovery-reason"
            style={{
              width: '100%',
              padding: '6px 8px',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              fontSize: '12px',
              color: 'var(--text-main)',
              background: 'var(--bg-card)',
            }}
            placeholder="选填，留空将自动记录为“操作人审批通过/拒绝”"
            value={reason}
            disabled={busy}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        {/* 4. 顶部一键快捷操作 */}
        {items.size > 0 && (
          <div
            style={{
              display: 'flex',
              gap: '8px',
              marginBottom: '10px',
              alignItems: 'center',
              borderBottom: '1px solid rgba(0,0,0,0.08)',
              paddingBottom: '8px',
            }}
          >
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>一键批量决策:</span>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={busy}
              onClick={() => void handleResolveAll('approve')}
            >
              全部通过
            </button>
            <button
              type="button"
              className="btn btn-sm btn-danger"
              disabled={busy}
              onClick={() => void handleResolveAll('reject')}
            >
              全部拒绝
            </button>
            <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
              (点击“全部通过”将退还额度并重试未决项)
            </span>
          </div>
        )}

        {error && (
          <p role="alert" style={{ color: 'var(--accent-red)', fontSize: '12px', marginBottom: '8px' }}>
            {error}
          </p>
        )}

        {/* 5. 逐项待办列表 */}
        {items.size > 0 ? (
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            {[...items.values()].map(({ kind, id, status: itemStatus }) => {
              let label = '待决项目';
              let hint = '';
              if (kind === 'model') {
                label = '🤖 大模型调用';
                hint = `预留 ${primaryAmount || ''} Tokens 审核：点击【通过】退款并重试，点击【拒绝】放弃调用`;
              } else if (kind === 'message') {
                label = '✉️ 元胞消息';
                hint = itemStatus === 'AWAITING_SETTLEMENT'
                  ? '等待模型结算；不能按未计费重试，可选择放弃'
                  : primaryMsgSnippet ? `“${primaryMsgSnippet.slice(0, 45)}…”` : '点击【通过】重新排队，点击【拒绝】丢弃';
              } else if (kind === 'tool') {
                label = '🛠️ 工具执行';
                hint = '未完结副作用安全结案';
              } else if (kind === 'run') {
                label = '🔄 运行任务';
                hint = '中断批次安全结案';
              }

              return (
                <li
                  key={`${kind}:${id}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 10px',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '4px',
                    fontSize: '12px',
                    color: 'var(--text-main)',
                  }}
                >
                  <div style={{ marginRight: '8px', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <b style={{ color: 'var(--accent-blue)', flexShrink: 0 }}>{label}:</b>
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          wordBreak: 'break-all',
                          fontSize: '11px',
                          color: 'var(--text-dim)',
                        }}
                      >
                        {id}
                      </span>
                    </div>
                    {hint && (
                      <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '2px' }}>
                        {hint}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                    <button
                      type="button"
                      className="btn btn-xs btn-primary"
                      disabled={busy || (kind === 'message' && itemStatus === 'AWAITING_SETTLEMENT')}
                      onClick={() => void handleResolveSingle(kind, id, 'approve')}
                    >
                      通过
                    </button>
                    <button
                      type="button"
                      className="btn btn-xs btn-danger"
                      disabled={busy}
                      onClick={() => void handleResolveSingle(kind, id, 'reject')}
                    >
                      拒绝
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p style={{ fontSize: '12px', color: 'var(--text-main)' }}>
            未提供可决策操作 ID；请保留现场并检查未决消息。
          </p>
        )}
      </div>
    </div>
  );
}
