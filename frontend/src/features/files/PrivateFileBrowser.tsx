import React, { useState, useEffect } from 'react';
import { Modal } from '../../components/Modal';
import { fetchPrivateFiles, getPrivateImagePreviewUrl } from '../../api/files';
import type { PrivateFileItemDto } from '../../api/types';

export interface PrivateFileBrowserProps {
  isOpen: boolean;
  onClose: () => void;
  onLogMessage: (type: 'info' | 'success' | 'warn' | 'error', text: string) => void;
}

export const PrivateFileBrowser: React.FC<PrivateFileBrowserProps> = ({
  isOpen,
  onClose,
  onLogMessage,
}) => {
  const [currentPath, setCurrentPath] = useState<string>('');
  const [files, setFiles] = useState<PrivateFileItemDto[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [previewImageSrc, setPreviewImageSrc] = useState<string | null>(null);

  const loadDirectory = (subPath: string) => {
    setIsLoading(true);
    fetchPrivateFiles(subPath)
      .then((res) => {
        setFiles(res.files || []);
        setCurrentPath(res.base_path || '');
      })
      .catch((err) => {
        onLogMessage('error', `[PRIVATE LOAD FAILED] ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => {
        setIsLoading(false);
      });
  };

  useEffect(() => {
    if (isOpen) {
      loadDirectory('');
      setPreviewImageSrc(null);
    }
  }, [isOpen]);

  const isImage = (name: string) => {
    const ext = name.split('.').pop()?.toLowerCase();
    return ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(ext || '');
  };

  return (
    <Modal
      isOpen={isOpen}
      title="workspace/private 私有资料管理"
      onClose={onClose}
      contentClassName="doc-modal-content"
      footer={
        <button className="btn btn-secondary" onClick={onClose}>
          关闭
        </button>
      }
    >
      <div style={{ marginBottom: '10px', display: 'flex', gap: '8px', alignItems: 'center' }}>
        <button
          className="btn btn-sm"
          disabled={!currentPath || isLoading}
          onClick={() => {
            const parts = currentPath.split('/').filter(Boolean);
            parts.pop();
            loadDirectory(parts.join('/'));
          }}
        >
          返回上级
        </button>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-dim)' }}>
          当前路径: workspace/private/{currentPath || ''}
        </span>
      </div>

      {previewImageSrc ? (
        <div style={{ padding: '10px', textAlign: 'center' }}>
          <div style={{ marginBottom: '8px' }}>
            <button className="btn btn-xs" onClick={() => setPreviewImageSrc(null)}>
              返回列表
            </button>
          </div>
          <img
            src={previewImageSrc}
            alt="Private Preview"
            style={{
              maxWidth: '100%',
              maxHeight: '55vh',
              borderRadius: '4px',
              border: '1px solid var(--border-color)',
            }}
          />
        </div>
      ) : isLoading ? (
        <div style={{ color: 'var(--text-dim)', padding: '20px', textAlign: 'center' }}>
          正在加载私有文件目录...
        </div>
      ) : files.length === 0 ? (
        <div style={{ color: 'var(--text-dim)', padding: '20px', textAlign: 'center' }}>
          私有目录下暂无文件。
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>名称</th>
              <th>类型</th>
              <th>大小</th>
              <th>安全状态</th>
              <th style={{ textAlign: 'right' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {files.map((file) => (
              <tr key={file.path}>
                <td style={{ fontFamily: 'var(--font-mono)' }}>
                  {file.type === 'directory' ? `📁 ${file.name}` : `📄 ${file.name}`}
                </td>
                <td>{file.type}</td>
                <td>{file.type === 'file' ? `${file.size_bytes} B` : '-'}</td>
                <td>
                  {file.is_sensitive ? (
                    <span style={{ color: 'var(--accent-yellow)', fontWeight: 600 }}>
                      🔒 凭据受限保护
                    </span>
                  ) : (
                    <span style={{ color: 'var(--text-dim)' }}>普通材料</span>
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {file.type === 'directory' ? (
                    <button
                      className="btn btn-xs"
                      onClick={() => loadDirectory(file.path)}
                    >
                      打开
                    </button>
                  ) : isImage(file.name) && !file.is_sensitive ? (
                    <button
                      className="btn btn-xs btn-primary"
                      onClick={() => setPreviewImageSrc(getPrivateImagePreviewUrl(file.path))}
                    >
                      预览图片
                    </button>
                  ) : (
                    <span style={{ color: 'var(--text-dim)', fontSize: '11px' }}>受保护/外部</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
};
