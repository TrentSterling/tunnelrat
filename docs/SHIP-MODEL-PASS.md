# TUNNELRAT ship model pass

Local review checkpoint from `a3026211802e890700a75d38b8178054aa81d253`.
Source remote: `https://github.com/TrentSterling/tunnelrat.git`.

## Reference and scope

Trent supplied *Jets made of numbers*, VIPER 11 note 8, by apek, as Library
`libfile_2b4825d282d8819196412f5cd8851d1e`. The 12,838-byte text was downloaded
and read. This pass applies its numerical references, authored cross-sections,
locked views, named assemblies and explicit geometry budgets to an original
fictional mining ship. It does not use an aircraft mesh or change TUNNELRAT into
a conventional flight simulator.

The live site's `main.js`, `ship.js`, `robots.js` and `config.js` match this
baseline after LF/CRLF normalization. The original `C:/trontstack/tunnelrat`
checkout was stale at `65ece47`; it was left untouched. Work is isolated in
`codex/tunnelrat-ship-20261022`, with no push or publication.

## Existing game

The complete keycard, locked door, reactor and timed escape loop already exists.
There is a guide bot enabled at spawn, a persistent minimap, a full automap,
breadcrumbs, keyboard/mouse and gamepad flight, first-person and chase cameras,
death tumble, burned wreck and XP recovery. An authored teaching descent was
not assumed necessary. No persistent save or multiplayer system is present in
this revision.

The baseline player ship contains 528 triangles in 39 meshes. Its vertex radius
is 2.221582 m although `CONFIG.ship.radius` is 1.4 m. There are 337 vertex entries
outside that sphere. The baseline bounds are 3.549172 m wide, 1.485542 m high,
and 3.741757 m long. These are measured mesh values, not real-world references.

Baseline self-play used the real game, trusted pointer-lock entry and CDP-held
forward, strafe/climb, roll, reverse and release input. It preserved shields
through the initial flight, made contact during the strafe, and retained full
roll freedom. The inspected chase and contact screenshots show flat rectangular
shoulders and white exhaust disks; the close contact view makes the visual
clearance mismatch particularly confusing. This is the concrete reason for
the compact model pass. The mine's momentum, banking and route finding remain
the playable core; no authored teaching descent was added.

## Authored targets

These are design choices for an original fictional vehicle, not claimed
historical dimensions. The existing 1.4 m collision sphere and eye origin are
hard constraints taken from the game. Local +Z is the model's forward axis;
the existing chase mount rotates it onto the flight model's -Z axis.

| Target | Value / rationale |
| --- | --- |
| Furthest visible vertex | At most 1.38 m, leaving clearance inside the existing sphere |
| Span | 2.50 m, short swept mining shoulders |
| Length | 2.348 m, compact hull with protected twin forward rails |
| Height | 0.841 m, fitted raised canopy and protected dorsal blade |
| Palette | Existing silver and green; dark canopy, warm twin drives |
| Hull construction | Seven explicitly authored chamfered cross-sections; linear interpolation cannot overshoot |
| UV construction | One repeat per metre, planar projection from rest-space vertices |
| Geometry budget | 2,400 triangles and 10 draws maximum; actual 884 triangles and four draws |
| Eye anchor | Named `pilot-eye` at unchanged local origin |
| Detail policy | One low-cost mesh level; no distant LOD needed for a sub-1k-triangle player/wreck model |

The new mesh extends 1.338812 m from the origin, with no visible vertex outside
the collision sphere. The game collider and movement code are unchanged.
This establishes agreement with the collision envelope, not a guarantee about
the approximate cave SDF, marching-cubes surface, or non-colliding decorations.

Hull, canopy, drive cores and maneuvering ports have separate names/materials.
Static armor is combined; no unnecessary moving jet control surfaces were
introduced. The twin cores sit behind an actual collar; a self-lit material
preserves their warm color under the headlamp. The same builder is used for chase, tumble and
recovered wreck. The death tumble now applies the same model-forward rotation
as chase; scorching keeps the continuous hull sooty and the drives hot.

## Validation tools

`tools/ship-capture.mjs before|after [url]` drives the actual game with CDP
keyboard input and a trusted pointer-lock click, saves full-page screenshots,
and records a canvas-only WebM. The final chase fixture is explicitly debug
positioned and paused, and the four-view lab uses fixed orthographic cameras,
lighting and scale. Muted captures do not establish audio quality.

For CPU validation, install the pinned `three@0.179.0` outside the runtime tree:

```
npm install --prefix ../validation-deps --no-audit --no-fund --ignore-scripts three@0.179.0
node --loader ./tools/ship-test-loader.mjs tools/ship-measure.mjs
node --loader ./tools/ship-test-loader.mjs tools/ship-model-unit.mjs
node --loader ./tools/ship-test-loader.mjs tools/ship-winding-unit.mjs
node --loader ./tools/ship-test-loader.mjs tools/flight-replay.mjs
node --test tests/about-contract.cjs
```

`THREE_MODULE` can point at an existing matching `build/three.module.js`.
The measurement tool substitutes only a canvas texture stub; it measures real
Three.js geometry and transformed vertices, without claiming rendered pixels.

