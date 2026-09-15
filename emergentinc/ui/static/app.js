/**
 * Main UI Application Controller
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

  // Match "跑N轮" or "run N" or "N轮"
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
    appendConsole(`未识别指令: "${text}"。可用指令格式：\n- 跑10轮 / run 10\n- 停止 / stop\n- 状态`, 'warn');
  }
}

function sendQuickCommand(cmd) {
  handleCommand(cmd);
}

async function startRun(rounds, cmdText) {
  try {
    appendConsole(`发起运行指令: 运行 ${rounds} 轮...`, 'info');
    const res = await fetch('/api/run/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rounds, command: cmdText })
    });
    if (!res.ok) {
      const err = await res.json();
      appendConsole(`启动运行失败: ${err.detail || err.error || '未知错误'}`, 'error');
      return;
    }
    const status = await res.json();
    updateRunStatusUI(status);
  } catch (e) {
    appendConsole(`请求异常: ${e.message}`, 'error');
  }
}

async function stopRun() {
  try {
    appendConsole('已发送停止请求，等待当前 Round 完成...', 'warn');
    const res = await fetch('/api/run/stop', { method: 'POST' });
    const status = await res.json();
    updateRunStatusUI(status);
  } catch (e) {
    appendConsole(`停止异常: ${e.message}`, 'error');
  }
}

function printStatus() {
  if (!currentWorld) {
    appendConsole('世界状态尚未加载。', 'system');
    return;
  }
  const w = currentWorld;
  const activeCount = w.pixels.filter(p => p.active).length;
  const openProblems = w.problems.filter(p => p.status === 'OPEN').length;
  const pendingRequests = w.owner_requests.filter(r => r.status === 'PENDING_OWNER').length;
  const cnyIn = w.external_accounting?.CNY_in || 0;
  const cnyOut = w.external_accounting?.CNY_out || 0;

  appendConsole(`==== 世界运行状态 ====`, 'info');
  appendConsole(`当前 Round: ${w.round} | 激活元胞: ${activeCount} / ${w.pixels.length}`, 'info');
  appendConsole(`未决任务: ${openProblems} | 待审批 Owner 请求: ${pendingRequests}`, 'info');
  appendConsole(`现实账务: CNY 收入=¥${cnyIn}, 支出=¥${cnyOut}, 净利=¥${(cnyIn - cnyOut).toFixed(2)}`, 'info');
  appendConsole(`LLM 调用: 决策=${w.llm_accounting?.decision_calls || 0}, 验真=${w.llm_accounting?.validator_calls || 0}`, 'info');
}

function updateHeaderMetrics(world) {
  if (!world) return;
  document.getElementById('metric-round').textContent = world.round;
  const activePixels = world.pixels.filter(p => p.active).length;
  document.getElementById('metric-pixels').textContent = `${activePixels} / ${world.pixels.length}`;
  const openProbs = world.problems.filter(p => p.status === 'OPEN').length;
  document.getElementById('metric-problems').textContent = openProbs;

  const cnyIn = world.external_accounting?.CNY_in || 0;
  const cnyOut = world.external_accounting?.CNY_out || 0;
  const net = (cnyIn - cnyOut).toFixed(1);
  document.getElementById('metric-cny').textContent = `¥${net}`;

  const totalCalls = (world.llm_accounting?.decision_calls || 0) +
                     (world.llm_accounting?.validator_calls || 0) +
                     (world.llm_accounting?.memory_calls || 0);
  document.getElementById('metric-llm').textContent = totalCalls;
}

function updateRunStatusUI(status) {
  currentRunStatus = status;
  const indicator = document.getElementById('run-status-indicator');
  const btnRun = document.getElementById('btn-run');
  const btnStop = document.getElementById('btn-stop');

  document.getElementById('branch-badge').textContent = `branch: ${status.current_branch || 'main'}`;
  document.getElementById('loop-badge').textContent = `loop: ${status.current_loop || '-'}`;

  if (status.running) {
    indicator.textContent = `RUNNING (${status.completed_rounds}/${status.requested_rounds})`;
    indicator.className = 'run-status-indicator running';
    btnRun.disabled = true;
    btnStop.disabled = false;
  } else if (status.stop_reason === 'OWNER_ACTION_REQUIRED') {
    indicator.textContent = 'STOPPED (OWNER)';
    indicator.className = 'run-status-indicator stopped';
    btnRun.disabled = false;
    btnStop.disabled = true;
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

  // Check pending owner requests alert
  checkOwnerAlerts();
}

function checkOwnerAlerts() {
  const container = document.getElementById('owner-alert-container');
  if (!currentWorld) return;

  const pending = currentWorld.owner_requests.filter(r => r.status === 'PENDING_OWNER');
  if (pending.length === 0) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';
  const req = pending[0];
  document.getElementById('alert-title').textContent = `⚠ 自动停机：需 Owner 审批 (${req.id})`;
  document.getElementById('alert-body').innerHTML = `
    <strong>Pixel ${req.requester}</strong> 请求现实能力：<code>${req.capability_type}</code><br/>
    目标用途: ${escapeHtml(req.purpose || '未填写')}<br/>
    预估花费: ${JSON.stringify(req.estimated_external_cost || {})}
  `;

  const actions = document.getElementById('alert-actions');
  actions.innerHTML = `
    <button class="btn btn-sm btn-primary" onclick="openApproveModal('${req.id}')">批准请求</button>
    <button class="btn btn-sm btn-danger" onclick="quickReject('${req.id}')">拒绝请求</button>
  `;
}

async function quickReject(reqId) {
  const reason = prompt('请输入拒绝原因：', 'Denied by Owner');
  if (reason === null) return;
  try {
    const res = await fetch(`/api/owner/requests/${reqId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    });
    if (res.ok) {
      appendConsole(`已拒绝请求 ${reqId}`, 'warn');
      await refreshWorld();
    } else {
      const err = await res.json();
      alert(`拒绝失败: ${err.detail || err.error}`);
    }
  } catch (e) {
    alert(`请求错误: ${e.message}`);
  }
}

function openApproveModal(reqId) {
  document.getElementById('approve-req-id').value = reqId;
  document.getElementById('approve-req-id-display').textContent = reqId;
  document.getElementById('approve-modal').style.display = 'flex';
}

async function submitApprove() {
  const reqId = document.getElementById('approve-req-id').value;
  const profileFile = document.getElementById('approve-profile-path').value.trim();
  const capId = document.getElementById('approve-cap-id').value.trim() || undefined;
  const reason = document.getElementById('approve-reason').value.trim() || 'approved';

  if (!profileFile) {
    alert('请填入本地凭证配置文件绝对路径。');
    return;
  }

  try {
    const res = await fetch(`/api/owner/requests/${reqId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile_file: profileFile,
        capability_id: capId,
        reason: reason
      })
    });
    if (res.ok) {
      appendConsole(`已批准请求 ${reqId}`, 'success');
      closeModal('approve-modal');
      await refreshWorld();
    } else {
      const err = await res.json();
      alert(`批准失败: ${err.detail || err.error}`);
    }
  } catch (e) {
    alert(`请求错误: ${e.message}`);
  }
}

async function refreshWorld() {
  try {
    const res = await fetch('/api/world');
    if (!res.ok) return;
    const world = await res.json();
    currentWorld = world;

    if (lastKnownRound !== -1 && world.round > lastKnownRound) {
      appendConsole(`世界步进到 Round ${world.round}`, 'info');
    }
    lastKnownRound = world.round;

    updateHeaderMetrics(world);
    pixelMap.setPixels(world.pixels);
    checkOwnerAlerts();
  } catch (e) {
    // Network or server starting up
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

    const interval = (currentRunStatus && currentRunStatus.running) ? 500 : 1200;
    setTimeout(poll, interval);
  };

  poll();

  // Refresh loops every 2.5 seconds
  setInterval(refreshLoops, 2500);
}

// Modal and Document Viewer functions
async function openPixelDoc(docName) {
  const p = pixelMap.hoveredPixel || pixelMap.selectedPixel;
  if (!p) {
    alert('请先将鼠标悬停在某个 Pixel 上。');
    return;
  }

  try {
    const res = await fetch(`/api/pixels/${p.id}/document/${docName}`);
    if (!res.ok) {
      const err = await res.json();
      alert(`读取失败: ${err.detail || err.error}`);
      return;
    }
    const data = await res.json();
    document.getElementById('doc-modal-title').textContent = `Pixel ${p.id} - ${docName.toUpperCase()}`;
    document.getElementById('doc-viewer-content').textContent = data.content;
    document.getElementById('doc-modal').style.display = 'flex';
  } catch (e) {
    alert(`读取错误: ${e.message}`);
  }
}

function openProblemModal() {
  document.getElementById('problem-modal').style.display = 'flex';
}

async function submitProblem() {
  const desc = document.getElementById('prob-desc').value.trim();
  const curr = document.getElementById('prob-curr').value.trim();
  const desired = document.getElementById('prob-desired').value.trim();
  const criteriaText = document.getElementById('prob-criteria').value.trim();
  const reward = parseFloat(document.getElementById('prob-reward').value) || 0.0;

  if (!desc) {
    alert('请输入目标描述。');
    return;
  }

  const criteria = criteriaText.split('\n').map(s => s.trim()).filter(Boolean);

  try {
    const res = await fetch('/api/environment/problem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: desc,
        current_state: curr,
        desired_state: desired,
        acceptance_criteria: criteria,
        reward_budget: reward
      })
    });
    if (res.ok) {
      const data = await res.json();
      appendConsole(`发布新环境目标: ${data.problem.id} - ${desc}`, 'success');
      closeModal('problem-modal');
      await refreshWorld();
    } else {
      const err = await res.json();
      alert(`发布失败: ${err.detail || err.error}`);
    }
  } catch (e) {
    alert(`提交异常: ${e.message}`);
  }
}

function openEventModal() {
  document.getElementById('event-modal').style.display = 'flex';
}

async function submitEvent() {
  const target = document.getElementById('event-target').value.trim();
  const problem = document.getElementById('event-problem').value.trim() || null;
  const kind = document.getElementById('event-kind').value.trim();
  const note = document.getElementById('event-note').value.trim();

  if (!target || !note) {
    alert('目标 Pixel 与描述不能为空。');
    return;
  }

  try {
    const res = await fetch('/api/environment/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_pixel: target,
        problem_id: problem,
        kind: kind,
        note: note
      })
    });
    if (res.ok) {
      appendConsole(`录入客观事实事件 -> ${target}: ${kind} - ${note}`, 'info');
      closeModal('event-modal');
      await refreshWorld();
    } else {
      const err = await res.json();
      alert(`录入失败: ${err.detail || err.error}`);
    }
  } catch (e) {
    alert(`提交异常: ${e.message}`);
  }
}

async function checkoutLoop(loopId) {
  if (!confirm(`确认回退世界状态到 ${loopId} 吗？\n\n回退将恢复该 Checkpoint 的 Snapshot 并创建新分支指针，旧未来不会被删除。`)) {
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
  if (!confirm(`确定删除叶子 Loop ${loopId} 吗？此操作不可逆。`)) return;

  try {
    const res = await fetch(`/api/loops/${loopId}`, { method: 'DELETE' });
    if (res.ok) {
      appendConsole(`已删除 Loop ${loopId}`, 'warn');
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
