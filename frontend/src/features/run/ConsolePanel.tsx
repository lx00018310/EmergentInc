import React, { useEffect, useRef, useState } from 'react';
import type { WorkspaceAuditDto, RunStatusDto } from '../../api/types';

export interface ConsoleMessage {
  id: string;
  type: 'system' | 'info' | 'success' | 'warn' | 'error';
  text: string;
  time: string;
}

export interface ConsolePanelProps {
  messages: ConsoleMessage[];
  audit: WorkspaceAuditDto | null;
  runStatus: RunStatusDto | null;
  onReconcile?: () => Promise<void>;
  hideRecoveryAlert?: boolean;
}

export const ConsolePanel: React.FC<ConsolePanelProps> = ({
  messages,
  audit,
  runStatus,
  onReconcile,
  hideRecoveryAlert = false,
}) => {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (boxRef.current) {
      boxRef.current.scrollTop = boxRef.current.scrollHeight;
    }
  }, [messages, expanded]);

  const isRecoveryRequired =
    !hideRecoveryAlert &&
    !runStatus?.running &&
    Boolean(runStatus?.unfinalized_operations);

  const blockReasons: string[] = [...(audit?.block_reasons ?? [])];
  if (blockReasons.length === 0 && runStatus?.unfinalized_operations) {
    const ops = runStatus.unfinalized_operations;
    if (ops.unsettledReservations?.length) {
      blockReasons.push(`未决预留：${ops.unsettledReservations.length} 笔`);
    }
    if (ops.unknownCalls?.length) {
      blockReasons.push(`结果未知调用：${ops.unknownCalls.length} 笔`);
    }
    if (ops.callingMessages?.length) {
      blockReasons.push(`未决消息：${ops.callingMessages.length} 条`);
    }
  }

  return (
    <div>
      {isRecoveryRequired && (
        <div className="owner-alert-container">
          <div
            className="alert-box"
            style={{
              borderLeft: '4px solid var(--accent-red)',
              border: '1px solid var(--accent-red)',
              background: 'rgba(207, 34, 46, 0.08)',
              padding: '10px',
              marginBottom: '8px',
              borderRadius: '4px',
            }}
          >
            <div
              className="alert-title"
              style={{ color: 'var(--accent-red)', fontWeight: 'bold', marginBottom: '4px' }}
            >
              启动受阻：需逐项审计决策 (PAUSED_RECOVERY_REQUIRED)
            </div>
            <div style={{ fontSize: '12px', lineHeight: 1.4 }}>
              系统检测到未决 Reservation 或中断调用事务，已保护性拦截启动：
              {blockReasons.length > 0 && (
                <ul style={{ paddingLeft: '18px', marginTop: '4px', marginBottom: '6px' }}>
                  {blockReasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
            </div>
            {onReconcile && (
              <div style={{ marginTop: '8px' }}>
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  style={{ fontWeight: 'bold', cursor: 'pointer' }}
                  onClick={() => onReconcile()}
                >
                  查看未决项 (Review)
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {!runStatus?.running && runStatus?.result_status === 'FAILED' && <p role="alert">
        {runStatus.result_status}: {runStatus.stop_reason} {runStatus.error_code} {runStatus.error_summary ?? runStatus.last_error}
      </p>}
      <div className="console-toggle" onClick={() => setExpanded((v) => !v)} role="button">
        <span>控制台日志 ({messages.length})</span>
        <span className="text-muted">{expanded ? '收起 ▲' : '展开 ▼'}</span>
      </div>
      {expanded ? (
        <div className="console-box" ref={boxRef}>
          {messages.map((m) => (
            <div key={m.id} className={`console-line ${m.type}-line`}>
              <span style={{ opacity: 0.6, marginRight: '6px' }}>[{m.time}]</span>
              {m.text}
            </div>
          ))}
        </div>
      ) : (
        messages.length > 0 && (
          <div className="console-box console-collapsed">
            {(() => {
              const last = messages[messages.length - 1]!;
              return (
                <div className={`console-line ${last.type}-line`}>
                  <span style={{ opacity: 0.6, marginRight: '6px' }}>[{last.time}]</span>
                  {last.text}
                </div>
              );
            })()}
          </div>
        )
      )}
    </div>
  );
};
