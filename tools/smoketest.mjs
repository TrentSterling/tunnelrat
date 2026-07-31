// smoketest.mjs : headless-Chrome end-to-end smoke test via raw CDP (Node global
// WebSocket, zero deps). Modeled on tools/shoot.mjs.
// Usage: node tools/smoketest.mjs [url]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const url = process.argv[2] || 'http://localhost:8123';
const W = 1600, H = 900;
const PORT = 9222 + Math.floor((Date.now() / 1000) % 500);
const userDir = join(tmpdir(), 'tr-smoke-' + PORT);
const outDir = join(__dirname, 'out');
mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  `--window-size=${W},${H}`, '--hide-scrollbars', '--disable-gpu-vsync',
  '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });

let killed = false;
function killChrome() {
  if (killed) return;
  killed = true;
  try { chrome.kill(); } catch {}
}

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

const consoleLogs = [];
const exceptions = [];

async function evalJs(send, sessionId, expression, { awaitPromise = false } = {}) {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise,
  }, sessionId);
  if (result?.exceptionDetails) {
    const e = result.exceptionDetails;
    return { error: e.exception?.description || e.text };
  }
  return { value: result?.result?.value };
}

let passCount = 0;
let failCount = 0;
function check(label, cond, extra = '') {
  if (cond) {
    passCount++;
    console.log(`PASS: ${label}`);
  } else {
    failCount++;
    console.log(`FAIL: ${label}${extra ? ' -- ' + extra : ''}`);
  }
  return cond;
}

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
      consoleLogs.push(`[${m.params.type}] ${text}`);
      if (m.params.type === 'error') exceptions.push(`[console.error] ${text}`);
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const e = m.params.exceptionDetails;
      const text = `[exception] ${e.exception?.description || e.text}`;
      consoleLogs.push(text);
      exceptions.push(text);
    }
  });

  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Page.navigate', { url }, sessionId);

  // --- 1. wait for window.TR?.ready === true (up to 30s) ---
  let ready = false;
  const startWait = Date.now();
  while (Date.now() - startWait < 30000) {
    const r = await evalJs(send, sessionId, 'window.TR && window.TR.ready === true');
    if (r.value === true) { ready = true; break; }
    await sleep(250);
  }
  check('window.TR.ready became true within 30s', ready);

  if (!ready) {
    console.log('--- console (' + consoleLogs.length + ') ---');
    console.log(consoleLogs.slice(0, 80).join('\n'));
    killChrome();
    console.log(`\n${passCount} passed, ${failCount} failed`);
    process.exit(1);
  }

  // --- 2. screenshot spawn ---
  await sleep(300);
  {
    const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    writeFileSync(join(outDir, 'smoke-spawn.png'), Buffer.from(data, 'base64'));
    console.log('SAVED tools/out/smoke-spawn.png');
  }

  // --- 3. fps measurement over 2s ---
  const fpsExpr = `
    new Promise((resolve) => {
      let count = 0;
      const t0 = performance.now();
      function tick() {
        count++;
        if (performance.now() - t0 < 2000) requestAnimationFrame(tick);
        else resolve(count / ((performance.now() - t0) / 1000));
      }
      requestAnimationFrame(tick);
    })
  `;
  const fpsResult = await evalJs(send, sessionId, fpsExpr, { awaitPromise: true });
  const fps = fpsResult.value;
  if (fpsResult.error) console.log('fps measurement error: ' + fpsResult.error);
  check(`fps >= 20 (measured ${fps != null ? fps.toFixed(1) : 'null'})`, typeof fps === 'number' && fps >= 20);

  // --- 4. drive the loop via debug API ---
  async function run(expr, label) {
    const r = await evalJs(send, sessionId, expr, { awaitPromise: false });
    if (r.error) {
      exceptions.push(`[debug-step:${label}] ${r.error}`);
      check(label, false, r.error);
      return false;
    }
    return true;
  }

  await run('TR.debug.god(); "ok"', 'debug.god()');
  await run('TR.debug.giveKey(); "ok"', 'debug.giveKey()');
  await run(`TR.debug.teleport('reactor'); "ok"`, `debug.teleport('reactor')`);
  await sleep(1500);
  await run('TR.debug.killReactor(); "ok"', 'debug.killReactor()');
  await sleep(1500);

  const phase1 = await evalJs(send, sessionId, 'TR.gamestate ? TR.gamestate.phase : null');
  check(`gamestate.phase === 'escape' after killReactor (got ${JSON.stringify(phase1.value)})`, phase1.value === 'escape');

  await run(`TR.debug.teleport('exit'); "ok"`, `debug.teleport('exit')`);
  await sleep(2500);

  const phase2 = await evalJs(send, sessionId, 'TR.gamestate ? TR.gamestate.phase : null');
  check(`gamestate.phase === 'won' after reaching exit (got ${JSON.stringify(phase2.value)})`, phase2.value === 'won');

  // --- 5. screenshot final ---
  {
    const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    writeFileSync(join(outDir, 'smoke-final.png'), Buffer.from(data, 'base64'));
    console.log('SAVED tools/out/smoke-final.png');
  }

  // --- any exception during the whole run = FAIL ---
  check(`no console errors/exceptions during run (${exceptions.length} found)`, exceptions.length === 0,
    exceptions.slice(0, 10).join(' | '));

  console.log('--- console (' + consoleLogs.length + ') ---');
  console.log(consoleLogs.slice(0, 80).join('\n'));

  ws.close();
  killChrome();

  console.log(`\n${passCount} passed, ${failCount} failed`);
  process.exit(failCount === 0 ? 0 : 1);
})().catch((e) => {
  console.error('SMOKETEST CRASHED:', e);
  killChrome();
  process.exit(1);
});