The four-second reversal probe changes input at an exact two-second boundary.
The original movement has 6.752914 m positional divergence at 30 versus 144 Hz
with simultaneous strafe, climb, forward thrust, roll and look input. This is a
pre-existing issue, not fixed or hidden by the visual work. The baseline JSON is
retained for exact before/after comparison. Analytic wall collision and three
procedural seed spawn-clearance checks pass.

## Final evidence and results

Validation used Chrome 155.0.8059.85 on the RTX 5070 Ti through ANGLE/D3D11,
1280 x 720 for both reference capture runs. Before and after use the same seed,
ship position, identity quaternion, zero velocity, reset chase rig, health and
energy for the fixed chase fixture. The four-view references use identical
lighting and orthographic scale. Ordinary self-play uses timed browser input
and real frame intervals, so its paths are comparable but not deterministic.
The separate CPU replay establishes exact movement equivalence.

- Mission smoke: 5 passed, 0 failed, including reactor escape and reaching exit.
- Movement smoke: 5 passed, 0 failed; 24.3 m forward movement, 3.3 m/s after
  release, in open air, shields 100.
- Both matched capture runs: pointer lock, forward motion, drift release,
  automap, death tumble, wreck and retry completed without browser exceptions.
- Geometry: finite vertices and normals; fixed silhouette across builder seeds;
  all transformed vertices within tangent walls at sampled bank/inversion/slope
  attitudes; actual wall integration tested at 30/60/144 Hz.
- Three About preservation contracts passed. Flight replay JSON is byte-identical.
- Mesh budget: 528 to 884 triangles; 39 to 4 meshes. No FPS or GPU speedup claim.

Native Library evidence for the initial `ad27de2` checkpoint (each file creation
confirmed; correction captures below are currently local):

| Artifact | Library ID |
| --- | --- |
| Before orthographic reference | `libfile_bf6d8eab588481919476a66f0bfc64c1` |
| After orthographic reference | `libfile_00b288603c9081919cd4df548b91e5a3` |
| Before matched chase | `libfile_1bfa71fbeb0881919ee3e792067bb9f5` |
| After matched chase | `libfile_6ae9b224544c8191a48058394ed92754` |
| Candidate self-play WebM | `libfile_67b3883f8cd481918ed406c4531dfcc7` |

Local raw receipts are under `tools/out/ship-final`, `tools/out/ship-unit.json`,
`tools/out/flight-before.json`, `tools/out/flight-after.json`,
`tools/out/ship-mission.log` and `tools/out/ship-movement.log`.
The separate unchanged baseline export holds `tools/out/ship-matched`.

The video contains canvas rendering only, omits the DOM HUD, and is muted.
No physical gamepad, audio listening, low-end hardware or human playtest is
claimed. Existing close chase-camera/decor intersection and timestep variation
remain separate issues. The reviewer should assess the deliberate reduction in
apparent ship size: it is now aligned with collision rather than the old
oversized decoration.

## Independent review correction

Independent review rejected the first checkpoint, `ad27de2`, for inverted engine
housing faces. The shared skin builder expects clockwise rings viewed from +Z;
the circular engine rings were supplied in the opposite order. All 48 triangles
in each housing pointed inward, so a downward FrontSide ray missed the roof at
y = +0.231154 m and hit the underside at y = -0.301154 m. The initial normal
length checks did not detect orientation.

The correction reverses each engine ring before skinning. All materials retain
FrontSide culling. It preserves the exact sorted vertex multiset, bounds,
collision sphere, four mesh draws and 884 triangles. The 1.338812 m maximum
vertex radius still leaves 0.061188 m radial clearance within the collider.
There is no performance speedup claim.

The new `ship-winding-unit.mjs` regression fails on the reviewed checkpoint and
passes after the correction. It recovers connected housing shells from the
actual batched geometry, checks every triangle and stored lighting normal, and
verifies positive signed volume (+0.099480 m3 per housing). FrontSide rays from
all six axial directions hit the exterior before the shell center; the reviewer's
downward roof repro now hits +0.231154 m on both engines. The existing model
regression still passes 111,396 assertions, the three About contracts pass, and
the flight replay remains byte-identical to the original baseline.

Raw correction receipts are in `tools/out/winding-before.log`,
`tools/out/winding-after.json`, `tools/out/winding-model-unit.json`,
`tools/out/winding-flight.json`, and the paired `winding-shape-*` and
`winding-bounds-*` JSON files. Fresh rendered proof is in `tools/out/ship-winding`.
The top, side, front and chase-quarter views were inspected against `ship-final`
with identical cameras, lighting and scale. The housing roofs now render as
exterior surfaces. The real-game chase, death tumble and wreck were also checked.
Trusted pointer-lock flight, roll, drift release, automap and retry passed with
no browser exceptions, and the shared GPU slot was released after capture.

Refreshing the three existing candidate Library files was blocked by the current
supported uploader reporting `Library prepare_uploads is not available`.
A subsequent read confirmed their original file IDs and byte sizes were
unchanged. No replacement is claimed. Corrected `reference.png`,
`matched-chase.png` and `selfplay.webm` remain in `tools/out/ship-winding`;
the video was decoded and a frame visually inspected. It retains the same
canvas-only, muted capture limits as the initial video.

The correction is kept separate from the known
roll/reversal timestep issue and requires independent re-review before any
publication.
