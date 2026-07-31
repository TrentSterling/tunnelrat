// one-off: verify the teleport-orientation, showcase-third-person, and death-cinematic
// legibility fixes. Reproduces the exact literal repro steps from the bug report.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const url = 'http://localhost:8123';
const OUT = 'C:/trontstack/tunnelrat/tools/out/';
const PORT = 9700 + Math.floor((Date.now() / 1000) % 200);
const userDir = join(tmpdir(), 'tr-fixverify-' + PORT);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  '--window-size=1600,900', '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });

async function cdpUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('CDP not ready');
}

const logs = [];
(async () => {
  const ws = new WebSocket(await cdpUrl());
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') logs.push('[exception] ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
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
  const evl = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true }, sessionId))?.result?.value;
  const shot = async (name) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    writeFileSync(OUT + name, Buffer.from(data, 'base64'));
    console.log('SAVED ' + name);
  };

  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) { await sleep(500); ready = await evl('window.TR?.ready === true'); }
  if (!ready) throw new Error('never ready');

  // --- 1. teleport(exit) literal repro ---
  await evl(`TR.debug.teleport('exit'); true`);
  await sleep(300);
  await shot('fix-exit.png');
  console.log('exit fwd: ' + await evl('JSON.stringify(TR.ship.forward(new THREE.Vector3?.() || {x:0,y:0,z:0}))').catch?.(() => null));

  // --- 2. teleport(reactor) literal repro ---
  await evl(`TR.debug.teleport('reactor'); true`);
  await sleep(300);
  await shot('fix-reactor.png');

  // --- 3. showcase literal repro: TR.debug.god(); TR.debug.showcase(); in default FP mode ---
  await evl(`TR.debug.god(); true`);
  await evl(`TR.debug.teleport('spawn'); true`); // back to a normal open area
  await sleep(300);
  await evl(`TR.debug.showcase(); true`);
  await sleep(300);
  await shot('fix-showcase.png');
  console.log('thirdPerson after showcase: ' + await evl(`document.querySelector('#hud') ? 'n/a' : 'n/a'`));

  // --- 4. death cinematic literal repro (deathtest.mjs pattern) ---
  await evl(`TR.debug.teleport('spawn'); true`);
  await sleep(200);
  await evl('TR.ship.takeDamage(99999); true');
  await sleep(800);
  await shot('fix-death-tumble.png');
  await sleep(1400);
  await shot('fix-death-boom.png');

  console.log('exceptions: ' + logs.length);
  logs.slice(0, 10).forEach((l) => console.log(l));
  ws.close(); chrome.kill(); process.exit(logs.length ? 1 : 0);
})().catch((e) => { console.error(e); chrome.kill(); process.exit(1); });
