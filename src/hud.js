// hud.js : DOM overlay HUD. Raw HTML/CSS injected into #hud, no framework.
//
// CONTRACT (implement exactly):
//
// class HUD {
//   constructor(container)     // the #hud div; builds all elements, shows container
//   setShields(v, max)         // left bar, green -> red under 30%
//   setEnergy(v, max)          // right bar, amber
//   setKey(has:boolean)        // key icon glyph lights up gold when carried
//   setDepth(n)                // "DEPTH 1" top-left
//   setObjective(text)         // small line under depth, e.g. "FIND THE KEYCARD"
//   message(text, ms=2500)     // big center text, fades out; queue not needed, replace
//   setTimer(seconds|null)     // big red MM:SS top-center during escape; null hides;
//                              // pulses when < 10s
//   flashDamage()              // red vignette flash ~200ms (css opacity anim)
//   showDeath(visible)         // center overlay: "HULL BREACH" + "ENTER: RETRY"
//   showWin(visible, depth)    // center overlay: "DEPTH n CLEARED" + "ENTER: DESCEND"
//   crosshair always visible while playing
// }
//
// Style: Courier New, letter-spacing, thin 2px bars with 1px borders, colors from
// the CSS vars in index.html (--accent green, --accent2 amber, --danger red, --cyan).
// Descent-terminal look: uppercase, small labels SHLD / ENRG. All elements created
// once in constructor; setters mutate textContent/style only (no innerHTML per frame).

const CSS = `
#hud, #hud * { font-family:'Courier New', monospace; box-sizing:border-box; }
#hud .hud-panel { position:absolute; }
#hud .hud-topleft { top:18px; left:20px; }
#hud .hud-depth { font-size:20px; font-weight:700; letter-spacing:5px; color:var(--accent);
  text-shadow:0 0 12px rgba(92,255,138,.5); }
#hud .hud-objective { margin-top:5px; font-size:12px; letter-spacing:2px; color:#c9d3e0; }

#hud .hud-bottomleft { bottom:24px; left:20px; width:220px; }
#hud .hud-bottomright { bottom:24px; right:20px; width:220px; text-align:right; }
#hud .hud-label { font-size:11px; letter-spacing:4px; color:#7c8798; margin-bottom:4px; }
#hud .hud-bar { position:relative; height:12px; border:1px solid rgba(255,255,255,.28);
  background:rgba(255,255,255,.04); overflow:hidden; }
#hud .hud-bar-fill { position:absolute; top:0; left:0; bottom:0; width:100%;
  transform-origin:left center; background:var(--accent); box-shadow:0 0 8px currentColor;
  transition:transform .15s linear, background-color .25s linear; }
#hud .hud-bottomright .hud-bar-fill { transform-origin:right center; background:var(--accent2); }
#hud .hud-bar-value { margin-top:4px; font-size:11px; letter-spacing:2px; color:#9aa5b8; }
#hud .hud-key { margin-top:10px; font-size:12px; letter-spacing:3px; color:#3a4150;
  transition:color .2s, text-shadow .2s; }
#hud .hud-key.active { color:var(--accent2); text-shadow:0 0 10px rgba(255,177,59,.7); }

#hud .hud-timer { position:absolute; top:16px; left:50%; transform:translateX(-50%);
  font-size:34px; font-weight:700; letter-spacing:5px; color:var(--danger);
  text-shadow:0 0 16px rgba(255,59,59,.6); display:none; }
#hud .hud-timer.pulse { animation:hudPulse .5s infinite; }
@keyframes hudPulse { 50% { opacity:.25; } }

#hud .hud-message { position:absolute; top:36%; left:50%; transform:translate(-50%,-50%);
  font-size:24px; letter-spacing:4px; color:var(--cyan); text-align:center; white-space:nowrap;
  text-shadow:0 0 14px rgba(57,208,255,.6); opacity:0; transition:opacity .3s; }
#hud .hud-message.show { opacity:1; }

#hud .hud-crosshair { position:absolute; top:50%; left:50%; width:16px; height:16px;
  transform:translate(-50%,-50%); }
#hud .hud-crosshair::before, #hud .hud-crosshair::after { content:''; position:absolute;
  background:var(--accent); opacity:.75; }
#hud .hud-crosshair::before { left:50%; top:0; bottom:0; width:1px; transform:translateX(-50%); }
#hud .hud-crosshair::after { top:50%; left:0; right:0; height:1px; transform:translateY(-50%); }

#hud .hud-vignette { position:absolute; inset:0; opacity:0; transition:opacity .18s;
  box-shadow:inset 0 0 140px 44px rgba(255,59,59,.85); }

#hud .hud-overlay { position:absolute; inset:0; display:none; flex-direction:column;
  align-items:center; justify-content:center; background:rgba(5,7,10,.82); }
#hud .hud-overlay h2 { font-size:46px; letter-spacing:9px; color:var(--danger);
  text-shadow:0 0 30px rgba(255,59,59,.6); }
#hud .hud-overlay.win h2 { color:var(--accent); text-shadow:0 0 30px rgba(92,255,138,.6); }
#hud .hud-overlay p { margin-top:16px; font-size:13px; letter-spacing:4px; color:#c9d3e0; }
`;

