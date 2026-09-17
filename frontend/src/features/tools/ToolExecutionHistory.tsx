import React, { useState, useEffect } from 'react';
import { Modal } from '../../components/Modal';
import { fetchToolExecutions } from '../../api/tools';
import type { ToolExecutionDto } from '../../api/types';

export interface ToolExecutionHistoryProps {
  isOpen: boolean;
  onClose: () => void;
  onLogMessage: (type: 'info' | 'success' | 'warn' | 'error', text: string) => void;
}

export const ToolExecutionHistory: React.FC<ToolExecutionHistoryProps> = ({
  isOpen,
  onClose,
  onLogMessage,
}) => {
  const [executions, setExecutions] = useState<ToolExecutionDto[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [selectedExec, setSelectedExec] = useState<ToolExecutionDto | null>(null);

  const loadData = () => {
    setIsLoading(true);
    fetchToolExecutions({ limit: 100 })
      .then((res) => {
        setExecutions(res.executions || []);
      })
      .catch((err) => {
        onLogMessage('error', `[EXECUTIONS LOAD FAILED] ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => {
        setIsLoading(false);
      });
  };

  useEffect(() => {
    if (isOpen) {
      loadData();
      setSelectedExec(null);
    }
  }, [isOpen]);

  const getStatusBadge = (status: string) => {
    let color = 'var(--text-dim)';
    if (status === 'SUCCESS') color = 'var(--accent-green)';
    else if (status === 'FAILED') color = 'var(--accent-red)';
    else if (status === 'UNKNOWN') color = 'var(--accent-yellow)';

    return (
      <span className="badge" style={{ color, borderColor: color }}>
        {status}
      </span>
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      title="持久化工具执行记录 (Tool Executions)"
      onClose={onClose}
      contentClassName="doc-modal-content"
      footer={
        <div style={{ display: 'flex', gap: '8px', width: '100%', justifyContent: 'space-between' }}>
          <button className="btn btn-sm btn-secondary" onClick={loadData} disabled={isLoading}>
            刷新记录
          </button>
          <button className="btn btn-secondary" onClick={onClose}>
            关闭
          </button>
        </div>
      }
    >
      {selectedExec ? (
        <div>
          <div style={{ marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 600, color: 'var(--text-bright)' }}>
              回执明细: <code>{selectedExec.operation_id}</code> ({selectedExec.tool})
            </span>
            <button className="btn btn-xs" onClick={() => setSelectedExec(null)}>
              返回列表
            </button>
          </div>

          {selectedExec.status === 'UNKNOWN' && (
            <div
              style={{
                backgroundColor: 'rgba(210, 153, 34, 0.15)',
                border: '1px solid var(--accent-yellow)',
                borderRadius: '4px',
                padding: '8px',
                marginBottom: '10px',
                fontSize: '12px',
                color: 'var(--accent-yellow)',
              }}
            >
              ⚠️ 注意：该调用中途中断或超时，属于 UNKNOWN 状态。远端可能已产生副作用，请先核实状态，切勿盲目重复调用。
            </div>
          )}

          <pre className="doc-view-box">
            {JSON.stringify(
              {
                operation_id: selectedExec.operation_id,
                run_id: selectedExec.run_id,
                pixel_id: selectedExec.pixel_id,
                tool: selectedExec.tool,
                status: selectedExec.status,
                created_at: new Date(selectedExec.created_at * 1000).toLocaleString(),
                finished_at: selectedExec.finished_at ? new Date(selectedExec.finished_at * 1000).toLocaleString() : null,
                result: selectedExec.result,
              },
              null,
              2
            )}
          </pre>
        </div>
      ) : isLoading ? (
        <div style={{ color: 'var(--text-dim)', padding: '20px', textAlign: 'center' }}>
          正在加载工具执行记录...
        </div>
      ) : executions.length === 0 ? (
        <div style={{ color: 'var(--text-dim)', padding: '20px', textAlign: 'center' }}>
          暂无工具执行历史。
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Operation ID</th>
              <th>工具</th>
              <th>元胞</th>
              <th>状态</th>
              <th>发生时间</th>
              <th style={{ textAlign: 'right' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {executions.map((e) => (
              <tr key={e.operation_id}>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{e.operation_id}</td>
                <td style={{ fontWeight: 600, color: 'var(--accent-blue)' }}>{e.tool}</td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{e.pixel_id}</td>
                <td>{getStatusBadge(e.status)}</td>
                <td style={{ color: 'var(--text-dim)', fontSize: '11px' }}>
                  {new Date(e.created_at * 1000).toLocaleTimeString()}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button className="btn btn-xs" onClick={() => setSelectedExec(e)}>
                    查看回执
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
