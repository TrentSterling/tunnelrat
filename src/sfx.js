// sfx.js : zero-asset WebAudio synth sfx. Tiny, procedural, throwaway-fun.
//
// CONTRACT (implement exactly):
//
// export const sfx = {
//   init()                    // create AudioContext lazily on first user gesture
//                             // (main calls it on pointer lock); safe to call twice
//   play(name, opts={})       // fire and forget; silently no-op if not initialized
//   setMuted(m), muted:boolean   // 'KeyM' toggles via main
//   setEngine(level)          // level 0..1 each frame; continuous engine thrum
//                             // (saw + sub sine through a lowpass), gain/cutoff
//                             // follow level via setTargetAtTime (no zipper noise).
//                             // Silent at 0. Safe no-op before init().
//   startAmbient()            // call once after init(): low cave drone (filtered
//                             // brown-ish noise loop + slow LFO swell) plus an
//                             // occasional distant rumble every 20-40s.
// }
//
// Required names (synth sketches, layered but still 100% synthesized):
//   'laser'      click transient + detuned dual-osc downward chirp 900->220Hz, ~90ms
//   'enemyLaser' meaner/lower detuned dual-osc chirp, ~380->85Hz, longer
//   'hitWall'    lowpassed noise thud + 55Hz sub thump, ~90ms
//   'hitEnemy'   metallic clank: inharmonic partials 1x/2.7x/4.1x, fast decay
//   'explode'    noise burst + sub boom (waveshaper drive) + lowpass sweep, 600ms
//   'bigExplode' longer/deeper explode (reactor), 1.4s, ducks the alarm bus
//   'pickup'     rising two-note arp (660, 990), square, 200ms
//   'unlock'     three rising notes, 300ms
//   'alarm'      two-tone siren blast 620/470Hz, 400ms, routed through duckable bus
//   'thrum'      soft low sine pulse 90Hz, 150ms (ui ticks, timer final 10s)
//   'die'        descending saw sweep 400->60 + power-down sputter, 900ms
//   'win'        short major arp with feedback-delay echo (~0.18s x3), 500ms
//
// Signal path: every voice -> master DynamicsCompressorNode -> master gain (0.35)
// -> destination. Every one-shot voice disconnects itself (no node leaks); the
// engine thrum and ambient drone/LFO/rumble-scheduler nodes persist for the page.
import { makeRng } from './util/rng.js';

const MASTER_GAIN = 0.35;

let ctx = null;
let compressor = null; // master bus: all voices -> compressor -> master -> destination
let master = null;
let noiseBuffer = null;
let alarmDuckGain = null; // alarm routes through here so bigExplode can duck it

// engine thrum (persistent, created in init(), modulated by setEngine())
let engineSaw = null;
let engineSub = null;
let engineFilter = null;
let engineGain = null;

// ambient (persistent, created in startAmbient())
let ambientStarted = false;
let rumbleTimerId = null;

function makeNoiseBuffer(ac) {
  // deterministic seeded noise (hard rule: no Math.random anywhere in this module,
  // except the ambient rumble scheduler below where it is explicitly allowed)
  const rng = makeRng(0x9e3779b9);
  const len = Math.floor(ac.sampleRate * 1.0);
  const buffer = ac.createBuffer(1, len, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = rng() * 2 - 1;
  return buffer;
}

function makeDriveCurve(amount) {
  const n = 256;
  const curve = new Float32Array(n);
  const denom = Math.tanh(amount) || 1;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(amount * x) / denom;
  }
  return curve;
}
const DRIVE_SOFT = makeDriveCurve(2.2);
const DRIVE_HARD = makeDriveCurve(4.2);

function connectDest(node, dest) {
  const d = dest || compressor;
  if (Array.isArray(d)) d.forEach((n) => node.connect(n));
  else node.connect(d);
}

function tone(type, f0, f1, dur, peak = 0.5, delay = 0, dest = null) {
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(1, f0), t0);
  if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + Math.min(0.01, dur * 0.25));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  connectDest(g, dest);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
  osc.onended = () => { osc.disconnect(); g.disconnect(); };
}

function noiseBurst(dur, f0, f1, peak = 0.5, delay = 0, filterType = 'lowpass', dest = null) {
  const t0 = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  const filt = ctx.createBiquadFilter();
  filt.type = filterType;
  filt.frequency.setValueAtTime(Math.max(20, f0), t0);
  if (f1 !== f0) filt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + Math.min(0.01, dur * 0.15));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filt);
  filt.connect(g);
  connectDest(g, dest);
  src.start(t0);
  src.stop(t0 + dur + 0.03);
  src.onended = () => { src.disconnect(); filt.disconnect(); g.disconnect(); };
}

