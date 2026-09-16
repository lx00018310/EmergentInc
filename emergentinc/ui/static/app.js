/**
 * EmergentInc V9 — 主 UI 控制逻辑
 */

let pixelMap = null;
let currentWorld = null;
let currentRunStatus = null;
let isPolling = false;
let lastKnownRound = -1;

document.addEventListener('DOMContentLoaded', () => {
  pixelMap = new PixelMap('pixel-canvas', 'pixel-hover-card');

  initCommandInputs();
  initGenesisPromptEvents();
  initTemporaryPromptEvents();
  loadGenesisPrompt();
  loadTemporaryPrompt();
  startPolling();
});

function initGenesisPromptEvents() {
  const textarea = document.getElementById('genesis-textarea');
  const countEl = document.getElementById('genesis-char-count');
  if (textarea && countEl) {
    textarea.addEventListener('input', () => {
      countEl.textContent = `${textarea.value.length} / 12000`;
    });
  }
}

function initTemporaryPromptEvents() {
  const textarea = document.getElementById('temp-prompt-textarea');
  const countEl = document.getElementById('temp-prompt-char-count');
  if (textarea && countEl) {
    textarea.addEventListener('input', () => {
      countEl.textContent = `${textarea.value.length} / 12000`;
    });
  }
}

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
    const runBudgetInput = document.getElementById('input-run-budget');
    const globalBudgetInput = document.getElementById('input-global-budget');
    const run_budget_tokens = runBudgetInput ? (parseInt(runBudgetInput.value, 10) || 100000) : 100000;
    const global_budget_tokens = globalBudgetInput ? (parseInt(globalBudgetInput.value, 10) || 1000000) : 1000000;

    appendConsole(`发起演化指令: 推进 ${rounds} 轮 (Run预算: ${run_budget_tokens.toLocaleString()}, 全局: ${global_budget_tokens.toLocaleString()})...`, 'info');
    const res = await fetch('/api/run/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rounds,
        command: cmdText,
        run_budget_tokens,
        global_budget_tokens
      })
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
  const roundEl = document.getElementById('metric-round');
  if (roundEl) roundEl.textContent = world.round || 0;
  const m = world.metrics || {};
  const pixelsEl = document.getElementById('metric-pixels');
  if (pixelsEl) pixelsEl.textContent = `${m.active_pixels || 0} / ${m.total_pixels || 0}`;
  const energyEl = document.getElementById('metric-energy');
  if (energyEl) energyEl.textContent = Number(m.energy_metrics?.total || 0).toLocaleString();
  const spentEl = document.getElementById('metric-spent');
  if (spentEl) spentEl.textContent = Number(m.financial_metrics?.total_spent_equivalent_tokens || 0).toLocaleString();
  const runLimitEl = document.getElementById('metric-run-limit');
  if (runLimitEl && currentRunStatus) {
    runLimitEl.textContent = `${currentRunStatus.completed_rounds || 0} / ${currentRunStatus.requested_rounds || 0} 轮`;
  }
}

