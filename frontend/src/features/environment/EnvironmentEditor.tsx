import React, { useState, useEffect } from 'react';
import { Modal } from '../../components/Modal';
import { fetchEnvironment, updateEnvironment } from '../../api/prompts';

export interface EnvironmentEditorProps {
  isOpen: boolean;
  onClose: () => void;
  onLogMessage: (type: 'info' | 'success' | 'warn' | 'error', text: string) => void;
}

export const EnvironmentEditor: React.FC<EnvironmentEditorProps> = ({
  isOpen,
  onClose,
  onLogMessage,
}) => {
  const [content, setContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  useEffect(() => {
    if (!isOpen) return;
    setIsLoading(true);
    fetchEnvironment()
      .then((res) => {
        setContent(res.content || '');
      })
      .catch((err) => {
        onLogMessage('error', `[ENV LOAD FAILED] ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [isOpen, onLogMessage]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await updateEnvironment(content);
      onLogMessage('success', `[ENV UPDATED] 外部环境已更新，字节数: ${res.length}`);
      onClose();
    } catch (err) {
      onLogMessage('error', `[ENV SAVE FAILED] ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      title="外部环境 (environment.md)"
      onClose={onClose}
      contentClassName="form-modal-content"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={isSaving}>
            取消
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={isSaving || isLoading}>
            {isSaving ? '保存中...' : '保存更新'}
          </button>
        </>
      }
    >
      <p className="form-hint">
        environment.md 全局存在但对元胞默认隐形，元胞必须主动声明读取才可见。您可以在此更新外部市场事实与真实业务要求：
      </p>
      {isLoading ? (
        <div style={{ color: 'var(--text-dim)', padding: '20px', textAlign: 'center' }}>
          正在加载外部环境...
        </div>
      ) : (
        <textarea
          className="modal-textarea"
          rows={12}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="可输入全局业务环境设定..."
        />
      )}
    </Modal>
  );
};
