# Elapsed-time 6DOF flight integration

Historical first-checkpoint report. Independent review rejected its contact
behavior. Current implementation, acceptance results, snapshot contract and
capture restrictions are in `ROLL-CONTACT-CORRECTION.md`; they supersede the
no-accumulator, per-frame damage and capture statements below.

This local checkpoint is based on the independently approved ship model at
`0a5b66fbc1c8e6c5a900b03d06f29c1b17f6fd61`. The model candidate remains in its
own checkout and branch. Only `src/ship.js` changes runtime behavior here;
controls, tuning values, camera code, mission logic and assets are unchanged.

## Problem and intended feel

Roll used a per-frame linear damping factor followed by endpoint-velocity angle
integration. Holding the same roll input therefore produced different angular
speeds on different displays. A four-second thrust, roll and look reversal
finished 6.752914 m apart at 30 and 144 Hz. Translation without roll differed by
0.262449 m; translation with roll differed by 6.486140 m.

The fix extends the original 60 Hz damped velocity recurrence over elapsed time,
and integrates angle and displacement from that same response. Coupled local
rotation, thrust and SDF collision advance in steps no longer than 1/240 s.
Mouse pixels are divided across those steps exactly once. There is no world-up
correction, bank-turn steering, input delay, accumulated render tick or hidden
simulation clock. Every render frame receives a current pose, including 144 Hz.

The impact callback and impact damage use the maximum collision speed once per
outer update, preserving that contract despite internal collision steps. Paused
or dead updates do not advance motion. Reset clears velocity and angular drift;
noclip continues to survive reset as before.

## Numerical results

The fixture in `tools/fixtures/roll-before.json` was recorded from the unmodified
approved checkpoint. Six controls run for two seconds, reverse for two seconds,
then release for two seconds. Samples are compared every half-second at 30, 60,
144 Hz and a jitter sequence spanning 20 to 240 Hz. No input transition is rounded
to a frame boundary.

| Reversal after four seconds | Before: 30 vs 144 Hz | After: 30 vs 144 Hz |
| --- | ---: | ---: |
| Translation | 0.262449 m | 0.000036 m |
| Translation and roll | 6.486140 m | 0.031491 m |
| Translation, roll and look | 6.752914 m | 0.031386 m |
| Boosted combined input | 11.479953 m | 0.053356 m |

Across all sampled times and rate pairs, the largest free-flight position spread
is 0.069696 m, orientation spread is 0.00001951 rad, and velocity spread is
0.021166 m/s. Roll velocity agrees to floating-point precision.

The 60 Hz reference is a feel target, not a claim that all trajectories remain
byte-identical. Pure roll/release and uncapped straight flight match it to
floating-point precision. Sampling thrust through a turn changes the six-second
60 Hz path by at most 0.681 m with ordinary combined input, or 1.258 m with boost.
The largest 60 Hz orientation change is 0.0003511 rad (about 0.0202 degrees).

## Collision and lifecycle limits

Analytic wall tests use three slopes, all rate schedules, real transformed ship
vertices, and one high-speed contact. The ship and its vertices remain outside
the wall, one impact callback fires per approach, and damage varies by less than
0.25 shield points across rates. The original model and outward-winding tests
also pass unchanged.

Repeated wall sliding in the approximate procedural SDF remains sensitive to
collision sampling. This is measured separately from free-flight integration:

| Seed | Previous six-second position spread | Current spread |
| --- | ---: | ---: |
| 1337 | 1.789 m | 0.232 m |
| 1338 | 12.108 m | 4.719 m |
| 1339 | 11.219 m | 1.462 m |

All current procedural probes retain sphere clearance within 0.001 m of the
1.4 m radius; the previous worst deficit was about 0.016 m. These probes establish
an improvement and retained clearance, not deterministic post-collision paths.
The reviewer should explicitly assess that residual and the stated 60 Hz path
changes. The cave field, collision normals and restitution coefficient are not
retuned in this pass.

There is no persistent save system in this game revision. Instead, a JSON round
trip of public flight state (pose, velocity, roll velocity, health, energy and
alive status) resumes identically. Tests also cover zero-time pause, death,
retry reset, stable inversion, camera inheritance, per-frame motion at 144 Hz,
single application of mouse pixels, boosted speed caps and zero-damping limits.

## Reproduction and proof

Use the same pinned Three.js dependency described in `SHIP-MODEL-PASS.md`:

```
node --loader ./tools/ship-test-loader.mjs tools/roll-regression.mjs
node --loader ./tools/ship-test-loader.mjs tools/mission-flight-unit.mjs
node --loader ./tools/ship-test-loader.mjs tools/flight-replay.mjs
node --loader ./tools/ship-test-loader.mjs tools/ship-model-unit.mjs
node --loader ./tools/ship-test-loader.mjs tools/ship-winding-unit.mjs
node --test tests/about-contract.cjs
node tools/roll-capture.mjs after http://127.0.0.1:8135/
node tools/smoketest.mjs http://127.0.0.1:8135/
node tools/movetest.mjs http://127.0.0.1:8135/
```

The original and candidate captures use identical trusted pointer-lock and
keyboard sequences: full roll into inversion, release, reverse roll, settle,
forward flight, strafe/climb, roll, reverse thrust and release. They also exercise
automap, console pause after keys are released, death, wreck and retry. Ordinary
browser input uses actual elapsed frames; it is not a deterministic timing test.
The CPU fixtures above provide the numerical comparisons. Screenshots use
1280 x 720; video records the muted canvas only and omits the DOM HUD.

Raw local evidence is under `tools/out/roll-before`, `tools/out/roll-after`,
`tools/out/roll-regression.json` and `tools/out/flight-after.json`.
Both captures passed and their inversion, reverse-roll and pause screenshots
were inspected; the new video was decoded and inspected. The existing browser
mission smoke passed 5/5 and movement smoke passed 5/5 (24.4 m forward, 3.2 m/s
after release, shields 100). Nine generated mission cases passed key pickup,
locked blocking, actual unlocked traversal, reactor escape, death, retry and
cleanup at 30/60/144 Hz across three seeds. The 111,396 model assertions,
outward-housing regression and three About contracts also passed.
No physical gamepad, audio listening, low-end hardware or human playtest is claimed.
This flight checkpoint requires independent review before publication.
