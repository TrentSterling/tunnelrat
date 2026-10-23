# Separate rock clearance from authored frame clearance

Local follow-up to rejected `5aba228cdab3bd8b1cfbb978a101d11bc5224d1b`.
The reviewed release `ff9f90ed3b6a9e19a4a7247933195f7acd6eee39` remains
immutable and unpublished. Source re-review is required.

## Bounded runtime change

`ChaseCamera` now uses `field.renderField || field` for its rock sampling.
The renderer already uses that field for marching cubes. Unlike `field.sample`,
it excludes the conservative authored-frame collision envelope. Exact triangle
constraints for frames, ribs and other decoration remain unchanged and receive
the same camera radius. The extra rock approximation allowance is no longer
applied to those already-exact surfaces.

This is one executable-line change in `src/chase-camera.js`, with two explanatory
comment lines. Visibility hysteresis, camera smoothing/lean, the rock allowance,
physics, controls, mission logic and all asset geometry are unchanged.

## Retained reviewer reproduction

`tools/fixtures/camera-gate-retraction.json` retains the full-precision poses,
velocities and measurements from the three cases in the reviewer's
`task-7/review-camera-corrected/worst-retraction.json`. The long per-distance
diagnostic arrays are omitted; the original receipt remains in the review folder.
The fixture is seed 165, depth 1, with the security gate unlocked.

| Camera condition | Rejected distance | Corrected distance | Ship visible after |
| --- | --- | --- | --- |
| 16:9, shake 1.5 | 1.500 m | 6.512770 m | Yes |
| 32:9, no shake | 2.200 m | 6.512770 m | Yes |
| 32:9, shake 1.5 | 1.400 m | 6.512770 m | Yes |

All 243 actual near-plane/shake probes clear the rendered cave and static
assemblies. Minimum measured distance along the boom to real static triangles
is 0.921973 m; the minimum rock-field clearance is 2.959511 m. The test executes
the actual production `updateChaseCam`, including velocity lean and visibility.
It loads the rejected source from Git for an exact before run.

A separate positive-contact test points the camera toward the actual gate jamb:
the exact triangles stop it at 4.9479998 m. Without those triangles the same
rock query allows 6.300 m. This verifies that the correction does not simply
disable authored-frame obstruction.

## Safety validation

- The full production near-plane sweep passes again: 24 levels, 94,104 updates
  and 1,505,664 probes across portrait, 16:9 and 32:9 views, zero/max shake and
  all three biomes. Both earlier rock-penetration fixtures remain clear, and
  visibility toggles remain zero at 30, 60 and 144 Hz with hide/restore checks.
- The updated 48-seed/three-biome survey passes 93,348 legal poses, with zero
  rock intersections, static-mesh crossings or endpoint sphere overlaps.
- The survey now includes the security-frame mesh, matching production roots.
  Rock clearance is evaluated against `renderField`; authored structures are
  still evaluated against their actual transformed triangles.
- The reviewer's 14,544 corridor/gate cases pass when replayed with that same
  rock-only oracle. Its triangle overlap/crossing checks are unchanged. All nine
  pre-existing origin-overlap fallbacks remain nine; visibility toggles remain
  zero. This local rerun is not independent approval.
- All 3,178 camera unit assertions, flight/lifecycle regression, 21 mission
  cases and three About CPU contracts pass.

Full solver update timing in the corridor/gate replay was 0.0815 ms mean,
0.2353 ms p95 and 2.6793 ms maximum. These are workstation CPU timings; no
rendering speedup or FPS improvement is claimed.

Reproduce the exact gate result with:

```powershell
node --experimental-loader ./tools/ship-test-loader.mjs tools/camera-gate-regression.mjs --baseline
node --experimental-loader ./tools/ship-test-loader.mjs tools/camera-gate-regression.mjs
```

Receipts are in `tools/out/camera-gate-*.json` and the local evidence archive.
No GPU/browser session, desktop input, pointer lock, focus change, audio test,
publication or retry of a denied push occurred. Native screenshot/video proof
and coordinated muted headless visual validation remain pending. Dynamic actors,
the death camera and already-embedded ship origins retain the previously stated
limits; these deterministic CPU fixtures do not prove every cavern pose safe.