// detuned dual-oscillator chirp: two copies of `type` at +/- detuneCents sharing
// one gain envelope, swept f0 -> f1. Used for laser / enemyLaser.
function chirp(type, f0, f1, dur, peak, detuneCents, delay = 0, dest = null) {
  const t0 = ctx.currentTime + delay;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + Math.min(0.008, dur * 0.2));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  connectDest(g, dest);
  const oscs = [-detuneCents, detuneCents].map((det) => {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.detune.setValueAtTime(det, t0);
    osc.frequency.setValueAtTime(Math.max(1, f0), t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    osc.connect(g);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
    return osc;
  });
  let pending = oscs.length;
  oscs.forEach((osc) => {
    osc.onended = () => {
      osc.disconnect();
      pending--;
      if (pending === 0) g.disconnect();
    };
  });
}

// sine sub-boom through a WaveShaper drive stage. Used for explode / bigExplode.
function subBoom(f0, f1, dur, peak, curve, delay = 0) {
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(Math.max(1, f0), t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + Math.min(0.02, dur * 0.1));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  const shaper = ctx.createWaveShaper();
  shaper.curve = curve;
  shaper.oversample = '2x';
  osc.connect(g);
  g.connect(shaper);
  shaper.connect(compressor);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
  osc.onended = () => { osc.disconnect(); g.disconnect(); shaper.disconnect(); };
}

function duckAlarm() {
  if (!ctx || !alarmDuckGain) return;
  const now = ctx.currentTime;
  const cur = alarmDuckGain.gain.value;
  alarmDuckGain.gain.cancelScheduledValues(now);
  alarmDuckGain.gain.setValueAtTime(cur, now);
  alarmDuckGain.gain.linearRampToValueAtTime(0.12, now + 0.05);
  alarmDuckGain.gain.setTargetAtTime(1.0, now + 0.05, 0.35);
}

function setupEngine() {
  const t0 = ctx.currentTime;
  engineSaw = ctx.createOscillator();
  engineSaw.type = 'sawtooth';
  engineSaw.frequency.value = 50;
  engineSub = ctx.createOscillator();
  engineSub.type = 'sine';
  engineSub.frequency.value = 25;
  const sawGain = ctx.createGain();
  sawGain.gain.value = 0.5;
  const subGain = ctx.createGain();
  subGain.gain.value = 0.75;
  engineFilter = ctx.createBiquadFilter();
  engineFilter.type = 'lowpass';
  engineFilter.frequency.value = 90;
  engineFilter.Q.value = 0.5;
  engineGain = ctx.createGain();
  engineGain.gain.value = 0.0001;

  engineSaw.connect(sawGain);
  engineSub.connect(subGain);
  sawGain.connect(engineFilter);
  subGain.connect(engineFilter);
  engineFilter.connect(engineGain);
  engineGain.connect(compressor);

  engineSaw.start(t0);
  engineSub.start(t0);
}

function playRumble() {
  if (!ctx) return;
  noiseBurst(2.2, 480, 55, 0.15, 0, 'lowpass');
  tone('sine', 38, 24, 2.0, 0.11, 0.06);
}

function scheduleRumble() {
  if (!ctx || !ambientStarted) return;
  // occasional distant rumble every 20-40s; Math.random explicitly allowed here
  // (ambient scheduling only), everything else in this module stays seeded/deterministic.
  const waitSec = 20 + Math.random() * 20;
  rumbleTimerId = setTimeout(() => {
    playRumble();
    scheduleRumble();
  }, waitSec * 1000);
}

