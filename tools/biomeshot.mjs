// biomeshot.mjs : screenshot tools/biomeview.html at each depth (biome + props
// verification). Raw CDP, zero deps, same pattern as tools/smoketest.mjs.
// Usage: node tools/biomeshot.mjs [baseUrl] [depths, e.g. 1,2,3] [at]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const base = process.argv[2] || 'http://localhost:8123';
const depths = (process.argv[3] || '1,2,3').split(',').map(Number);
const at = process.argv[4] || 'prop';
const W = 1600, H = 900;
const PORT = 9722 + Math.floor((Date.now() / 1000) % 200);
const userDir = join(tmpdir(), 'tr-biome-' + PORT);
const outDir = join(__dirname, 'out');
mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  `--window-size=${W},${H}`, '--hide-scrollbars', '--disable-gpu-vsync',
  '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });

let killed = false;
const killChrome = () => { if (!killed) { killed = true; try { chrome.kill(); } catch {} } };

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

(async () => {
  const ws = new WebSocket(await cdpUrl());
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  const { send } = rpc(ws);
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const errors = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
    }
  });
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);

  for (const depth of depths) {
    const url = `${base}/tools/biomeview.html?depth=${depth}&at=${at}`;
    await send('Page.navigate', { url }, sessionId);
    let info = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
      const r = await send('Runtime.evaluate', {
        expression: 'window.BV && window.BV.ready ? JSON.stringify(window.BV) : null',
        returnByValue: true,
      }, sessionId);
      if (r?.result?.value) { info = JSON.parse(r.result.value); break; }
      await sleep(300);
    }
    if (!info) { console.log(`depth ${depth}: TIMEOUT; errors: ${errors.join(' | ')}`); continue; }
    await sleep(300);
    const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    const file = join(outDir, `biome-d${depth}-${info.biome}${at !== 'prop' ? '-' + at : ''}.png`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    console.log(`depth ${depth}: biome=${info.biome} props=${JSON.stringify(info.props)} -> ${file}`);
  }
  if (errors.length) console.log('PAGE ERRORS: ' + errors.join(' | '));
  ws.close();
  killChrome();
  process.exit(0);
})().catch((e) => { console.error('BIOMESHOT CRASHED:', e); killChrome(); process.exit(1); });
