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
export class HUD {
  constructor(container) {
    throw new Error('NOT IMPLEMENTED: HUD');
  }
}
