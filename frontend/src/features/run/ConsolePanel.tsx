import React, { useEffect, useRef } from 'react';
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
}

export const ConsolePanel: React.FC<ConsolePanelProps> = ({ messages, audit, runStatus }) => {
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (boxRef.current) {
      boxRef.current.scrollTop = boxRef.current.scrollHeight;
    }
  }, [messages]);

  const isRecoveryRequired =
    Boolean(audit?.recovery_required) || runStatus?.result_status === 'RECOVERY_REQUIRED';
  const blockReasons = audit?.block_reasons ?? [];

  return (
    <div>
      {isRecoveryRequired && (
        <div className="owner-alert-container">
          <div
            className="alert-box"
            style={{
              borderLeft: '4px solid var(--accent-red)',
              border: '1px solid var(--accent-red)',
              background: '#2d1f24',
              padding: '10px',
              marginBottom: '8px',
              borderRadius: '4px',
            }}
          >
            <div
              className="alert-title"
              style={{ color: '#fc8181', fontWeight: 'bold', marginBottom: '4px' }}
            >
              🚨 启动受阻：需恢复审计介入 (RECOVERY_REQUIRED)
            </div>
            <div style={{ fontSize: '12px', color: '#e2e8f0', lineHeight: 1.4 }}>
              系统检测到未决 Reservation 或中断事务，已保护性拦截启动：
              {blockReasons.length > 0 && (
                <ul style={{ paddingLeft: '18px', marginTop: '4px' }}>
                  {blockReasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="console-box" ref={boxRef}>
        {messages.map((m) => (
          <div key={m.id} className={`console-line ${m.type}-line`}>
            <span style={{ opacity: 0.6, marginRight: '6px' }}>[{m.time}]</span>
            {m.text}
          </div>
        ))}
      </div>
    </div>
  );
};