function updateRunStatusUI(status) {
  const previousStatus = currentRunStatus;
  currentRunStatus = status;
  const indicator = document.getElementById('run-status-indicator');
  const btnRun = document.getElementById('btn-run');
  const btnStop = document.getElementById('btn-stop');

  const runBadge = document.getElementById('run-badge');
  if (runBadge) runBadge.textContent = `run: ${status.run_id || status.current_run || status.current_loop || '-'}`;

  const healthEl = document.getElementById('metric-system-health');
  if (healthEl) {
    if (status.running) {
      healthEl.textContent = 'RUNNING';
      healthEl.style.color = '#63b3ed';
    } else if (status.last_error || status.result_status === 'ERROR') {
      healthEl.textContent = 'ERROR';
      healthEl.style.color = '#fc8181';
    } else if (status.stop_reason === 'PAUSED_RECOVERY_REQUIRED') {
      healthEl.textContent = 'RECOVERY_REQ';
      healthEl.style.color = '#f6ad55';
    } else if (status.stop_reason === 'BUDGET_EXHAUSTED') {
      healthEl.textContent = 'BUDGET_EXHAUSTED';
      healthEl.style.color = '#ecc94b';
    } else {
      healthEl.textContent = 'READY';
      healthEl.style.color = '#48bb78';
    }
  }

  if (status.running) {
    indicator.textContent = `EVOLVING (${status.completed_rounds}/${status.requested_rounds}, LLM: ${status.model_calls_completed || 0})`;
    indicator.className = 'run-status-indicator running';
    btnRun.disabled = true;
    btnStop.disabled = false;
  } else if (status.last_error) {
    indicator.textContent = `ERROR: ${status.last_error}`;
    indicator.className = 'run-status-indicator stopped';
    indicator.title = status.last_error;
    btnRun.disabled = false;
    btnStop.disabled = true;
  } else if (status.stop_reason) {
    indicator.textContent = `STOPPED (${status.stop_reason})`;
    indicator.className = 'run-status-indicator stopped';
    indicator.title = status.stop_reason;
    btnRun.disabled = false;
    btnStop.disabled = true;
  } else if (status.result_status === 'COMPLETED_NO_ACTIVITY') {
    indicator.textContent = 'NO ACTIVITY (API 未调用)';
    indicator.className = 'run-status-indicator stopped';
    indicator.title = 'Round 已推进，但没有消息处理或模型调用；本次结果不能证明底层 API 可用。';
    btnRun.disabled = false;
    btnStop.disabled = true;
  } else {
    indicator.textContent = 'IDLE';
    indicator.className = 'run-status-indicator';
    indicator.title = '';
    btnRun.disabled = false;
    btnStop.disabled = true;
  }

  const genTextarea = document.getElementById('genesis-textarea');
  const btnSaveGen = document.getElementById('btn-save-genesis');
  const btnClearGen = document.getElementById('btn-clear-genesis');
  if (genTextarea) genTextarea.disabled = status.running;
  if (btnSaveGen) btnSaveGen.disabled = status.running;
  if (btnClearGen) btnClearGen.disabled = status.running;

  const tempTextarea = document.getElementById('temp-prompt-textarea');
  const btnSaveTemp = document.getElementById('btn-save-temp-prompt');
  const btnClearTemp = document.getElementById('btn-clear-temp-prompt');
  if (tempTextarea) tempTextarea.disabled = status.running;
  if (btnSaveTemp) btnSaveTemp.disabled = status.running;
  if (btnClearTemp) btnClearTemp.disabled = status.running;

  if (previousStatus?.running && !status.running) {
    const calls = Number(status.model_calls_completed || 0);
    const messages = Number(status.messages_processed || 0);
    const idleRounds = Number(status.idle_rounds || 0);
    if (status.result_status === 'COMPLETED_NO_ACTIVITY') {
      appendConsole(
        `Run结束：推进 ${status.completed_rounds || 0} 轮，但处理消息 0 条、LLM调用 0 次；底层 API 未被测试。`,
        'warn'
      );
    } else if (!status.last_error && !status.stop_reason) {
      appendConsole(
        `Run完成：消息 ${messages} 条，LLM调用 ${calls} 次，空轮 ${idleRounds} 轮。`,
        'info'
      );
    }
  }

  const genesisTextarea = document.getElementById('genesis-textarea');
  const btnSaveGenesis = document.getElementById('btn-save-genesis');
  const btnClearGenesis = document.getElementById('btn-clear-genesis');
  if (genesisTextarea) genesisTextarea.disabled = Boolean(status.running);
  if (btnSaveGenesis) btnSaveGenesis.disabled = Boolean(status.running);
  if (btnClearGenesis) btnClearGenesis.disabled = Boolean(status.running);
  if (btnRun) btnRun.disabled = Boolean(status.running);
  document.querySelectorAll('.run-quick-btn').forEach(button => {
    button.disabled = Boolean(status.running);
  });
}

