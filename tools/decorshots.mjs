// one-off: teleport to exit + reactor and screenshot the built-section decor
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const url = 'http://localhost:8123';
const OUT = 'C:/trontstack/tunnelrat/tools/out/';
const PORT = 9770 + Math.floor((Date.now() / 1000) % 200);
const userDir = join(tmpdir(), 'tr-decor-' + PORT);
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

  await evl('TR.debug.god(); true');

  // built styles report
  console.log('styles: ' + await evl(
    `JSON.stringify({
      builtRooms: TR.graph.nodes.filter(n => n.style === 'built').map(n => n.kind + ':' + n.id),
      builtEdges: TR.graph.edges.filter(e => e.style === 'built').length,
      totalEdges: TR.graph.edges.length,
    })`));

  await evl(`TR.debug.teleport('exit'); true`);
  await sleep(1200);
  await shot('wg-exit.png');

  await evl(`TR.debug.teleport('reactor'); true`);
  await sleep(1200);
  await shot('wg-reactor.png');

  // look at the locked door from just inside the corridor (frame + red strips)
  console.log('door setup: ' + await evl(`(() => {
    const g = TR.graph;
    const byId = new Map(g.nodes.map(n => [n.id, n]));
    const a = byId.get(g.lockedEdge.a), b = byId.get(g.lockedEdge.b);
    const mid = a.pos.clone().lerp(b.pos, 0.5);
    const dir = b.pos.clone().sub(a.pos).normalize();
    const eye = mid.clone().addScaledVector(dir, -6.5);
    TR.ship.object3d.position.copy(eye); TR.ship.velocity.set(0,0,0);
    TR.ship.object3d.lookAt(mid);
    TR.ship.object3d.rotateY(Math.PI); // plain Object3D.lookAt points +Z; ship forward is -Z
    return JSON.stringify({ eye: eye.toArray().map(v=>+v.toFixed(1)), mid: mid.toArray().map(v=>+v.toFixed(1)) });
  })()`));
  await sleep(1200);
  console.log('door after settle: ' + await evl(`(() => {
    const p = TR.ship.object3d.position;
    const q = TR.ship.object3d.quaternion;
    return JSON.stringify({ pos: p.toArray().map(v=>+v.toFixed(1)), quat: q.toArray().map(v=>+v.toFixed(2)) });
  })()`));
  await shot('wg-door.png');

  console.log('exceptions: ' + logs.length);
  logs.slice(0, 10).forEach((l) => console.log(l));
  ws.close(); chrome.kill(); process.exit(0);
})().catch((e) => { console.error(e); chrome.kill(); process.exit(1); });
