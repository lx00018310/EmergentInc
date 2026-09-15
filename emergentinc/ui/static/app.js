/**
 * EmergentInc V9 — 主 UI 控制逻辑
 */

let pixelMap = null;
let loopTree = null;
let currentWorld = null;
let currentRunStatus = null;
let isPolling = false;
let lastKnownRound = -1;

document.addEventListener('DOMContentLoaded', () => {
  pixelMap = new PixelMap('pixel-canvas', 'pixel-hover-card');
  loopTree = new LoopTreeViewer('loop-tree-container');

  initCommandInputs();
  startPolling();
});

function appendConsole(text, type = 'system') {
  const box = document.getElementById('console-output');
  if (!box) return;
  const line = document.createElement('div');
  line.className = `console-line ${type}-line`;
  const time = new Date().toLocaleTimeString();
  line.textContent = `[${time}] ${text}`;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
}

function initCommandInputs() {
  const input = document.getElementById('cmd-input');
  const btnRun = document.getElementById('btn-run');
  const btnStop = document.getElementById('btn-stop');

  btnRun.addEventListener('click', () => handleCommand(input.value));
  btnStop.addEventListener('click', () => stopRun());

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      handleCommand(input.value);
    }
  });
}

function parseCommand(raw) {
  const text = (raw || '').trim();
  if (!text) return null;

  const runMatchCn = text.match(/^跑\s*(\d+)\s*轮?$/);
  if (runMatchCn) {
    return { action: 'RUN', rounds: parseInt(runMatchCn[1], 10) };
  }
  const runMatchEn = text.match(/^run\s*(\d+)$/i);
  if (runMatchEn) {
    return { action: 'RUN', rounds: parseInt(runMatchEn[1], 10) };
  }
  const roundOnly = text.match(/^(\d+)\s*轮$/);
  if (roundOnly) {
    return { action: 'RUN', rounds: parseInt(roundOnly[1], 10) };
  }

  if (text === '停止' || text.toLowerCase() === 'stop') {
    return { action: 'STOP' };
  }

  if (text === '状态' || text.toLowerCase() === 'status') {
    return { action: 'STATUS' };
  }

  return { action: 'UNKNOWN', raw: text };
}

async function handleCommand(text) {
  const parsed = parseCommand(text);
  const input = document.getElementById('cmd-input');
  if (input) input.value = '';

  if (!parsed) return;

  if (parsed.action === 'RUN') {
    await startRun(parsed.rounds, text);
  } else if (parsed.action === 'STOP') {
    await stopRun();
  } else if (parsed.action === 'STATUS') {
    printStatus();
  } else {
    appendConsole(`未识别指令: "${text}"。格式示例：跑10轮 / run 5 / 停止 / 状态`, 'warn');
  }
}

function sendQuickCommand(cmd) {
  handleCommand(cmd);
}

async function startRun(rounds, cmdText) {
  try {
    appendConsole(`发起演化指令: 推进 ${rounds} 轮...`, 'info');
    const res = await fetch('/api/run/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rounds, command: cmdText })
    });
    if (!res.ok) {
      const err = await res.json();
      appendConsole(`演化失败: ${err.detail || err.error || '未知错误'}`, 'error');
      return;
    }
    const status = await res.json();
    updateRunStatusUI(status);
  } catch (e) {
    appendConsole(`网络异常: ${e.message}`, 'error');
  }
}

async function stopRun() {
  try {
    appendConsole('已发出终止信号，等待当前 Round 结算完成...', 'warn');
    const res = await fetch('/api/run/stop', { method: 'POST' });
    const status = await res.json();
    updateRunStatusUI(status);
  } catch (e) {
    appendConsole(`停止异常: ${e.message}`, 'error');
  }
}

function printStatus() {
  if (!currentWorld) {
    appendConsole('世界状态尚未就绪。', 'system');
    return;
  }
  const w = currentWorld;
  const m = w.metrics || {};
  appendConsole(`==== V9 宏观指标 ====`, 'info');
  appendConsole(`物理轮次: Round ${w.round} | 活跃元胞: ${m.active_pixels || 0} / ${m.total_pixels || 0}`, 'info');
  appendConsole(`繁殖数: ${m.reproduction_count || 0} | 失活数: ${m.dead_pixels || 0}`, 'info');
  appendConsole(`全网能量: ${m.energy_metrics?.total || 0} Tokens (均值: ${(m.energy_metrics?.avg || 0).toFixed(0)})`, 'info');
  appendConsole(`实际支出: ${m.financial_metrics?.total_spent_equivalent_tokens || 0} Tokens | 核验净回款: ¥${((m.financial_metrics?.total_revenue_equivalent_tokens || 0) / 1000000).toFixed(2)}`, 'info');
}