function createOwnerRequestCard(request) {
  const requestId = String(request.id || request.request_id || 'unknown');
  const card = document.createElement('div');
  card.className = 'owner-request-card';
  card.id = `owner-request-${requestId}`;
  card.dataset.requestId = requestId;

  const meta = document.createElement('div');
  meta.className = 'owner-request-meta';
  const description = document.createElement('div');
  description.className = 'owner-request-description';

  const reason = document.createElement('textarea');
  reason.className = 'owner-reason-input';
  reason.id = `owner-reason-${requestId}`;
  reason.rows = 2;
  reason.maxLength = 2000;
  reason.placeholder = '必填：给 Pixel 的明确答复、授权范围或拒绝理由';

  const buttonRow = document.createElement('div');
  buttonRow.className = 'owner-request-actions';
  const approveButton = document.createElement('button');
  approveButton.className = 'btn btn-sm btn-primary';
  approveButton.textContent = '批准并发送答复';
  approveButton.addEventListener('click', () => resolveOwnerRequest(requestId, 'approve'));
  const rejectButton = document.createElement('button');
  rejectButton.className = 'btn btn-sm btn-danger';
  rejectButton.textContent = '拒绝并发送理由';
  rejectButton.addEventListener('click', () => resolveOwnerRequest(requestId, 'reject'));
  buttonRow.append(approveButton, rejectButton);
  card.append(meta, description, reason, buttonRow);
  return card;
}

function updateOwnerRequestCard(card, request) {
  const requestId = String(request.id || request.request_id || 'unknown');
  const metaText = `${requestId} · Pixel ${request.pixel_id || request.requester || '-'} · ${request.type || 'request'} · Round ${request.round ?? '-'}`;
  const descriptionText = request.description || request.purpose || '未提供说明';
  const meta = card.querySelector('.owner-request-meta');
  const description = card.querySelector('.owner-request-description');
  if (meta.textContent !== metaText) meta.textContent = metaText;
  if (description.textContent !== descriptionText) description.textContent = descriptionText;
}

