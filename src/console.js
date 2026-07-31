// console.js : dev cheat console. Retro CRT terminal + clickable cheat panel,
// both in one overlay this module builds and owns. No framework, DOM built once.
//
// CONTRACT (implement exactly):
//
// class CheatConsole {
//   constructor(container, actions)  // container: parent to append the overlay root to
//                                     // (integrator passes document.body); creates its
//                                     // own fixed-position root div, hidden by default.
//   open: boolean                    // true while the overlay is visible/capturing input;
//                                     // integrator reads this each frame to skip game input.
//   toggle()                         // opens/closes; on open, focuses the input and calls
//                                     // document.exitPointerLock(); on close, refocuses body.
// }
//
// actions (integrator-supplied):
//   god()            -> void   toggle invuln
//   giveAll()        -> void   full shields/energy/key/weapons
//   noclip()         -> bool   toggles noclip, RETURNS new state (for echo)
//   frames()         -> bool   toggles fps/frametime graph, RETURNS new state
//   slomo(n)         -> void   sets timescale to n
//   spawn(kind)      -> void   spawns one enemy of kind near the ship
//   mapAll()         -> void   reveals full automap
//   warp(delta)      -> void   integrator interprets '+1' -> +1, '-1' -> -1, else absolute depth n
//   matrix()         -> void   toggles the debug wireframe overlay
//   kinds: string[]            enemy kind ids for the SPAWN panel row, e.g.
//                               ['grunt','claw','hulk','sniper','turret']
//
// Keyboard: while open, ALL keydown/keyup/keypress on the console root call
// stopPropagation (game input listeners are on window, so this keeps the ship still).
// Backquote toggle itself is the integrator's job (bound on window, calls toggle()).
//
// Style: green-on-black CRT, Courier New, uppercase labels, thin borders, scanline
// background, blinking block cursor on the input line. Matches src/hud.js conventions
// (--accent green from index.html's :root vars).

