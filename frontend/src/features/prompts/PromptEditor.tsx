import React, { useState, useEffect } from 'react';
import type { PromptDto } from '../../api/types';

export interface PromptEditorProps {
  cardId: string;
  title: string;
  hint: string;
  placeholder: string;
  rows?: number;
  promptData: PromptDto | null;
  isRunning: boolean;
  onSave: (content: string) => Promise<void>;
  onClear: () => Promise<void>;
}

export const PromptEditor: React.FC<PromptEditorProps> = ({
  cardId,
  title,
  hint,
  placeholder,
  rows = 5,
  promptData,
  isRunning,
  onSave,
  onClear,
}) => {
  const [draft, setDraft] = useState<string>('');
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // 当外部 promptData 首次加载或 revision 变更且非 dirty 时同步
  useEffect(() => {
    if (promptData && !isDirty) {
      setDraft(promptData.content || '');
    }
  }, [promptData, isDirty]);

  const charCount = draft.length;
  const isOverLimit = charCount > 12000;
  const isActive = Boolean(promptData?.active);

  const handleSave = async () => {
    if (isSubmitting || isRunning || isOverLimit) return;
    setIsSubmitting(true);
    setLocalError(null);
    try {
      await onSave(draft);
      setIsDirty(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setLocalError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClear = async () => {
    if (isSubmitting || isRunning) return;
    setIsSubmitting(true);
    setLocalError(null);
    try {
      await onClear();
      setDraft('');
      setIsDirty(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setLocalError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="panel-card" id={cardId}>
      <div className="panel-header">
        <h2>{title}</h2>
        <span
          className="badge"
          style={{
            borderColor: isActive ? 'var(--accent-green)' : 'var(--border-color)',
            color: isActive ? 'var(--accent-green)' : 'var(--text-dim)',
          }}
        >
          {isActive ? '生效中' : '已关闭'}
        </span>
      </div>
      <p className="form-hint" style={{ marginBottom: '8px', fontSize: '12px' }}>
        {hint}
      </p>

      <textarea
        className="modal-textarea"
        rows={rows}
        maxLength={12500}
        placeholder={placeholder}
        value={draft}
        disabled={isRunning || isSubmitting}
        onChange={(e) => {
          setDraft(e.target.value);
          setIsDirty(true);
          setLocalError(null);
        }}
      />

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          margin: '8px 0',
          fontSize: '12px',
        }}
      >
        <span>
          Revision: <b style={{ color: 'var(--text-bright)' }}>{promptData?.revision ?? '-'}</b>
          {promptData?.hash && (
            <>
              {' '}| Hash: <code style={{ color: 'var(--accent-blue)' }}>{promptData.hash}</code>
            </>
          )}
          {isDirty && <span style={{ color: 'var(--accent-yellow)', marginLeft: '6px' }}>(未保存)</span>}
        </span>
        <span style={{ color: isOverLimit ? 'var(--accent-red)' : 'var(--text-main)' }}>
          {charCount} / 12000
        </span>
      </div>

      {localError && (
        <div style={{ color: 'var(--accent-red)', fontSize: '11px', marginBottom: '6px' }}>
          {localError}
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
        <button
          className="btn btn-sm btn-primary"
          disabled={isRunning || isSubmitting || isOverLimit || (!isDirty && draft === promptData?.content)}
          onClick={handleSave}
        >
          {isSubmitting ? '保存中...' : '保存提示词'}
        </button>
        <button
          className="btn btn-sm btn-secondary"
          disabled={isRunning || isSubmitting || (!isActive && !draft)}
          onClick={handleClear}
        >
          清空并关闭
        </button>
      </div>
    </div>
  );
};