export class HUD {
  constructor(container) {
    this.container = container;
    this._injectStyle();

    container.innerHTML = '';
    container.style.display = 'block';

    const el = {};
    this.el = el;

    el.topleft = mk('div', 'hud-panel hud-topleft');
    el.depth = mk('div', 'hud-depth', 'DEPTH 1');
    el.objective = mk('div', 'hud-objective', '');
    el.xp = mk('div', 'hud-objective', 'XP 0');
    el.xp.style.color = 'var(--accent2)';
    el.topleft.append(el.depth, el.objective, el.xp);

    el.bottomleft = mk('div', 'hud-panel hud-bottomleft');
    el.shieldLabel = mk('div', 'hud-label', 'SHLD');
    el.shieldBar = mk('div', 'hud-bar');
    el.shieldFill = mk('div', 'hud-bar-fill');
    el.shieldBar.append(el.shieldFill);
    el.shieldValue = mk('div', 'hud-bar-value', '100 / 100');
    el.bottomleft.append(el.shieldLabel, el.shieldBar, el.shieldValue);

    el.bottomright = mk('div', 'hud-panel hud-bottomright');
    el.energyLabel = mk('div', 'hud-label', 'ENRG');
    el.energyBar = mk('div', 'hud-bar');
    el.energyFill = mk('div', 'hud-bar-fill');
    el.energyBar.append(el.energyFill);
    el.energyValue = mk('div', 'hud-bar-value', '100 / 100');
    el.key = mk('div', 'hud-key', '◆ KEYCARD');
    el.bottomright.append(el.energyLabel, el.energyBar, el.energyValue, el.key);

    el.timer = mk('div', 'hud-timer', '00:00');
    el.message = mk('div', 'hud-message', '');
    el.crosshair = mk('div', 'hud-crosshair');
    el.vignette = mk('div', 'hud-vignette');

    el.death = mk('div', 'hud-overlay');
    el.death.append(mk('h2', null, 'HULL BREACH'), mk('p', null, 'ENTER: RETRY'));

    el.win = mk('div', 'hud-overlay win');
    el.winTitle = mk('h2', null, 'DEPTH 1 CLEARED');
    el.win.append(el.winTitle, mk('p', null, 'ENTER: DESCEND'));

    container.append(
      el.topleft, el.bottomleft, el.bottomright,
      el.timer, el.message, el.crosshair, el.vignette,
      el.death, el.win
    );

    this._msgTimeout = null;
    this._flashTimeout = null;
  }

  _injectStyle() {
    if (document.getElementById('hud-style')) return;
    const style = document.createElement('style');
    style.id = 'hud-style';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  setShields(v, max) {
    const pct = clamp01(v / max);
    this.el.shieldFill.style.transform = 'scaleX(' + pct + ')';
    this.el.shieldFill.style.background = pct < 0.3 ? 'var(--danger)' : 'var(--accent)';
    this.el.shieldValue.textContent = Math.max(0, Math.round(v)) + ' / ' + max;
  }

  setEnergy(v, max) {
    const pct = clamp01(v / max);
    this.el.energyFill.style.transform = 'scaleX(' + pct + ')';
    this.el.energyValue.textContent = Math.max(0, Math.round(v)) + ' / ' + max;
  }

  setKey(has) {
    this.el.key.classList.toggle('active', !!has);
  }

  setDepth(n) {
    this.el.depth.textContent = 'DEPTH ' + n;
  }

  setXP(n) {
    this.el.xp.textContent = 'XP ' + n;
  }

  setObjective(text) {
    this.el.objective.textContent = text;
  }

  message(text, ms = 2500) {
    if (this._msgTimeout) { clearTimeout(this._msgTimeout); this._msgTimeout = null; }
    this.el.message.textContent = text;
    this.el.message.classList.add('show');
    this._msgTimeout = setTimeout(() => {
      this.el.message.classList.remove('show');
      this._msgTimeout = null;
    }, ms);
  }

  setTimer(seconds) {
    if (seconds === null || seconds === undefined) {
      this.el.timer.style.display = 'none';
      this.el.timer.classList.remove('pulse');
      return;
    }
    const s = Math.max(0, Math.ceil(seconds));
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    this.el.timer.textContent = mm + ':' + ss;
    this.el.timer.style.display = 'block';
    this.el.timer.classList.toggle('pulse', s < 10);
  }

  flashDamage() {
    this.el.vignette.style.opacity = '1';
    if (this._flashTimeout) clearTimeout(this._flashTimeout);
    this._flashTimeout = setTimeout(() => {
      this.el.vignette.style.opacity = '0';
      this._flashTimeout = null;
    }, 200);
  }

  showDeath(visible) {
    this.el.death.style.display = visible ? 'flex' : 'none';
  }

  showWin(visible, depth) {
    if (visible) this.el.winTitle.textContent = 'DEPTH ' + depth + ' CLEARED';
    this.el.win.style.display = visible ? 'flex' : 'none';
  }
}

function mk(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}
