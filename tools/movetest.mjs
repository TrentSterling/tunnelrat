// movetest.mjs : verifies the ship actually flies. Dispatches synthetic KeyW to the
// page, asserts the ship translates through open air without wall-clipping.
// Usage: node tools/movetest.mjs [url]
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const url = process.argv[2] || 'http://localhost:8123';
const PORT = 9400 + Math.floor((Date.now() / 1000) % 300);
const userDir = join(tmpdir(), 'tr-move-' + PORT);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  '--window-size=1280,720', '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });

async function cdpUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const j = await r.json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('CDP not ready');
}

let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS: ' : 'FAIL: ') + msg); if (!ok) fails++; };

(async () => {
  const ws = new WebSocket(await cdpUrl());
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params = {}, sessionId) => new Promise((res) => {
    pending.set(++id, (m) => res(m.result));
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);
  await send('Page.navigate', { url }, sessionId);
  const evl = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
    return r?.result?.value;
  };

  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) { await sleep(500); ready = await evl('window.TR?.ready === true'); }
  check(ready, 'TR.ready');

  const p0 = await evl('TR.ship.object3d.position.toArray()');
  await evl(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' })); true`);
  await sleep(1500);
  await evl(`window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' })); true`);
  const p1 = await evl('TR.ship.object3d.position.toArray()');
  const d = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
  check(d > 3, `ship flew forward on KeyW (moved ${d.toFixed(1)}m in 1.5s)`);

  await sleep(1200); // damping should bleed most residual speed
  const spd = await evl('TR.ship.velocity.length()');
  check(spd < 12, `damping bleeds speed after keyup (now ${spd.toFixed(1)} m/s)`);

  const inAir = await evl('TR.field.sample(TR.ship.object3d.position.x, TR.ship.object3d.position.y, TR.ship.object3d.position.z) < 0');
  check(inAir, 'ship still in open air (no wall clip)');

  const shields = await evl('TR.ship.shields');
  check(shields > 0, `ship alive (shields ${shields})`);

  console.log(fails === 0 ? '\nMOVETEST: all passed' : `\nMOVETEST: ${fails} FAILED`);
  ws.close(); chrome.kill(); process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error(e); chrome.kill(); process.exit(1); });