const CSS = `
#trConsole { position:fixed; inset:0; z-index:60; display:none; font-family:'Courier New', monospace;
  color:var(--accent, #5cff8a); background:rgba(3,6,4,.86); }
#trConsole.open { display:flex; }
#trConsole * { box-sizing:border-box; }
#trConsole .tr-scanlines { position:absolute; inset:0; pointer-events:none;
  background:repeating-linear-gradient(180deg, rgba(92,255,138,.05) 0px, rgba(92,255,138,.05) 1px,
  transparent 2px, transparent 4px); mix-blend-mode:screen; }
#trConsole .tr-wrap { position:relative; margin:auto; width:min(920px, 92vw); height:min(560px, 82vh);
  display:flex; border:1px solid rgba(92,255,138,.45); box-shadow:0 0 40px rgba(92,255,138,.15),
  inset 0 0 60px rgba(92,255,138,.06); background:rgba(4,8,6,.92); }

#trConsole .tr-term { flex:1 1 auto; display:flex; flex-direction:column; min-width:0;
  border-right:1px solid rgba(92,255,138,.3); }
#trConsole .tr-titlebar { padding:8px 14px; font-size:12px; letter-spacing:4px;
  border-bottom:1px solid rgba(92,255,138,.3); color:var(--accent, #5cff8a);
  text-shadow:0 0 8px rgba(92,255,138,.5); display:flex; justify-content:space-between; }
#trConsole .tr-titlebar span.hint { color:#4a6a55; letter-spacing:2px; font-size:11px; }
#trConsole .tr-log { flex:1 1 auto; overflow-y:auto; padding:10px 14px; font-size:13px;
  line-height:1.5; letter-spacing:.5px; white-space:pre-wrap; word-break:break-word; }
#trConsole .tr-log .err { color:var(--danger, #ff3b3b); }
#trConsole .tr-log .info { color:var(--cyan, #39d0ff); }
#trConsole .tr-log .echo { color:#7fdb9c; }
#trConsole .tr-inputrow { display:flex; align-items:center; padding:8px 14px;
  border-top:1px solid rgba(92,255,138,.3); font-size:13px; letter-spacing:1px; }
#trConsole .tr-prompt { margin-right:8px; color:var(--accent2, #ffb13b); }
#trConsole .tr-inputline { position:relative; flex:1 1 auto; display:flex; align-items:center; }
#trConsole .tr-input { flex:1 1 auto; background:transparent; border:none; outline:none;
  color:var(--accent, #5cff8a); font:inherit; letter-spacing:1px; caret-color:transparent; }
#trConsole .tr-cursor { width:8px; height:15px; background:var(--accent, #5cff8a);
  margin-left:1px; animation:trBlink 1s step-end infinite; }
@keyframes trBlink { 50% { opacity:0; } }

#trConsole .tr-panel { flex:0 0 240px; display:flex; flex-direction:column; overflow-y:auto;
  padding:10px 12px; gap:10px; }
#trConsole .tr-panel h3 { font-size:11px; letter-spacing:3px; color:#4a6a55; margin:6px 0 2px; }
#trConsole .tr-panel h3:first-child { margin-top:0; }
#trConsole .tr-row { display:flex; flex-wrap:wrap; gap:6px; }
#trConsole .tr-btn { flex:1 1 auto; padding:6px 8px; font:inherit; font-size:11px;
  letter-spacing:1.5px; text-transform:uppercase; color:var(--accent, #5cff8a);
  background:rgba(92,255,138,.06); border:1px solid rgba(92,255,138,.4); cursor:pointer; }
#trConsole .tr-btn:hover { background:rgba(92,255,138,.18); box-shadow:0 0 10px rgba(92,255,138,.35); }
#trConsole .tr-btn:active { background:rgba(92,255,138,.32); }
#trConsole .tr-btn.wide { flex:1 1 100%; }
#trConsole .tr-btn.danger { color:var(--danger, #ff3b3b); border-color:rgba(255,59,59,.5);
  background:rgba(255,59,59,.06); }
#trConsole .tr-btn.danger:hover { background:rgba(255,59,59,.18); }
`;

const HELP_ROWS = [
  ['GOD / GABBAGABBAHEY', 'toggle invulnerability'],
  ['GIVEALL / POBAM', 'full shields, energy, key, weapons'],
  ['NOCLIP / GOUDAT', 'toggle wall collision'],
  ['FRAMES', 'toggle fps / frametime graph'],
  ['SLOMO <n>', 'set timescale, e.g. SLOMO 0.5'],
  ['SPAWN <kind>', 'spawn an enemy near the ship'],
  ['MAPALL', 'reveal the full automap'],
  ['WARP <+1|-1|n>', 'change depth'],
  ['MATRIX', 'toggle debug wireframe overlay'],
  ['HELP', 'show this table'],
];

const SASS = [
  "UNKNOWN COMMAND. THIS ISN'T THE PYRO-GX MANUAL.",
  'NOT A COMMAND. NOT EVEN CLOSE.',
  'THE MINE DOES NOT RECOGNIZE THAT INCANTATION.',
  "TRY 'HELP' BEFORE YOU TRY MY PATIENCE.",
  'REACTOR CORE SAYS: NO.',
  "THAT'S GIBBERISH EVEN BY GABBAGABBAHEY STANDARDS.",
];

