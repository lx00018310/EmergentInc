import React from 'react';

export interface ErrorNoticeProps {
  title?: string;
  message: string;
  severity?: 'error' | 'warning';
  onDismiss?: () => void;
}

export const ErrorNotice: React.FC<ErrorNoticeProps> = ({
  title = '错误提示',
  message,
  severity = 'error',
  onDismiss,
}) => {
  if (!message) return null;

  const isError = severity === 'error';
  const borderCol = isError ? 'var(--accent-red)' : 'var(--accent-yellow)';
  const titleCol = isError ? 'var(--accent-red)' : 'var(--accent-yellow)';

  return (
    <div
      style={{
        backgroundColor: isError ? 'rgba(248, 81, 73, 0.15)' : 'rgba(210, 153, 34, 0.15)',
        borderLeft: `4px solid ${borderCol}`,
        border: `1px solid ${borderCol}`,
        borderRadius: '4px',
        padding: '10px 12px',
        marginBottom: '10px',
        position: 'relative',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ color: titleCol, fontWeight: 600, fontSize: '12px' }}>{title}</div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-dim)',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            &times;
          </button>
        )}
      </div>
      <div
        style={{
          fontSize: '12px',
          color: 'var(--text-bright)',
          marginTop: '4px',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          lineHeight: 1.4,
        }}
      >
        {message}
      </div>
    </div>
  );
};
