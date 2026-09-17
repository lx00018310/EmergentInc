import React from 'react';
import { Modal } from '../../components/Modal';

export interface FilePreviewProps {
  isOpen: boolean;
  title: string;
  content: string;
  isLoading?: boolean;
  onClose: () => void;
}

export const FilePreview: React.FC<FilePreviewProps> = ({
  isOpen,
  title,
  content,
  isLoading = false,
  onClose,
}) => {
  return (
    <Modal
      isOpen={isOpen}
      title={title}
      onClose={onClose}
      contentClassName="doc-modal-content"
      footer={
        <button className="btn btn-secondary" onClick={onClose}>
          关闭
        </button>
      }
    >
      {isLoading ? (
        <div style={{ color: 'var(--text-dim)', padding: '20px', textAlign: 'center' }}>
          正在加载文档内容...
        </div>
      ) : (
        <pre className="doc-view-box">{content || '(空内容)'}</pre>
      )}
    </Modal>
  );
};