async function refreshWorld() {
  try {
    const res = await fetch('/api/world');
    if (!res.ok) return;
    const world = await res.json();
    currentWorld = world;

    if (lastKnownRound !== -1 && world.round > lastKnownRound) {
      appendConsole(
        `世界时钟推进至 Round ${world.round} (存活元胞: ${world.metrics?.active_pixels})；该提示不代表 LLM/API 已调用。`,
        'info'
      );
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

async function resolveOwnerRequest(requestId, decision) {
  const reasonInput = document.getElementById(`owner-reason-${requestId}`);
  const reason = (reasonInput?.value || '').trim();
  if (!reason) {
    alert(decision === 'approve' ? '请填写给 Pixel 的明确答复。' : '请填写拒绝理由。');
    reasonInput?.focus();
    return;
  }

  const card = document.getElementById(`owner-request-${requestId}`);
  const buttons = card ? card.querySelectorAll('button') : [];
  buttons.forEach(button => { button.disabled = true; });
  try {
    const res = await fetch(`/api/owner/requests/${encodeURIComponent(requestId)}/${decision}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || data.error || '请求处理失败');
    appendConsole(
      `Owner 请求 ${requestId} 已${decision === 'approve' ? '批准' : '拒绝'}，反馈已发送给 Pixel。`,
      decision === 'approve' ? 'success' : 'warn'
    );
    await refreshOwnerRequests();
    await refreshRunStatus();
    await refreshWorld();
  } catch (error) {
    buttons.forEach(button => { button.disabled = false; });
    alert(`处理失败: ${error.message}`);
  }
}

async function refreshOwnerRequests() {
  const container = document.getElementById('owner-alert-container');
  const title = document.getElementById('alert-title');
  const body = document.getElementById('alert-body');
  const actions = document.getElementById('alert-actions');
  if (!container || !title || !body || !actions) return;

  try {
    const res = await fetch('/api/owner/requests');
    if (!res.ok) return;
    const allRequests = await res.json();
    const pending = (Array.isArray(allRequests) ? allRequests : [])
      .filter(request => request.status === 'PENDING_OWNER');
    pendingOwnerRequestCount = pending.length;

    const runButton = document.getElementById('btn-run');
    if (runButton) runButton.disabled = Boolean(currentRunStatus?.running) || pending.length > 0;
    document.querySelectorAll('.run-quick-btn').forEach(button => {
      button.disabled = Boolean(currentRunStatus?.running) || pending.length > 0;
    });

    if (pending.length === 0) {
      container.style.display = 'none';
      body.replaceChildren();
      actions.replaceChildren();
      if (currentRunStatus) updateRunStatusUI(currentRunStatus);
      return;
    }

    container.style.display = 'block';
    title.textContent = `⚠ 需要 Owner 处理：${pending.length} 个待审批请求`;
    if (!currentRunStatus?.running) {
      const indicator = document.getElementById('run-status-indicator');
      indicator.textContent = `WAITING OWNER (${pending.length})`;
      indicator.className = 'run-status-indicator stopped';
      indicator.title = '处理完全部待审批请求后才能继续演化。';
    }
    const pendingIds = new Set();
    for (const request of pending) {
      const requestId = String(request.id || request.request_id || 'unknown');
      pendingIds.add(requestId);
      let card = Array.from(body.children).find(item => item.dataset.requestId === requestId);
      if (!card) {
        card = createOwnerRequestCard(request);
        body.appendChild(card);
      }
      updateOwnerRequestCard(card, request);
    }

    for (const card of Array.from(body.children)) {
      if (!pendingIds.has(card.dataset.requestId)) card.remove();
    }

    if (!actions.querySelector('.owner-action-hint')) {
      const hint = document.createElement('div');
      hint.className = 'owner-action-hint';
      hint.textContent = '处理完全部请求后，演化按钮会恢复；系统不会自动继续运行。';
      actions.appendChild(hint);
    }
  } catch (error) {
    appendConsole(`读取 Owner 请求失败: ${error.message}`, 'error');
  }
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

// 本地交付物查看弹窗
async function openPixelArtifacts() {
  const p = pixelMap?.hoveredPixel || pixelMap?.selectedPixel;
  if (!p) {
    alert('请先在右侧地图上悬停或点击选中一个元胞。');
    return;
  }

  const pid = p.id;
  try {
    const res = await fetch(`/api/pixels/${pid}/artifacts`);
    if (!res.ok) {
      alert('获取交付物列表失败');
      return;
    }
    const data = await res.json();
    const artifacts = data.artifacts || [];
    const titleEl = document.getElementById('doc-modal-title');
    const contentEl = document.getElementById('doc-view-content');
    titleEl.textContent = `Pixel ${pid} - 本地交付物 (${artifacts.length} 个)`;
    contentEl.replaceChildren();

    if (artifacts.length === 0) {
      contentEl.textContent = `该元胞 (${pid}) 尚未保存任何本地交付物。\n元胞可在 operations 中调用 save_artifact 工具将成果文件写入本地磁盘。`;
    } else {
      const headerText = document.createElement('div');
      headerText.style.cssText = 'margin-bottom: 12px; color: #a0aec0;';
      headerText.textContent = `=== 交付物文件列表 (磁盘实际落盘文件) ===`;
      contentEl.appendChild(headerText);

      artifacts.forEach((item, idx) => {
        const itemRow = document.createElement('div');
        itemRow.style.cssText = 'margin: 6px 0; padding: 6px 10px; background: #2d3748; border-radius: 4px; display: flex; justify-content: space-between; align-items: center;';
        
        const nameSpan = document.createElement('span');
        nameSpan.textContent = `📄 ${item.filename} (${item.size_bytes.toLocaleString()} 字节)`;
        
        const btnGroup = document.createElement('div');
        btnGroup.style.cssText = 'display: flex; gap: 6px;';

        const viewBtn = document.createElement('button');
        viewBtn.className = 'btn btn-xs btn-primary';
        viewBtn.textContent = '查看/预览';
        viewBtn.onclick = () => viewPixelArtifactContent(pid, item.filename);

        const dlBtn = document.createElement('a');
        dlBtn.className = 'btn btn-xs btn-secondary';
        dlBtn.textContent = '下载';
        dlBtn.href = `/api/pixels/${encodeURIComponent(pid)}/artifacts/${encodeURIComponent(item.filename)}/download`;
        dlBtn.setAttribute('download', item.filename);

        btnGroup.appendChild(viewBtn);
        btnGroup.appendChild(dlBtn);
        itemRow.appendChild(nameSpan);
        itemRow.appendChild(btnGroup);
        contentEl.appendChild(itemRow);
      });
    }

    document.getElementById('doc-modal').style.display = 'flex';
  } catch (e) {
    alert(`读取交付物列表失败: ${e.message}`);
  }
}

async function viewPixelArtifactContent(pid, filename) {
  try {
    document.getElementById('doc-modal-title').textContent = `Pixel ${pid} - 交付物: ${filename}`;
    const contentEl = document.getElementById('doc-view-content');
    contentEl.replaceChildren();

    const topBar = document.createElement('div');
    topBar.style.cssText = 'margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;';

    const backBtn = document.createElement('button');
    backBtn.className = 'btn btn-xs btn-secondary';
    backBtn.textContent = '← 返回交付物列表';
    backBtn.onclick = () => openPixelArtifacts();
    topBar.appendChild(backBtn);

    const dlLink = document.createElement('a');
    dlLink.className = 'btn btn-xs btn-primary';
    dlLink.textContent = '下载原始文件';
    dlLink.href = `/api/pixels/${encodeURIComponent(pid)}/artifacts/${encodeURIComponent(filename)}/download`;
    dlLink.setAttribute('download', filename);
    topBar.appendChild(dlLink);

    contentEl.appendChild(topBar);

    const isImage = /\.(jpe?g|png|webp|gif|bmp)$/i.test(filename);
    if (isImage) {
      const imgContainer = document.createElement('div');
      imgContainer.style.cssText = 'text-align: center; padding: 12px; background: #1a202c; border-radius: 4px;';
      const img = document.createElement('img');
      img.src = `/api/pixels/${encodeURIComponent(pid)}/artifacts/${encodeURIComponent(filename)}/download`;
      img.alt = filename;
      img.style.cssText = 'max-width: 100%; max-height: 500px; border-radius: 4px; box-shadow: 0 4px 6px rgba(0,0,0,0.3);';
      imgContainer.appendChild(img);
      contentEl.appendChild(imgContainer);
    } else {
      const res = await fetch(`/api/pixels/${encodeURIComponent(pid)}/artifacts/${encodeURIComponent(filename)}`);
      if (res.ok) {
        const data = await res.json();
        const pre = document.createElement('pre');
        pre.style.cssText = 'white-space: pre-wrap; word-break: break-all; margin: 0; font-family: monospace; background: #1a202c; padding: 12px; border-radius: 4px;';
        pre.textContent = data.content || '(空文件)';
        contentEl.appendChild(pre);
      } else {
        const err = await res.json();
        const errBox = document.createElement('div');
        errBox.style.cssText = 'color: #fc8181; padding: 12px;';
        errBox.textContent = `文本解码失败或为二进制文件: ${err.detail || '请直接点击上方下载按钮获取原始文件'}`;
        contentEl.appendChild(errBox);
      }
    }
  } catch (e) {
    alert(`读取交付物内容失败: ${e.message}`);
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

async function loadGenesisPrompt() {
  try {
    const res = await fetch('/api/genesis-prompt');
    if (!res.ok) return;
    const data = await res.json();
    const textarea = document.getElementById('genesis-textarea');
    const badge = document.getElementById('genesis-status-badge');
    const revEl = document.getElementById('genesis-revision');
    const hashEl = document.getElementById('genesis-hash');
    const countEl = document.getElementById('genesis-char-count');

    if (textarea) textarea.value = data.content || '';
    if (revEl) revEl.textContent = data.revision !== undefined ? data.revision : '-';
    if (hashEl) hashEl.textContent = data.sha256 ? data.sha256.slice(0, 12) : '-';
    if (countEl) countEl.textContent = `${(data.content || '').length} / 12000`;

    if (badge) {
      if (data.active) {
        badge.textContent = '已启用';
        badge.className = 'badge active-dot';
      } else {
        badge.textContent = '已关闭';
        badge.className = 'badge';
      }
    }
  } catch (e) {
    console.error('Failed to load genesis prompt:', e);
  }
}

async function saveGenesisPrompt() {
  const textarea = document.getElementById('genesis-textarea');
  if (!textarea) return;
  const content = textarea.value;
  if (content.length > 12000) {
    alert('创世提示词长度不能超过 12,000 字符！');
    return;
  }

  try {
    const res = await fetch('/api/genesis-prompt', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content })
    });
    if (res.ok) {
      const data = await res.json();
      appendConsole(`创世提示词已保存 (Revision ${data.revision})，将作为后续所有元胞系统提示词的初速度。`, 'success');
      await loadGenesisPrompt();
    } else {
      const err = await res.json();
      alert(`保存失败: ${err.detail || err.error}`);
    }
  } catch (e) {
    alert(`保存异常: ${e.message}`);
  }
}

async function clearGenesisPrompt() {
  if (!confirm('确定清空并关闭创世提示词吗？\n清空后将停止向后续元胞注入，但此前已经写入 pixel.md 的经验不会自动删除。')) {
    return;
  }

  try {
    const res = await fetch('/api/genesis-prompt', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '' })
    });
    if (res.ok) {
      const data = await res.json();
      appendConsole(`创世提示词已清空并关闭 (Revision ${data.revision})。`, 'warn');
      await loadGenesisPrompt();
    } else {
      const err = await res.json();
      alert(`清空失败: ${err.detail || err.error}`);
    }
  } catch (e) {
    alert(`清空异常: ${e.message}`);
  }
}

// ==================== 临时提示词操作 ====================

async function loadTemporaryPrompt() {
  try {
    const res = await fetch('/api/temporary-prompt');
    if (!res.ok) return;
    const data = await res.json();
    const textarea = document.getElementById('temp-prompt-textarea');
    const badge = document.getElementById('temp-prompt-status-badge');
    const revEl = document.getElementById('temp-prompt-revision');
    const hashEl = document.getElementById('temp-prompt-hash');
    const countEl = document.getElementById('temp-prompt-char-count');

    if (textarea) textarea.value = data.content || '';
    if (revEl) revEl.textContent = data.revision !== undefined ? data.revision : '-';
    if (hashEl) hashEl.textContent = data.sha256 ? data.sha256.slice(0, 12) : '-';
    if (countEl) countEl.textContent = `${(data.content || '').length} / 12000`;

    if (badge) {
      if (data.active) {
        badge.textContent = '已激活';
        badge.className = 'badge active-dot';
      } else {
        badge.textContent = '已关闭';
        badge.className = 'badge';
      }
    }
  } catch (e) {
    console.error('Failed to load temporary prompt:', e);
  }
}

async function saveTemporaryPrompt() {
  const textarea = document.getElementById('temp-prompt-textarea');
  if (!textarea) return;
  const content = textarea.value;
  if (content.length > 12000) {
    alert('临时提示词长度不能超过 12,000 字符！');
    return;
  }

  try {
    const res = await fetch('/api/temporary-prompt', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content })
    });
    if (res.ok) {
      const data = await res.json();
      appendConsole(`临时提示词已保存 (Revision ${data.revision})，将在下一次 Run 注入系统提示词。`, 'success');
      await loadTemporaryPrompt();
    } else {
      const err = await res.json();
      alert(`保存失败: ${err.detail || err.error}`);
    }
  } catch (e) {
    alert(`保存异常: ${e.message}`);
  }
}

async function clearTemporaryPrompt() {
  if (!confirm('确定清空临时提示词吗？\n清空后下一次 Run 将不再注入当前任务指引。此前已形成的交付物与远程操作不会被撤销。')) {
    return;
  }

  try {
    const res = await fetch('/api/temporary-prompt', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '' })
    });
    if (res.ok) {
      const data = await res.json();
      appendConsole(`临时提示词已清空并关闭 (Revision ${data.revision})。`, 'warn');
      await loadTemporaryPrompt();
    } else {
      const err = await res.json();
      alert(`清空失败: ${err.detail || err.error}`);
    }
  } catch (e) {
    alert(`清空异常: ${e.message}`);
  }
}

// ==================== 通用弹窗：工具目录 / 私有文件 / 执行记录 ====================

async function openToolsModal() {
  try {
    const res = await fetch('/api/tools');
    if (!res.ok) {
      alert('获取工具目录失败');
      return;
    }
    const data = await res.json();
    const tools = data.tools || [];
    document.getElementById('common-modal-title').textContent = `受控工具目录 (共 ${tools.length} 项)`;
    const body = document.getElementById('common-modal-body');
    body.replaceChildren();

    const desc = document.createElement('div');
    desc.style.cssText = 'color: #a0aec0; margin-bottom: 12px; font-size: 12px;';
    desc.textContent = '以下为已接入 V9 统一受控注册层的工具清单与输入参数 Schema (所有工具调用通过 operations 数组安全分发，凭据不回传前端)：';
    body.appendChild(desc);

    tools.forEach(t => {
      const card = document.createElement('div');
      card.style.cssText = 'background: #2d3748; padding: 10px; margin-bottom: 8px; border-radius: 4px; border-left: 3px solid ' + (t.enabled ? '#48bb78' : '#e53e3e') + ';';
      
      const head = document.createElement('div');
      head.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;';
      head.innerHTML = `<strong><code>${t.name}</code></strong> <span style="font-size: 11px; color: ${t.enabled ? '#68d391' : '#fc8181'};">[${t.effect.toUpperCase()}] ${t.enabled ? '启用' : '禁用'} (超时: ${t.timeout_seconds}s)</span>`;
      card.appendChild(head);

      const d = document.createElement('div');
      d.style.cssText = 'color: #e2e8f0; font-size: 12px; margin-bottom: 6px;';
      d.textContent = t.description;
      card.appendChild(d);

      const schemaPre = document.createElement('pre');
      schemaPre.style.cssText = 'background: #1a202c; padding: 6px 8px; border-radius: 3px; font-size: 11px; margin: 0; overflow-x: auto; color: #cbd5e0;';
      schemaPre.textContent = JSON.stringify(t.input_schema, null, 2);
      card.appendChild(schemaPre);

      body.appendChild(card);
    });

    document.getElementById('common-modal').style.display = 'flex';
  } catch (e) {
    alert(`加载工具目录失败: ${e.message}`);
  }
}

async function openPrivateFilesModal(subPath = '') {
  try {
    const res = await fetch(`/api/private-files?path=${encodeURIComponent(subPath)}`);
    if (!res.ok) {
      alert('获取私有文件列表失败');
      return;
    }
    const data = await res.json();
    const files = data.files || [];
    document.getElementById('common-modal-title').textContent = `私有文件空间 (workspace/private${subPath ? '/' + subPath : ''})`;
    const body = document.getElementById('common-modal-body');
    body.replaceChildren();

    const hint = document.createElement('div');
    hint.style.cssText = 'color: #a0aec0; margin-bottom: 12px; font-size: 12px;';
    hint.textContent = '存放私有配置、业务资料、凭据与多模态图片。已知凭据文件受脱敏保护；图片可在线预览：';
    body.appendChild(hint);

    if (files.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = '当前目录下无文件。';
      body.appendChild(empty);
    } else {
      files.forEach(f => {
        const row = document.createElement('div');
        row.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; background: #2d3748; margin-bottom: 6px; border-radius: 4px;';
        
        const left = document.createElement('span');
        const icon = f.type === 'directory' ? '📁' : (/\.(jpe?g|png|webp|gif)$/i.test(f.name) ? '🖼️' : '📄');
        left.textContent = `${icon} ${f.name} ${f.size_bytes ? '(' + f.size_bytes.toLocaleString() + ' 字节)' : ''}`;
        if (f.is_sensitive) {
          left.innerHTML += ' <span style="color: #f6ad55; font-size: 11px;">[凭据脱敏保护]</span>';
        }
        row.appendChild(left);

        const right = document.createElement('div');
        if (/\.(jpe?g|png|webp|gif)$/i.test(f.name) && !f.is_sensitive) {
          const prevBtn = document.createElement('button');
          prevBtn.className = 'btn btn-xs btn-primary';
          prevBtn.textContent = '预览图片';
          prevBtn.onclick = () => previewPrivateImage(f.path);
          right.appendChild(prevBtn);
        }
        row.appendChild(right);
        body.appendChild(row);
      });
    }

    document.getElementById('common-modal').style.display = 'flex';
  } catch (e) {
    alert(`加载私有文件失败: ${e.message}`);
  }
}

function previewPrivateImage(path) {
  document.getElementById('common-modal-title').textContent = `图片预览: ${path}`;
  const body = document.getElementById('common-modal-body');
  body.replaceChildren();

  const backBtn = document.createElement('button');
  backBtn.className = 'btn btn-xs btn-secondary';
  backBtn.style.cssText = 'margin-bottom: 10px; display: block;';
  backBtn.textContent = '← 返回文件列表';
  backBtn.onclick = () => openPrivateFilesModal();
  body.appendChild(backBtn);

  const imgBox = document.createElement('div');
  imgBox.style.cssText = 'text-align: center; background: #1a202c; padding: 12px; border-radius: 4px;';
  const img = document.createElement('img');
  img.src = `/api/private-files/preview?path=${encodeURIComponent(path)}`;
  img.alt = path;
  img.style.cssText = 'max-width: 100%; max-height: 500px; border-radius: 4px; box-shadow: 0 4px 6px rgba(0,0,0,0.3);';
  imgBox.appendChild(img);
  body.appendChild(imgBox);
}

async function openToolExecutionsModal() {
  try {
    const res = await fetch('/api/tool-executions?limit=50');
    if (!res.ok) {
      alert('获取工具执行记录失败');
      return;
    }
    const data = await res.json();
    const list = data.executions || [];
    document.getElementById('common-modal-title').textContent = `外部工具执行历史 (最近 ${list.length} 条)`;
    const body = document.getElementById('common-modal-body');
    body.replaceChildren();

    if (list.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = '暂无外部工具执行记录。在提示词中指示元胞执行 operations 后可在此查看真实状态。';
      body.appendChild(empty);
    } else {
      list.forEach(ex => {
        const item = document.createElement('div');
        const color = ex.status === 'SUCCESS' ? '#48bb78' : (ex.status === 'UNKNOWN' ? '#ecc94b' : '#e53e3e');
        item.style.cssText = `background: #2d3748; padding: 10px; margin-bottom: 8px; border-radius: 4px; border-left: 3px solid ${color};`;
        
        const header = document.createElement('div');
        header.style.cssText = 'display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px;';
        const dateStr = ex.started_at ? new Date(ex.started_at * 1000).toLocaleTimeString() : '-';
        header.innerHTML = `<strong>${ex.tool}</strong> <span style="color: ${color}; font-weight: bold;">[${ex.status}]</span> <span style="color: #a0aec0;">${dateStr} (Pixel: ${ex.pixel_id})</span>`;
        item.appendChild(header);

        const resPre = document.createElement('pre');
        resPre.style.cssText = 'background: #1a202c; padding: 6px 8px; border-radius: 3px; font-size: 11px; margin: 0; overflow-x: auto; color: #cbd5e0; max-height: 120px;';
        resPre.textContent = JSON.stringify(ex.result, null, 2);
        item.appendChild(resPre);

        body.appendChild(item);
      });
    }

    document.getElementById('common-modal').style.display = 'flex';
  } catch (e) {
    alert(`加载执行历史失败: ${e.message}`);
  }
}
