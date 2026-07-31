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
export const sfx = {
  init() { throw new Error('NOT IMPLEMENTED: sfx.init'); },
  play(name, opts = {}) { throw new Error('NOT IMPLEMENTED: sfx.play'); },
  setMuted(m) { throw new Error('NOT IMPLEMENTED: sfx.setMuted'); },
  muted: false,
};
