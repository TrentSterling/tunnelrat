# Fixed contact cadence correction

This corrects rejected `d2722d4` locally. The approved live model is unchanged.
Independent review is required before any roll publication.

The previous integration divided each render frame into equal steps: 30/60 Hz
used 1/240 s, while 144 Hz used 1/288 s. The independent 43-seed contact sweep
found five worse seeds, including seed 16 (5.135 to 13.842 m endpoint spread)
and seed 18 (9.155 to 18.212 m). Free-flight improvement alone was insufficient.

## Simulation and rendering

Physics now completes fixed 1/240 s ticks. Controls are accumulated by elapsed
time and mouse pixels once per tick. An unfinished tick is evaluated from its
saved anchor to publish a fresh camera/aim pose every render frame, including
above 240 Hz. It is recomputed when more input arrives; render boundaries never
become committed contact steps. Maximum preview horizon is 4.167 ms.

Damage is charged once per completed tick, independently of render grouping.
Preview collisions do not duplicate damage. The outward impact callback still
reports the maximum at most once per outer update. Projection may iterate twelve
times in the existing approximate field; no normal, bounce or flight tuning was
changed. External pose/velocity writes, impulses, door pushes, teleports, noclip
and field swaps rebase the anchor from the actual public state. A preview impact
is committed once if such a rebase interrupts it.

No persistent save system exists. `captureFlightState()` / `restoreFlightState()`
are JSON-safe and include the unfinished tick. Copying only pose/velocity starts
a new integration interval; it is no longer claimed to reproduce the old hidden
history. Tests cover both exact snapshots and public-state mutation rebasing.

## Measurements and acceptance

- Reviewer replay: all 43 seeds, 30/60/144 Hz and jitter, plus 59.94 and 237 Hz.
  No worse seeds or new deaths. Maximum endpoint spread: 1.36e-11 m; maximum
  shield spread: 9.28e-12. Minimum sampled clearance: 1.399777 m for a 1.4 m
  sphere, within the declared 1 mm approximate-SDF tolerance.
- Combined free-flight reversal: original 6.752914 m, rejected checkpoint
  0.031386 m, corrected 6.65e-15 m (30 vs 144 Hz). Maximum sampled orientation
  difference is 2.98e-8 rad, at quaternion comparison precision.
- Pure 60 Hz roll/release matches the original orientation; uncapped strafe
  differs by 7.11e-14 m. Coupled 60 Hz paths retain the earlier stated changes:
  at most 0.681 m normal / 1.258 m boosted over six seconds. No bank-turn or
  world-up behavior was introduced. Full free inversion remains stable.
- Real transformed ship vertices clear the three test slopes by at least
  0.215501 m. One approach produces one impact. Pause, death, reset, release,
  caps, zero damping, camera inheritance and mouse delta checks pass.
- JSON round trips also cover a partial preview already touching a wall.
  Weapon-like impulses, door-like pushes, teleports, orientation edits, roll
  edits, noclip and field replacement cannot be overwritten by the anchor.
- A second 43-seed sweep uses non-tick-aligned transitions at 1.137, 3.193 and
  6.011 seconds. All six schedules again pass endpoint, velocity, orientation,
  damage and clearance assertions; maximum shield spread is 2.96e-11.
- Fresh hardware headless replay passed inversion/reversal/release, camera
  inheritance, map, console pause/resume, death and retry. Pointer lock stayed
  false. Screenshots and a decoded silent video frame were inspected. The first
  two attempts exposed synthetic-key harness mistakes, corrected before the
  passing run; neither required or performed desktop interaction.

Reproduce CPU checks with the pinned loader:

```powershell
node --loader ./tools/ship-test-loader.mjs tools/roll-regression.mjs
node --loader ./tools/ship-test-loader.mjs tools/contact-regression.mjs
node --loader ./tools/ship-test-loader.mjs tools/contact-regression.mjs --unaligned
node --loader ./tools/ship-test-loader.mjs tools/mission-flight-unit.mjs
node --test tests/about-contract.cjs
```

`tools/out/contact-corrected.json` retains every baseline/candidate state, not
only the summary. The baseline is loaded from immutable Git commit `0a5b66f`.
These are deterministic controls aligned at their actual transition times, not
a claim of network lockstep for different player inputs or external events.

The updated `roll-capture.mjs` uses an isolated muted headless browser, page-local
synthetic key events and disabled gamepads. No cursor, OS input, foreground call,
pointer lock or audio test is permitted. Historical capture commands in
`FLIGHT-TIMESTEP.md` are superseded by this restriction; legacy smoke scripts
must not be run on the user's desktop.

The current Library prepared-upload helper failed before preparation with
`Library prepare_uploads is not available`. No corrected native upload is
confirmed. Prior Library version-0 roll artifacts remain historical. Current
local proof is `tools/out/roll-corrected` (screenshots, silent WebM and receipt).
