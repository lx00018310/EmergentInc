// 临时 CDP 诊断脚本：检查页面真实视口高度与底部白色区域归属
const port = 9333;

async function getTarget() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
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
};
await new Promise((r) => (ws.onopen = r));

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:5173/' });
await new Promise((r) => setTimeout(r, 6000));

const expr = `JSON.stringify({
  innerW: window.innerWidth,
  innerH: window.innerHeight,
  dpr: window.devicePixelRatio,
  docH: document.documentElement.clientHeight,
  bodyH: document.body.getBoundingClientRect().height,
  rootH: document.getElementById('root').getBoundingClientRect().height,
  bodyBg: getComputedStyle(document.body).background.slice(0,120),
  elAtBand: (() => {
    const el = document.elementFromPoint(window.innerWidth/2, window.innerHeight - 3);
    return el ? el.tagName + '.' + el.className : 'null';
  })(),
  elAtBandLow: (() => {
    const el = document.elementFromPoint(window.innerWidth/2, window.innerHeight - 60);
    return el ? el.tagName + '.' + el.className : 'null';
  })()
})`;

const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
console.log('METRICS:', res.result.value);

const shot = await send('Page.captureScreenshot', { format: 'png' });
const fs = await import('fs');
fs.writeFileSync(process.env.TEMP + '\\midnight-cdp.png', Buffer.from(shot.data, 'base64'));
console.log('SCREENSHOT_SAVED');
process.exit(0);
