// 心跳闪电视觉验证：触发预览钩子，按时间轴采样调试值并抓取关键相位截图
const port = 9333;

async function getTarget() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json`);
      const list = await res.json();
      const page =
        list.find((t) => t.type === 'page' && t.url.startsWith('http://127.0.0.1:5173')) ??
        list.find((t) => t.type === 'page' && t.url.startsWith('http'));
      if (page) return page;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('CDP target not found');
}

const target = await getTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id).resolve(msg.result);
    pending.delete(msg.id);
  }
  // 持续确认 screencast 帧，驱动隐藏窗口的合成器不断帧
  if (msg.method === 'Page.screencastFrame') {
    ws.send(JSON.stringify({ id: ++id, method: 'Page.screencastFrameAck', params: { sessionId: msg.params.sessionId } }));
  }
};
await new Promise((r) => (ws.onopen = r));

await send('Page.enable');
await send('Runtime.enable');
await send('Page.startScreencast', { format: 'jpeg', quality: 30, everyNthFrame: 2 });
await new Promise((r) => setTimeout(r, 6000));

const fs = await import('fs');
const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true });
  return res.result?.value;
};
const shoot = async (name) => {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${process.env.TEMP}\\${name}.png`, Buffer.from(shot.data, 'base64'));
  console.log('SHOT', name);
};

console.log('hook:', await evaluate('typeof window.__triggerHeartbeatWave'));

// 节流环境下确定性对齐相位：每次以 offset 直接跳到目标时刻，等一帧后截图
const waitFrame = async () => {
  await send('Runtime.evaluate', {
    expression: 'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))',
    awaitPromise: true,
    timeout: 15000,
  });
};
const phases = [
  [1.0, 'hb-breathe'],
  [3.65, 'hb-peak1'],
  [4.05, 'hb-valley'],
  [4.48, 'hb-peak2'],
  [6.5, 'hb-decay'],
  [8.3, 'hb-end'],
];
for (const [at, name] of phases) {
  await evaluate(`window.__triggerHeartbeatWave && window.__triggerHeartbeatWave(${at})`);
  await waitFrame();
  console.log('debug@' + name, JSON.stringify(await evaluate('window.__heartbeatDebug && window.__heartbeatDebug()')));
  await shoot(name);
}
process.exit(0);
