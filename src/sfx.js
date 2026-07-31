// sfx.js : zero-asset WebAudio synth sfx. Tiny, procedural, throwaway-fun.
//
// CONTRACT (implement exactly):
//
// export const sfx = {
//   init()                    // create AudioContext lazily on first user gesture
//                             // (main calls it on pointer lock); safe to call twice
//   play(name, opts={})       // fire and forget; silently no-op if not initialized
//   setMuted(m), muted:boolean   // 'KeyM' toggles via main
// }
//
// Required names (synth sketches, keep each a few oscillators/noise + gain envelopes):
//   'laser'      short square+saw downward chirp 880->220Hz, 90ms
//   'enemyLaser' same but 440->160, slightly longer
//   'hitWall'    filtered noise thud, 80ms, lowpass 300Hz
//   'hitEnemy'   metallic tink: two detuned triangles 1200/1800Hz, fast decay
//   'explode'    noise burst + 60Hz sine boom, 600ms, lowpass sweep down
//   'bigExplode' longer/deeper explode (reactor), 1.4s
//   'pickup'     rising two-note arp (660, 990), square, 200ms
//   'unlock'     three rising notes, 300ms
//   'alarm'      two-tone siren blast 620/470Hz, 400ms (gamestate loops it during escape)
//   'thrum'      soft low sine pulse 90Hz, 150ms (ui ticks, timer final 10s)
//   'die'        descending saw sweep 400->60, 900ms
//   'win'        small major arp up, 500ms
// Master gain 0.35. Every voice must stop/disconnect itself (no leaks).
import { makeRng } from './util/rng.js';

const MASTER_GAIN = 0.35;

let ctx = null;
let master = null;
let noiseBuffer = null;

function makeNoiseBuffer(ac) {
  // deterministic seeded noise (hard rule: no Math.random anywhere in this module)
  const rng = makeRng(0x9e3779b9);
  const len = Math.floor(ac.sampleRate * 1.0);
  const buffer = ac.createBuffer(1, len, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = rng() * 2 - 1;
  return buffer;
}

function tone(type, f0, f1, dur, peak = 0.5, delay = 0) {
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
  g.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
  osc.onended = () => { osc.disconnect(); g.disconnect(); };
}

function noiseBurst(dur, f0, f1, peak = 0.5, delay = 0, filterType = 'lowpass') {
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
  g.connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.03);
  src.onended = () => { src.disconnect(); filt.disconnect(); g.disconnect(); };
}

const VOICES = {
  laser() {
    tone('square', 880, 220, 0.09, 0.45);
    tone('sawtooth', 880, 220, 0.09, 0.3);
  },
  enemyLaser() {
    tone('square', 440, 160, 0.13, 0.42);
    tone('sawtooth', 440, 160, 0.13, 0.28);
  },
  hitWall() {
    noiseBurst(0.08, 300, 300, 0.55);
  },
  hitEnemy() {
    tone('triangle', 1200, 1200, 0.07, 0.4);
    tone('triangle', 1800, 1800, 0.07, 0.28);
  },
  explode() {
    noiseBurst(0.6, 2200, 110, 0.55);
    tone('sine', 60, 42, 0.6, 0.5);
  },
  bigExplode() {
    noiseBurst(1.4, 2600, 70, 0.65);
    tone('sine', 45, 26, 1.4, 0.6);
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
    tone('square', 620, 620, 0.2, 0.5, 0);
    tone('square', 470, 470, 0.2, 0.5, 0.2);
  },
  thrum() {
    tone('sine', 90, 90, 0.15, 0.35);
  },
  die() {
    tone('sawtooth', 400, 60, 0.9, 0.5);
  },
  win() {
    const notes = [523, 659, 784, 1046];
    notes.forEach((f, i) => tone('triangle', f, f, 0.15, 0.4, i * 0.12));
  },
};

export const sfx = {
  muted: false,

  init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = this.muted ? 0 : MASTER_GAIN;
    master.connect(ctx.destination);
    noiseBuffer = makeNoiseBuffer(ctx);
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
};