export class CheatConsole {
  constructor(container, actions) {
    this.actions = actions;
    this.open = false;
    this.history = [];
    this.histIndex = -1;
    this._sassIndex = 0;

    this._injectStyle();

    const root = mk('div', null);
    root.id = 'trConsole';

    const scan = mk('div', 'tr-scanlines');

    const wrap = mk('div', 'tr-wrap');

    const term = mk('div', 'tr-term');
    const titlebar = mk('div', 'tr-titlebar');
    titlebar.append(mk('span', null, 'TUNNELRAT :: DEBUG CONSOLE'), mk('span', 'hint', '` TO CLOSE'));
    const log = mk('div', 'tr-log');
    const inputrow = mk('div', 'tr-inputrow');
    const prompt = mk('span', 'tr-prompt', '>');
    const inputline = mk('div', 'tr-inputline');
    const input = document.createElement('input');
    input.className = 'tr-input';
    input.autocomplete = 'off';
    input.spellcheck = false;
    const cursor = mk('span', 'tr-cursor');
    inputline.append(input, cursor);
    inputrow.append(prompt, inputline);
    term.append(titlebar, log, inputrow);

    const panel = mk('div', 'tr-panel');
    this._buildPanel(panel);

    wrap.append(term, panel);
    root.append(scan, wrap);
    container.appendChild(root);

    this.el = { root, log, input };

    this._println('TUNNELRAT DEBUG CONSOLE :: TYPE HELP', 'info');

    // keep focus on the input whenever the console is open and something is clicked
    // inside the terminal pane (buttons manage their own focus via action())
    root.addEventListener('mousedown', () => {
      if (this.open) setTimeout(() => input.focus(), 0);
    });

    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const raw = input.value;
        input.value = '';
        this._submit(raw);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this._historyNav(-1);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this._historyNav(1);
      } else if (e.key === 'Escape') {
        this.toggle();
      }
    });
    input.addEventListener('keyup', (e) => e.stopPropagation());
    input.addEventListener('keypress', (e) => e.stopPropagation());
    // block the rest of the console root too, in case focus ever lands elsewhere in it
    root.addEventListener('keydown', (e) => e.stopPropagation());
    root.addEventListener('keyup', (e) => e.stopPropagation());
    root.addEventListener('keypress', (e) => e.stopPropagation());
  }

  _injectStyle() {
    if (document.getElementById('trconsole-style')) return;
    const style = document.createElement('style');
    style.id = 'trconsole-style';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  _buildPanel(panel) {
    const a = this.actions;

    panel.append(mk('h3', null, 'CHEATS'));
    const row1 = mk('div', 'tr-row');
    row1.append(
      this._btn('GOD', () => this._run('GOD')),
      this._btn('GIVEALL', () => this._run('GIVEALL')),
    );
    const row2 = mk('div', 'tr-row');
    row2.append(
      this._btn('NOCLIP', () => this._run('NOCLIP')),
      this._btn('FRAMES', () => this._run('FRAMES')),
    );
    panel.append(row1, row2);

    panel.append(mk('h3', null, 'SLOMO'));
    const slomoRow = mk('div', 'tr-row');
    ['0.2', '0.5', '1'].forEach((n) => {
      slomoRow.append(this._btn(n, () => this._run('SLOMO ' + n)));
    });
    panel.append(slomoRow);

    panel.append(mk('h3', null, 'SPAWN'));
    const spawnRow = mk('div', 'tr-row');
    (a.kinds || []).forEach((kind) => {
      spawnRow.append(this._btn(kind, () => this._run('SPAWN ' + kind)));
    });
    panel.append(spawnRow);

    panel.append(mk('h3', null, 'MISC'));
    const warpRow = mk('div', 'tr-row');
    warpRow.append(
      this._btn('WARP -1', () => this._run('WARP -1')),
      this._btn('WARP +1', () => this._run('WARP +1')),
    );
    const miscRow = mk('div', 'tr-row');
    miscRow.append(
      this._btn('MAPALL', () => this._run('MAPALL')),
      this._btn('MATRIX', () => this._run('MATRIX')),
    );
    panel.append(warpRow, miscRow, this._btn('HELP', () => this._run('HELP'), 'wide'));
  }

  _btn(label, onClick, extraCls) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tr-btn' + (extraCls ? ' ' + extraCls : '');
    b.textContent = label;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
      this.el.input.focus();
    });
    return b;
  }

  toggle() {
    this.open = !this.open;
    this.el.root.classList.toggle('open', this.open);
    if (this.open) {
      document.exitPointerLock();
      this.histIndex = this.history.length;
      setTimeout(() => this.el.input.focus(), 0);
    } else {
      this.el.input.blur();
      document.body.focus?.();
    }
  }

  _historyNav(dir) {
    if (this.history.length === 0) return;
    this.histIndex = clamp(this.histIndex + dir, 0, this.history.length);
    this.el.input.value = this.histIndex < this.history.length ? this.history[this.histIndex] : '';
  }

  _submit(raw) {
    const cmd = raw.trim();
    if (!cmd) return;
    this.history.push(cmd);
    this.histIndex = this.history.length;
    this._println('> ' + cmd, 'echo');
    this._run(cmd);
  }

  _run(cmd) {
    const a = this.actions;
    const parts = cmd.trim().split(/\s+/);
    const head = (parts[0] || '').toUpperCase();
    const rest = parts.slice(1);

    switch (head) {
      case 'GOD':
      case 'GABBAGABBAHEY':
        a.god();
        this._println('INVULNERABILITY TOGGLED. GABBAGABBAHEY.', 'info');
        break;

      case 'GIVEALL':
      case 'POBAM':
        a.giveAll();
        this._println('POBAM! FULL SHIELDS, ENERGY, KEY, WEAPONS.', 'info');
        break;

      case 'NOCLIP':
      case 'GOUDAT': {
        const on = a.noclip();
        this._println('NOCLIP ' + (on ? 'ENABLED' : 'DISABLED') + '.', 'info');
        break;
      }

      case 'FRAMES': {
        const on = a.frames();
        this._println('FRAME GRAPH ' + (on ? 'ON' : 'OFF') + '.', 'info');
        break;
      }

      case 'SLOMO': {
        const n = parseFloat(rest[0]);
        if (!isFinite(n) || n <= 0) {
          this._println('USAGE: SLOMO <n>  e.g. SLOMO 0.5', 'err');
          break;
        }
        a.slomo(n);
        this._println('TIMESCALE SET TO ' + n + '.', 'info');
        break;
      }

      case 'SPAWN': {
        const kind = (rest[0] || '').toLowerCase();
        const kinds = a.kinds || [];
        if (!kind || !kinds.includes(kind)) {
          this._println('USAGE: SPAWN <' + kinds.join('|') + '>', 'err');
          break;
        }
        a.spawn(kind);
        this._println('SPAWNED ' + kind.toUpperCase() + '.', 'info');
        break;
      }

      case 'MAPALL':
        a.mapAll();
        this._println('AUTOMAP FULLY REVEALED.', 'info');
        break;

      case 'WARP': {
        const arg = rest[0];
        if (!arg) {
          this._println('USAGE: WARP <+1|-1|n>', 'err');
          break;
        }
        const delta = (arg === '+1' || arg === '-1') ? arg : parseInt(arg, 10);
        if (typeof delta === 'number' && !isFinite(delta)) {
          this._println('USAGE: WARP <+1|-1|n>', 'err');
          break;
        }
        a.warp(delta);
        this._println('WARPING (' + arg + ').', 'info');
        break;
      }

      case 'MATRIX':
        a.matrix();
        this._println('MATRIX VIEW TOGGLED. FOLLOW THE WHITE ROBOT.', 'info');
        break;

      case 'HELP':
        HELP_ROWS.forEach(([c, d]) => this._println(c.padEnd(24, ' ') + d));
        break;

      default:
        this._println(SASS[this._sassIndex % SASS.length], 'err');
        this._sassIndex++;
        break;
    }
  }

  _println(text, cls) {
    const line = mk('div', cls || null, text);
    this.el.log.appendChild(line);
    this.el.log.scrollTop = this.el.log.scrollHeight;
  }
}

function mk(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}