const VOICES = {
  laser() {
    noiseBurst(0.012, 3200, 3200, 0.32, 0, 'highpass'); // click transient
    chirp('sawtooth', 900, 220, 0.09, 0.42, 11);
    chirp('square', 900, 220, 0.085, 0.22, -11, 0.002);
  },
  enemyLaser() {
    noiseBurst(0.014, 2200, 2200, 0.3, 0, 'highpass');
    chirp('sawtooth', 380, 85, 0.16, 0.46, 20);
    chirp('square', 380, 85, 0.15, 0.28, -20, 0.004);
  },
  hitWall() {
    noiseBurst(0.09, 220, 90, 0.5, 0, 'lowpass');
    tone('sine', 58, 40, 0.11, 0.5);
  },
  hitEnemy() {
    const base = 950;
    tone('triangle', base, base, 0.06, 0.42);
    tone('sine', base * 2.7, base * 2.7, 0.05, 0.28);
    tone('triangle', base * 4.1, base * 4.1, 0.035, 0.18);
  },
  explode() {
    noiseBurst(0.6, 2200, 100, 0.55, 0, 'lowpass');
    subBoom(60, 32, 0.6, 0.52, DRIVE_SOFT);
  },
  bigExplode() {
    noiseBurst(1.4, 2600, 65, 0.62, 0, 'lowpass');
    subBoom(45, 22, 1.4, 0.6, DRIVE_HARD);
    duckAlarm();
  },
  pickup() {
    tone('square', 660, 660, 0.11, 0.4, 0);
    tone('square', 990, 990, 0.11, 0.4, 0.1);
  },
  unlock() {
    tone('triangle', 440, 440, 0.1, 0.4, 0);
    tone('triangle', 554, 554, 0.1, 0.4, 0.1);
    tone('triangle', 660, 660, 0.12, 0.42, 0.2);
  },
  alarm() {
    tone('square', 620, 620, 0.2, 0.5, 0, alarmDuckGain || undefined);
    tone('square', 470, 470, 0.2, 0.5, 0.2, alarmDuckGain || undefined);
  },
  thrum() {
    tone('sine', 90, 90, 0.15, 0.35);
  },
  die() {
    tone('sawtooth', 420, 55, 0.9, 0.5);
    tone('square', 210, 30, 0.9, 0.2, 0.02);
    // power-down sputter: intermittent dropout ticks near the tail
    const sputterTimes = [0.5, 0.6, 0.68, 0.78, 0.9];
    sputterTimes.forEach((t, i) => {
      noiseBurst(0.03, 800 - i * 120, 300, 0.22 - i * 0.03, t, 'bandpass');
    });
  },
  win() {
    const notes = [523.25, 659.25, 784.0, 1046.5];
    const delayNode = ctx.createDelay(1.0);
    delayNode.delayTime.value = 0.18;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.32;
    const wet = ctx.createGain();
    wet.gain.value = 0.42;
    delayNode.connect(feedback);
    feedback.connect(delayNode);
    delayNode.connect(wet);
    wet.connect(compressor);
    notes.forEach((f, i) => tone('triangle', f, f, 0.13, 0.4, i * 0.1, [compressor, delayNode]));
    const lastAt = (notes.length - 1) * 0.1 + 0.13;
    const tailMs = (lastAt + 0.18 * 4) * 1000; // ~3 audible echo repeats + settle
    setTimeout(() => {
      try { delayNode.disconnect(); feedback.disconnect(); wet.disconnect(); } catch { /* already gone */ }
    }, tailMs);
  },
};

export const sfx = {
  muted: false,

  init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    compressor = ctx.createDynamicsCompressor();
    master = ctx.createGain();
    master.gain.value = this.muted ? 0 : MASTER_GAIN;
    compressor.connect(master);
    master.connect(ctx.destination);
    noiseBuffer = makeNoiseBuffer(ctx);
    alarmDuckGain = ctx.createGain();
    alarmDuckGain.gain.value = 1;
    alarmDuckGain.connect(compressor);
    setupEngine();
  },

  play(name, opts = {}) {
    if (!ctx) return; // silently no-op before init()
    if (ctx.state === 'suspended') ctx.resume();
    const voice = VOICES[name];
    if (!voice) return;
    voice(opts);
  },

  setMuted(m) {
    this.muted = !!m;
    if (master) master.gain.value = this.muted ? 0 : MASTER_GAIN;
  },

  setEngine(level) {
    if (!ctx || !engineGain || !engineFilter) return; // safe no-op before init
    const lvl = Math.max(0, Math.min(1, Number(level) || 0));
    const now = ctx.currentTime;
    const targetGain = lvl <= 0.002 ? 0.0001 : 0.03 + lvl * 0.16;
    engineGain.gain.setTargetAtTime(targetGain, now, 0.09);
    const targetCutoff = 90 + lvl * 700;
    engineFilter.frequency.setTargetAtTime(targetCutoff, now, 0.15);
  },

  startAmbient() {
    if (!ctx || ambientStarted) return; // safe no-op before init; idempotent
    ambientStarted = true;
    const t0 = ctx.currentTime;

    const droneSrc = ctx.createBufferSource();
    droneSrc.buffer = noiseBuffer;
    droneSrc.loop = true;
    const droneFilt1 = ctx.createBiquadFilter();
    droneFilt1.type = 'lowpass';
    droneFilt1.frequency.value = 220;
    droneFilt1.Q.value = 0.7;
    const droneFilt2 = ctx.createBiquadFilter();
    droneFilt2.type = 'lowpass';
    droneFilt2.frequency.value = 130;
    droneFilt2.Q.value = 0.5;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.05;

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.06; // very slow swell
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.035;
    lfo.connect(lfoDepth);
    lfoDepth.connect(droneGain.gain);

    droneSrc.connect(droneFilt1);
    droneFilt1.connect(droneFilt2);
    droneFilt2.connect(droneGain);
    droneGain.connect(compressor);

    droneSrc.start(t0);
    lfo.start(t0);

    scheduleRumble();
  },
};
