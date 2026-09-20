import React from 'react';
import { Modal } from '../../components/Modal';

export interface FilePreviewProps {
  isOpen: boolean;
  title: string;
  content?: string;
  isLoading?: boolean;
  previewType?: 'text' | 'image' | 'binary';
  downloadUrl?: string;
  filename?: string;
  onClose: () => void;
  /** 可选：文档 Tab 模式（P1-3 合并文档入口） */
  docTabs?: { key: string; label: string }[];
  activeDocTab?: string;
  onSelectDocTab?: (key: string) => void;
}

export const FilePreview: React.FC<FilePreviewProps> = ({
  isOpen,
  title,
  content = '',
  isLoading = false,
  previewType = 'text',
  downloadUrl,
  filename,
  onClose,
  docTabs,
  activeDocTab,
  onSelectDocTab,
}) => {
  return (
    <Modal
      isOpen={isOpen}
      title={title}
      onClose={onClose}
      contentClassName="doc-modal-content"
      footer={
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', width: '100%' }}>
          {downloadUrl && (
            <a
              href={downloadUrl}
              download={filename || true}
              className="btn btn-primary"
              style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
            >
              下载原文件
            </a>
          )}
          <button className="btn btn-secondary" onClick={onClose}>
            关闭
          </button>
        </div>
      }
    >
      {docTabs && docTabs.length > 0 && (
        <div className="operation-tabs" role="tablist" aria-label="文档">
          {docTabs.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={activeDocTab === t.key}
              className={`btn btn-sm ${activeDocTab === t.key ? 'btn-primary' : ''}`}
              onClick={() => onSelectDocTab?.(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      {isLoading ? (
        <div style={{ color: 'var(--text-dim)', padding: '20px', textAlign: 'center' }}>
          正在加载内容...
        </div>
      ) : previewType === 'image' && downloadUrl ? (
        <div style={{ textAlign: 'center', padding: '16px', background: 'var(--bg-main)', borderRadius: '6px' }}>
          <img
            src={downloadUrl}
            alt={filename || '交付物图片预览'}
            style={{
              maxWidth: '100%',
              maxHeight: '60vh',
              objectFit: 'contain',
              borderRadius: '4px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            }}
          />
        </div>
      ) : previewType === 'binary' ? (
        <div
          style={{
            padding: '32px 20px',
            textAlign: 'center',
            background: 'var(--bg-main)',
            borderRadius: '6px',
            border: '1px solid var(--border-color)',
          }}
        >
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>📦</div>
          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-bright)', marginBottom: '8px' }}>
            {filename || '二进制交付物'}
          </div>
          <div style={{ color: 'var(--text-dim)', fontSize: '12px', marginBottom: '16px' }}>
            该文件为二进制或非纯文本格式，不支持直接在线纯文本预览。请直接下载原始文件查看。
          </div>
          {downloadUrl && (
            <a
              href={downloadUrl}
              download={filename || true}
              className="btn btn-primary"
              style={{ textDecoration: 'none', display: 'inline-block' }}
            >
              ⬇ 立即下载原始文件
            </a>
          )}
        </div>
      ) : (
        <pre className="doc-view-box">{content || '(空内容)'}</pre>
      )}
    </Modal>
  );
};

