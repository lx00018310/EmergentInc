import React, { useState, useEffect } from 'react';
import { Modal } from '../../components/Modal';
import { fetchToolsCatalog } from '../../api/tools';
import type { ToolSpecDto } from '../../api/types';

export interface ToolCatalogProps {
  isOpen: boolean;
  onClose: () => void;
  onLogMessage: (type: 'info' | 'success' | 'warn' | 'error', text: string) => void;
}

export const ToolCatalog: React.FC<ToolCatalogProps> = ({
  isOpen,
  onClose,
  onLogMessage,
}) => {
  const [tools, setTools] = useState<ToolSpecDto[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [selectedSchema, setSelectedSchema] = useState<{ name: string; schema: Record<string, unknown> } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setIsLoading(true);
    fetchToolsCatalog()
      .then((res) => {
        setTools(res.tools || []);
      })
      .catch((err) => {
        onLogMessage('error', `[TOOLS CATALOG LOAD FAILED] ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [isOpen, onLogMessage]);

  return (
    <Modal
      isOpen={isOpen}
      title="只读系统工具目录 (Tools Catalog)"
      onClose={onClose}
      contentClassName="doc-modal-content"
      footer={
        <button className="btn btn-secondary" onClick={onClose}>
          关闭
        </button>
      }
    >
      {selectedSchema ? (
        <div>
          <div style={{ marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 600, color: 'var(--text-bright)' }}>
              工具参数 Schema: <code>{selectedSchema.name}</code>
            </span>
            <button className="btn btn-xs" onClick={() => setSelectedSchema(null)}>
              返回工具列表
            </button>
          </div>
          <pre className="doc-view-box">{JSON.stringify(selectedSchema.schema, null, 2)}</pre>
        </div>
      ) : isLoading ? (
        <div style={{ color: 'var(--text-dim)', padding: '20px', textAlign: 'center' }}>
          正在加载工具目录...
        </div>
      ) : tools.length === 0 ? (
        <div style={{ color: 'var(--text-dim)', padding: '20px', textAlign: 'center' }}>
          当前未注册任何可用工具。
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>工具名称</th>
              <th>效应 (Effect)</th>
              <th>描述</th>
              <th>超时 (秒)</th>
              <th>状态</th>
              <th style={{ textAlign: 'right' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {tools.map((t) => (
              <tr key={t.name}>
                <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--accent-blue)' }}>
                  {t.name}
                </td>
                <td>
                  <span
                    className="badge"
                    style={{
                      color:
                        t.effect === 'read'
                          ? 'var(--accent-green)'
                          : t.effect === 'modify'
                          ? 'var(--accent-yellow)'
                          : 'var(--accent-purple)',
                    }}
                  >
                    {t.effect}
                  </span>
                </td>
                <td style={{ maxWidth: '300px', lineHeight: 1.4 }}>{t.description}</td>
                <td>{t.timeout_seconds}s</td>
                <td>
                  <span style={{ color: t.enabled ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                    {t.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button
                    className="btn btn-xs"
                    onClick={() => setSelectedSchema({ name: t.name, schema: t.input_schema })}
                  >
                    查看参数
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
};