function updateHeaderMetrics(world) {
  if (!world) return;
  document.getElementById('metric-round').textContent = world.round || 0;
  const m = world.metrics || {};
  document.getElementById('metric-pixels').textContent = `${m.active_pixels || 0} / ${m.total_pixels || 0}`;
  document.getElementById('metric-energy').textContent = Number(m.energy_metrics?.total || 0).toLocaleString();
  const cny = ((m.financial_metrics?.total_revenue_equivalent_tokens || 0) / 1000000).toFixed(2);
  document.getElementById('metric-revenue').textContent = `¥${cny}`;
  document.getElementById('metric-spent').textContent = Number(m.financial_metrics?.total_spent_equivalent_tokens || 0).toLocaleString();
}

function updateRunStatusUI(status) {
  currentRunStatus = status;
  const indicator = document.getElementById('run-status-indicator');
  const btnRun = document.getElementById('btn-run');
  const btnStop = document.getElementById('btn-stop');

  document.getElementById('branch-badge').textContent = `branch: ${status.current_branch || 'main'}`;
  document.getElementById('loop-badge').textContent = `loop: ${status.current_loop || '-'}`;

  if (status.running) {
    indicator.textContent = `EVOLVING (${status.completed_rounds}/${status.requested_rounds})`;
    indicator.className = 'run-status-indicator running';
    btnRun.disabled = true;
    btnStop.disabled = false;
  } else if (status.stop_reason) {
    indicator.textContent = `STOPPED (${status.stop_reason})`;
    indicator.className = 'run-status-indicator stopped';
    btnRun.disabled = false;
    btnStop.disabled = true;
  } else {
    indicator.textContent = 'IDLE';
    indicator.className = 'run-status-indicator';
    btnRun.disabled = false;
    btnStop.disabled = true;
  }
}

async function refreshWorld() {
  try {
    const res = await fetch('/api/world');
    if (!res.ok) return;
    const world = await res.json();
    currentWorld = world;

    if (lastKnownRound !== -1 && world.round > lastKnownRound) {
      appendConsole(`世界步进至 Round ${world.round} (存活元胞: ${world.metrics?.active_pixels})`, 'info');
    }
    lastKnownRound = world.round;

    updateHeaderMetrics(world);
    pixelMap.setPixels(world.pixels, world.latest_message_flow);
  } catch (e) {
    // 忽略轮询网络抖动
  }
}

async function refreshRunStatus() {
  try {
    const res = await fetch('/api/run/status');
    if (!res.ok) return;
    const status = await res.json();
    updateRunStatusUI(status);
  } catch (e) {}
}

async function refreshLoops() {
  try {
    const res = await fetch('/api/loops');
    if (!res.ok) return;
    const data = await res.json();
    loopTree.render(data);
  } catch (e) {}
}

function startPolling() {
  if (isPolling) return;
  isPolling = true;

  const poll = async () => {
    await refreshWorld();
    await refreshRunStatus();

    const interval = (currentRunStatus && currentRunStatus.running) ? 600 : 1500;
    setTimeout(poll, interval);
  };

  poll();
  setInterval(refreshLoops, 3000);
}

// 文档查看弹窗
async function openPixelDoc(docName) {
  const p = pixelMap.hoveredPixel || pixelMap.selectedPixel;
  if (!p && docName !== 'environment') {
    alert('请先选择或悬停在一个元胞上。');
    return;
  }

  const pid = p ? p.id : '0_0_0';
  try {
    const res = await fetch(`/api/pixels/${pid}/document/${docName}`);
    if (!res.ok) {
      const err = await res.json();
      alert(`读取失败: ${err.detail || err.error}`);
      return;
    }
    const data = await res.json();
    document.getElementById('doc-modal-title').textContent = `${docName === 'environment' ? '全局' : 'Pixel ' + pid} - ${docName.toUpperCase()}`;
    document.getElementById('doc-view-content').textContent = data.content;
    document.getElementById('doc-modal').style.display = 'flex';
  } catch (e) {
    alert(`读取错误: ${e.message}`);
  }
}

