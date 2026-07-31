// shoot.mjs — headless-Chrome screenshot via raw CDP (Node 24 global WebSocket, zero deps).
// Usage: node tools/shoot.mjs <url> <outPng> [waitMs] [width] [height]
// Copied from graveyardgame/tools/shoot.mjs. Captures a PNG plus console logs and
// exceptions — exceptions are how we catch ESM import failures the moment they happen.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const url = process.argv[2];
const out = process.argv[3];
const waitMs = parseInt(process.argv[4] || '6000', 10);
const W = parseInt(process.argv[5] || '1600', 10);
const H = parseInt(process.argv[6] || '900', 10);
const PORT = 9222 + Math.floor((Date.now() / 1000) % 500);
const userDir = join(tmpdir(), 'hp-chrome-' + PORT);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  `--window-size=${W},${H}`, '--hide-scrollbars', '--disable-gpu-vsync',
  '--no-first-run', '--no-default-browser-check', 'about:blank',
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

function rpc(ws) {
  let id = 0;
  const pending = new Map();
  const sessionPending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    const map = m.sessionId ? sessionPending : pending;
    if (m.id && map.has(m.id)) { map.get(m.id)(m); map.delete(m.id); }
  });
  const send = (method, params = {}, sessionId) => new Promise((res) => {
    const myId = ++id;
    (sessionId ? sessionPending : pending).set(myId, (m) => res(m.result));
    ws.send(JSON.stringify({ id: myId, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return { send };
}

const logs = [];

(async () => {
  const wsUrl = await cdpUrl();
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  const { send } = rpc(ws);

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });

  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.consoleAPICalled') {
      const text = (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
      logs.push(`[${m.params.type}] ${text}`);
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const e = m.params.exceptionDetails;
      logs.push(`[exception] ${e.exception?.description || e.text}`);
    }
  });

  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Page.navigate', { url }, sessionId);
  await sleep(waitMs);

  const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  writeFileSync(out, Buffer.from(data, 'base64'));
  console.log('SAVED ' + out);
  console.log('--- console (' + logs.length + ') ---');
  console.log(logs.slice(0, 60).join('\n'));

  ws.close();
  chrome.kill();
  process.exit(0);
})().catch((e) => { console.error(e); chrome.kill(); process.exit(1); });
