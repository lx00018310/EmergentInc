/**
 * Loop Tree: Render Git-style Loop nodes, branching, checkout and deletion
 */

class LoopTreeViewer {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
  }

  render(data) {
    if (!this.container) return;

    const loops = data.loops || [];
    const branches = data.branches || [];
    const manifest = data.manifest || {};

    if (loops.length === 0) {
      this.container.innerHTML = `
        <div style="color: var(--text-dim); padding: 12px; text-align: center; font-size: 12px;">
          暂无 Loop 历史。执行一次运行命令后将自动生成 Loop 节点。
        </div>
      `;
      return;
    }

    // Build child map to determine which nodes are leaves
    const parentMap = new Map();
    const childCount = new Map();
    for (const l of loops) {
      childCount.set(l.id, 0);
    }
    for (const l of loops) {
      if (l.parent && childCount.has(l.parent)) {
        childCount.set(l.parent, childCount.get(l.parent) + 1);
      }
    }

    // Sort loops reverse chronologically
    const sortedLoops = [...loops].reverse();

    let html = '';
    for (const l of sortedLoops) {
      const isCurrentHead = manifest.current_loop === l.id;
      const isLeaf = (childCount.get(l.id) || 0) === 0;

      let statusClass = 'system-line';
      if (l.status === 'RUNNING') statusClass = 'info-line';
      else if (l.status === 'COMPLETED') statusClass = 'success-line';
      else if (l.status === 'STOPPED') statusClass = 'warn-line';
      else if (l.status === 'ERROR') statusClass = 'error-line';

      const stopReasonBadge = l.stop_reason ? `<span class="badge" style="color: var(--accent-yellow);">${l.stop_reason}</span>` : '';

      html += `
        <div class="tree-node-item ${isCurrentHead ? 'current-head' : ''}">
          <div class="tree-node-main">
            <div class="tree-node-title">
              <span>● ${l.id}</span>
              <span class="badge">${l.branch}</span>
              <span class="${statusClass}">${l.status}</span>
              ${stopReasonBadge}
            </div>
            <div class="tree-node-meta">
              指令: <code>${escapeHtml(l.command || '-')}</code> | 轮次: R${l.start_round} → R${l.end_round}
            </div>
          </div>
          <div class="tree-node-actions">
            <button class="btn btn-xs" title="回退到此 Loop 状态" onclick="checkoutLoop('${l.id}')">回退</button>
            <button class="btn btn-xs" title="从该节点创建新分支" onclick="branchLoop('${l.id}')">分叉</button>
            ${isLeaf ? `<button class="btn btn-xs btn-danger" title="删除叶子 Loop" onclick="deleteLoop('${l.id}')">删</button>` : ''}
          </div>
        </div>
      `;
    }

    this.container.innerHTML = html;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

window.LoopTreeViewer = LoopTreeViewer;