// 外部环境 Environment 弹窗
async function openEnvironmentModal() {
  try {
    const res = await fetch('/api/environment');
    if (!res.ok) {
      alert('获取环境失败');
      return;
    }
    const data = await res.json();
    document.getElementById('env-textarea').value = data.content || '';
    document.getElementById('env-modal').style.display = 'flex';
  } catch (e) {
    alert(`网络错误: ${e.message}`);
  }
}

async function saveEnvironment() {
  const content = document.getElementById('env-textarea').value;
  try {
    const res = await fetch('/api/environment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    if (res.ok) {
      appendConsole('已更新外部环境 (environment.md)', 'success');
      closeModal('env-modal');
      await refreshWorld();
    } else {
      const err = await res.json();
      alert(`保存失败: ${err.detail || err.error}`);
    }
  } catch (e) {
    alert(`提交异常: ${e.message}`);
  }
}

// 真实外部回款 Revenue 弹窗
function openRevenueModal() {
  const p = pixelMap.hoveredPixel || pixelMap.selectedPixel;
  if (p) {
    document.getElementById('rev-pixel-id').value = p.id;
  }
  document.getElementById('rev-tx-id').value = `alipay_${Date.now()}`;
  document.getElementById('revenue-modal').style.display = 'flex';
}

async function submitRevenueCredit() {
  const pixelId = document.getElementById('rev-pixel-id').value.trim();
  const amount = parseFloat(document.getElementById('rev-amount').value);
  const txId = document.getElementById('rev-tx-id').value.trim();

  if (!pixelId || isNaN(amount) || amount <= 0 || !txId) {
    alert('请准确填写元胞ID、有效净回款金额与交易单号。');
    return;
  }

  try {
    const res = await fetch('/api/revenue/credit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pixel_id: pixelId,
        net_amount: amount,
        tx_id: txId
      })
    });
    if (res.ok) {
      const data = await res.json();
      appendConsole(`核验外部回款成功: 为 ${pixelId} 注入 ${data.tokens_added.toLocaleString()} 等效 Token (单号: ${txId})`, 'success');
      closeModal('revenue-modal');
      await refreshWorld();
    } else {
      const err = await res.json();
      alert(`核验失败: ${err.detail || err.error}`);
    }
  } catch (e) {
    alert(`提交异常: ${e.message}`);
  }
}

async function checkoutLoop(loopId) {
  if (!confirm(`确认回退元胞心智与空间状态到 ${loopId} 吗？\n\n注意：根据 V9 宪法，已消耗的真实费用不可恢复。`)) {
    return;
  }

  try {
    const res = await fetch(`/api/loops/${loopId}/checkout`, { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      appendConsole(`已回退到 ${loopId}，自动创建分支: ${data.branch}`, 'success');
      await refreshWorld();
      await refreshRunStatus();
      await refreshLoops();
    } else {
      const err = await res.json();
      alert(`回退失败: ${err.detail || err.error}`);
    }
  } catch (e) {
    alert(`回退异常: ${e.message}`);
  }
}

async function branchLoop(loopId) {
  const name = prompt(`从 Loop ${loopId} 创建新分支，请输入分支名称：`, `branch-${Date.now().toString().slice(-4)}`);
  if (!name || !name.trim()) return;

  try {
    const res = await fetch(`/api/loops/${loopId}/branch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch_name: name.trim() })
    });
    if (res.ok) {
      appendConsole(`已创建并切换到新分支: ${name.trim()}`, 'success');
      await refreshWorld();
      await refreshRunStatus();
      await refreshLoops();
    } else {
      const err = await res.json();
      alert(`分叉失败: ${err.detail || err.error}`);
    }
  } catch (e) {
    alert(`分叉异常: ${e.message}`);
  }
}

async function deleteLoop(loopId) {
  if (!confirm(`确定删除叶子快照 ${loopId} 吗？此操作不可逆。`)) return;

  try {
    const res = await fetch(`/api/loops/${loopId}`, { method: 'DELETE' });
    if (res.ok) {
      appendConsole(`已删除快照 ${loopId}`, 'warn');
      await refreshLoops();
    } else {
      const err = await res.json();
      alert(`删除失败: ${err.detail || err.error}`);
    }
  } catch (e) {
    alert(`删除异常: ${e.message}`);
  }
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.style.display = 'none';
}
