# Chase camera obstruction correction

Independent review rejected `9b55e4a` for ship-visibility flicker and two shaken
near-plane intersections with rendered rock. The static checks below were
insufficient. See `CHASE-CAMERA-REVIEW-CORRECTION.md` for the focused follow-up
and production-update regression evidence; re-review and GPU validation remain
pending.

Local review candidate based on approved release
`ff9f90ed3b6a9e19a4a7247933195f7acd6eee39`. That release checkout and its pending
publication remain unchanged. This pass is not published or visually approved.

## Reproduction and player-visible change

The old chase camera samples rock at four endpoint distances, then adds velocity
lean and smooths toward the result. It does not test the path between the ship
and camera or the decorative meshes. A clear endpoint can therefore sit beyond
a ceiling fixture or a rock wall, obscuring the ship and flight view.

Deterministic example: seed 1, depth 1; ship position
`[30.4977457412, -109.7090367750, 6.5872895904]`, quaternion
`[-0.7071067812, 0, 0, 0.7071067812]`. The old steady camera distance is
3.242299 m. The boom crosses `decor-fixture-glow`, instance 1, at 0.989777 m.
The candidate stops at 0.724899 m, leaving clearance for the camera volume.
When the camera must come inside the exterior ship's bounding sphere, the
exterior model is hidden until it fits again; chase mode and orientation remain.

`src/chase-camera.js` indexes static decoration, props and the fixed gate
assembly at level load. Its broad phase uses per-instance world bounds; the
narrow phase uses actual transformed triangles, including edges, backs and
vertices. Bounds do not turn an open rib or portal into a solid cap. Rock uses
the existing density field with the old 0.8 m margin and 0.1 m sampling tolerance.
The final camera boom is checked after lean and smoothing, retracting immediately
and extending with the original exponential follow. The volume accounts for
near-plane corners, aspect ratio and the maximum current shake offset.

## CPU evidence

All results below were executed without a browser, WebGL, GPU lease, OS input,
pointer lock, focus changes or audio. The scene's real Three.js geometries were
constructed on the CPU; the canvas texture stub implements only `fillRect`.

| Check | Result |
| --- | --- |
| Generated poses, 48 seeds x mine/ice/magma | 93,348 legal ship poses |
| Baseline boom crossings | 247 rock findings; 1,458 decorative-mesh findings (categories may overlap) |
| Candidate boom crossings | 0 rock; 0 decorative-mesh findings |
| Independent endpoint-to-triangle distance | 0 camera sphere overlaps; 0 origin-overlap fallbacks in this sweep |
| Actual marching-cubes rock, seeds 1 and 1337 | 1,296 poses, 9,072 center/offset ray probes; 0 failures |
| Synthetic camera contracts | 3,178 assertions; thin surfaces both ways, sphere edge clearance, open ring, intervening rock, roll/reversal/jitter/lean, pause, reset, overlap fallback |
| Unobstructed follow at 30/60/144/1000 Hz | Original exponential/velocity response preserved to 1e-9 m |
| Existing flight regression | Passed, including snapshot continuation, pause/death/retry, inversion, camera inheritance and mouse-delta math |
| Existing mission regression | 21 cases passed |
| About CPU contracts | 3/3 passed |

The broad sweep uses room centers plus three deterministic off-center positions,
four yaw/roll combinations and three pitch poses. It compares the old steady
endpoint ladder to the new steady constraint. It does not claim exhaustive
coverage of the whole cavern volume or every continuous flight trajectory.
Synthetic dynamic tests separately cover final-offset smoothing and lean.
The full receipt records coordinates for the first 80 baseline failures.

One sphere constraint query in the final CPU sweep averaged 0.02669 ms, with p95
0.0823 ms and maximum 0.7549 ms on this workstation. The live update makes two
queries. These CPU measurements exclude rendering and are not an FPS claim.
No meshes, materials, draw calls, textures, paint, cross-sections, moving parts
or LOD policies were changed. Existing Viper-method assemblies stay intact.

Run from this checkout (Three.js 0.179.0 is resolved by the existing loader):

```powershell
node --experimental-loader ./tools/ship-test-loader.mjs tools/camera-regression.mjs
node --experimental-loader ./tools/ship-test-loader.mjs tools/camera-investigation.mjs --full
node --experimental-loader ./tools/ship-test-loader.mjs tools/camera-mesh-validation.mjs
node --experimental-loader ./tools/ship-test-loader.mjs tools/roll-regression.mjs
node --experimental-loader ./tools/ship-test-loader.mjs tools/architecture-mission-unit.mjs
node --test tests/about-contract.cjs
```

Receipts are in `tools/out/camera-*.json` and the local review evidence ZIP.

## Scope and remaining review

Only live chase-camera positioning and close-camera exterior visibility change.
Ship physics, free inversion, input bindings, mission gates, energy-field fade,
snapshot semantics, first-person mode and authored asset geometry are unchanged.
Retry rebuilds the static obstacle index; disposal drops its references.
The cinematic death camera and dynamic actors are outside this correction.
An already embedded ship/decor origin can still require the zero-offset fallback;
this does not add decorative geometry to the flight collider.

The density field remains approximate. The two actual cave-mesh fixtures are
additional evidence, not a proof for all generated meshes. Static obstacle
transforms are cached and must be rebuilt if future gameplay starts moving them.

Independent review and coordinated muted headless gameplay/visual capture remain
pending. No new GPU run was authorized for this stage. No screenshots, video,
native Library IDs, human playtest, fullscreen or audio coverage are claimed.
Do not publish this candidate with the immutable reviewed release.
