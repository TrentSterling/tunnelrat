# Camera review corrections

Re-review confirmed the two fixes below but rejected `5aba228c` for unnecessary
gate retraction caused by applying the rock allowance to authored frames.
See `CHASE-CAMERA-GATE-CORRECTION.md` for the bounded follow-up. This page
retains the previous stage's measurements and is not a publication approval.

Follow-up to rejected camera commit
`9b55e4a8c43d9278d4ca703d04125f5964853ab0`. The independently reviewed release
`ff9f90ed3b6a9e19a4a7247933195f7acd6eee39` remains immutable and unpublished.
This correction is local and awaits independent re-review and coordinated
muted headless visual validation.

## Reproduced failures and correction

The test invokes the actual `updateChaseCam` function from `src/main.js` in a
CPU-only VM with the game's real Three.js camera solver and generated meshes.
It also loads the rejected commit's camera source from Git for a before run.
It does not approximate the production visibility expression in the harness.

The reviewer's seed 1/depth 1 oscillation (5 cm peak-to-peak, 2 Hz) reproduced
20 model visibility changes during five measured seconds at 30, 60 and 144 Hz.
The ship has more than 5 m of density clearance, so these are spurious toggles.
The hide threshold remains `ship radius + camera radius + 0.1m`; restoration
now requires another 0.2 m. Retraction and hiding remain immediate. The same
camera distances, approximately 1.730 to 1.771 m, now produce zero toggles at
all three rates. Retreating into clear space restores the model; a subsequent
approach hides it immediately at every tested rate.

The two supplied production near-plane fixtures also reproduce exactly:

| Fixture | Rejected camera | Corrected camera |
| --- | --- | --- |
| Seed 83, depth 2, 16:9, shake 1.5 | 13.973 mm rock penetration; boom 6.3 m | No intersection; boom 5.8 m |
| Seed 107, depth 3, 32:9, shake 1.5 | 2.115 mm rock penetration; boom 5.4 m | No intersection; boom 4.6 m |

The old `max(0.8, cameraRadius)` field clearance consumes the render-error
allowance as shake or aspect ratio increases the camera volume. The correction
keeps an additive 0.55 m allowance alongside the camera radius, plus the existing
0.1 m sampling tolerance. This retains the previous 0.8 m clearance at the
default 0.25 m radius. It changes neither rock generation nor flight collision.
The 0.55 m allowance comes from the existing default 0.8 minus 0.25 m, not from
rounding up either failing penetration. It is an empirically tested allowance,
not a universal analytic error bound for every possible generated surface.

The supplied `production-reproductions.json` is retained as
`tools/fixtures/camera-production-reproductions.json`, with the original full
precision poses and measurements. Its copied bytes had SHA256
`9a80fa621c66d62d3ba788fd67e2b9c2cdc34083ba417de89b6457242f3be1a7`;
Git text normalization may change line endings without changing fixture values.

## Validation

All checks ran on CPU only; no browser, GPU capture, physical input, focus,
pointer lock or audio operations were used.

- New production sweep: 24 levels (seeds 1, 16, 18, 83, 91, 107, 165 and 1337,
  each in mine, ice and magma), 94,104 production updates, 1,505,664 actual
  rendered-rock near-plane probes, zero intersections. Covers portrait 9:16,
  16:9 and 32:9, zero/max shake, all corner and shake sign combinations,
  pitch/roll poses, and room-center plus off-center positions. The corner
  calculation applies the production shake decay at 144 Hz.
- Re-ran the reviewer's independent CPU harness locally: 14,544 corridor/gate
  poses, zero overlap/crossing/rock failures, zero visibility toggles. Its nine
  existing origin-overlap fallbacks remain nine. This rerun is not an independent
  approval of the correction.
- Existing 48-seed/three-biome sweep: 93,348 poses, zero rock/decor crossings and
  zero endpoint sphere overlaps.
- Camera unit contracts: 3,178 assertions passed. Existing flight/lifecycle
  regression, 21 mission cases and three About CPU contracts passed.
- The reviewer-harness full solver update measured 0.1066 ms mean, 0.3382 ms p95
  and 2.1864 ms maximum. These workstation CPU timings are not rendering or FPS
  evidence and do not establish a performance improvement.

Run from the checkout with the existing pinned Three.js loader:

```powershell
node --experimental-loader ./tools/ship-test-loader.mjs tools/camera-production-regression.mjs --baseline
node --experimental-loader ./tools/ship-test-loader.mjs tools/camera-production-regression.mjs --full
```

The baseline command asserts that the rejected source still reproduces both
reported issues. The candidate command requires clear rendered-rock probes,
stable visibility and immediate hiding/restoration behavior. Receipts are
`tools/out/camera-production-{baseline,full}.json`; additional existing-suite
receipts use `camera-review-*` and `camera-reviewer-independent.json`.

## Scope and limits

The runtime diff touches only the visibility threshold in `main.js` and rock
clearance in `chase-camera.js`. Controls, free inversion, ship physics, snapshot
semantics, gates, mission transitions, assets and the cinematic death camera
are unchanged. No publication or retry of a denied push occurred.

These are finite deterministic fixtures, not exhaustive whole-cavern coverage.
An already embedded ship/decor origin can still use the existing zero-offset
fallback. Dynamic actors and death-camera obstruction remain outside this pass.
No new screenshots, video, native Library IDs, browser gameplay or human playtest
are claimed. Re-review and a coordinated muted headless visual check remain
required before any future publication decision.
