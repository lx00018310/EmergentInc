import React, { useState, useEffect } from 'react';
import { Modal } from '../../components/Modal';
import { fetchPixelArtifacts, getArtifactDownloadUrl } from '../../api/files';
import type { PixelArtifactsResponseDto } from '../../api/types';

export interface ArtifactBrowserProps {
  isOpen: boolean;
  pixelId: string | null;
  onClose: () => void;
  onPreviewFile: (title: string, filename: string) => void;
  onLogMessage: (type: 'info' | 'success' | 'warn' | 'error', text: string) => void;
}

export const ArtifactBrowser: React.FC<ArtifactBrowserProps> = ({
  isOpen,
  pixelId,
  onClose,
  onPreviewFile,
  onLogMessage,
}) => {
  const [data, setData] = useState<PixelArtifactsResponseDto | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!isOpen || !pixelId) return;
    setIsLoading(true);
    fetchPixelArtifacts(pixelId)
      .then((res) => {
        setData(res);
      })
      .catch((err) => {
        onLogMessage('error', `[ARTIFACTS LOAD FAILED] ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [isOpen, pixelId, onLogMessage]);

  const rawArtifacts = data?.artifacts || [];
  const items = rawArtifacts.map((a) => {
    if (typeof a === 'string') {
      return { filename: a, size_bytes: 0 };
    }
    return a;
  });

  return (
    <Modal
      isOpen={isOpen}
      title={`元胞 ${pixelId || ''} 交付物列表`}
      onClose={onClose}
      contentClassName="form-modal-content"
      footer={
        <button className="btn btn-secondary" onClick={onClose}>
          关闭
        </button>
      }
    >
      {isLoading ? (
        <div style={{ color: 'var(--text-dim)', padding: '20px', textAlign: 'center' }}>
          正在加载交付物列表...
        </div>
      ) : items.length === 0 ? (
        <div style={{ color: 'var(--text-dim)', padding: '20px', textAlign: 'center' }}>
          当前元胞暂无隔离交付物文件。
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>文件名</th>
              <th>大小</th>
              <th style={{ textAlign: 'right' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.filename}>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{it.filename}</td>
                <td>{it.size_bytes ? `${it.size_bytes} B` : '-'}</td>
                <td style={{ textAlign: 'right' }}>
                  <button
                    className="btn btn-xs"
                    style={{ marginRight: '6px' }}
                    onClick={() => onPreviewFile(`交付物: ${it.filename}`, it.filename)}
                  >
                    查看
                  </button>
                  {pixelId && (
                    <a
                      href={getArtifactDownloadUrl(pixelId, it.filename)}
                      download={it.filename}
                      className="btn btn-xs btn-secondary"
                      style={{ textDecoration: 'none', display: 'inline-block' }}
                    >
                      下载
                    </a>
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
