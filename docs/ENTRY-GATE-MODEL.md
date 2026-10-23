# Entry and security-gate assembly stage

Historical first-checkpoint report. Independent review rejected two defects:
unchecked gate placement and coincident fastener caps. `ENTRY-CORRECTION.md`
contains the current corrected construction, navigation guarantees, costs,
test results and evidence status. Its measurements supersede those below.

Base: deployed `dc6fcec4785f121bb88761b3dac368b2b11754d2`. This branch excludes
roll checkpoint `d2722d49dcf44b4ca46fdcc56ce3ddedaded6f65`. Apply the per-asset
checklist in `ASSET-ACCEPTANCE.md`. This is a local stage with inspected visual evidence, awaiting independent review, not a published environment change.

## Measured constraints and original construction

| Item | Metres / behavior | Confidence and source |
| --- | --- | --- |
| Built corridor | 5.2 radius | Exact configuration |
| Maximum original mouth flare | 7.8 radius | Exact 5.2 x 1.5 configuration |
| Ship collision sphere | 1.4 radius | Exact configuration |
| Approved visible ship | 1.338812 maximum radius | Approved mesh measurement |
| Gate inner opening | 5.2 apothem, twelve sides | Original choice containing the full original circular passage |
| Static entry inner opening | 7.8 apothem, twelve sides | Original choice containing the full original mouth flare |
| Structural depth / radial width | 2.2 / 1.45 | Authored section, no interpolated overshoot |
| Liner | 0.04 thickness | Authored closed shell |
| Mounting socket | 0.03 shoulder embed into rock | Continuous twelve-sided load-bearing interface |
| Rock transition | 8 m each side, 1.5 m central half-depth | Bell section exposing the flange to approach views |
| Locked field collision | Radius 6; ship radius+0.5 half-depth | Existing mission contract, unchanged |
| Key activation | Within 10 m; immediate unblock | Existing mission contract, unchanged |
| Visual deactivation | One-second field fade | Existing mission contract, unchanged |

The previous security frame was a decorative torus with no collision agreement.
The replacement is an original continuous pressure frame with fourteen authored
section stations, broad chamfered shoulders, stepped service recesses, a closed
liner, thick gaskets, flush hex fasteners and recessed paired power contacts.
The 4 cm liner meets the main shell, and outer shoulders embed into the rock
socket. Part names are stable in the scene graph. Structural surfaces are
FrontSide; only the optical energy sheet is intentionally two-sided.

Static entrances are deterministic, capped at six, and instanced by material.
Placement prefers built spawn connections and rejects overlaps with other
assemblies, room volumes and unrelated corridor centerlines. Existing ribs, light strips and pipe segments are omitted throughout the
rock socket approaches; inspected screenshots caught their initial overlap. Other corridor dressing remains.

The actual existing door is an energy barrier, not a mechanical leaf. Its emitter
assembly stays fixed, with no invented hinge, slide or arbitrary moving linkage.
The normalized `setOpenFraction` API drives the paired contacts from red to green
and the optical field opacity in both the game and lab. The physical sweep is
empty. Closed, intermediate and open poses share identical structural clearances.
Unlock still occurs immediately, before the one-second visual fade completes.
Bolts still pass through the energy sheet; the physical frame is ordinary solid
structure. Key, reactor, escape, death and retry logic is preserved.

## Render and collision agreement

`architecture-layout.js` owns the shared measured section and deterministic
layout. The field combines shaped rock sockets with the exact polygonal annular
section, gasket and contact envelopes. The rock-only field is used for marching
cubes; closed authored frame meshes render the physical metal. This avoids
polygonizing fine metal detail at the cave's voxel resolution. Distances are
conservative near polygon corners; the existing cave remains an approximate SDF.

The first shallow recess failed a CPU sightline check: 0.287 to 1.453 m of solid
rock hid service details from a 12 m normal approach. The tapered socket removes
that occlusion. Final sampled flange sightlines have at least 0.340 m clearance
from rock. This is numerical evidence, not a substitute for inspected screenshots.

The shared geometry test checks every physical vertex against collision, stored
normals against winding, positive shell volumes, outer/inner/front/rear FrontSide
rays, and actual transformed player vertices at collider contact. The latter retain
at least 0.173918 m clearance in the tested rolled and pitched attitudes.

## Current validation and cost

- Geometry and navigation: 201,890 assertions, 33 seeds, 180 actual Ship crossings.
  Both directions, centered/off-center paths, quarter roll and inversion pass.
  No loss of navigable graph-centerline clearance relative to deployed baseline.
- Nine real Ship/GameState cases: 3 seeds x 30/60/144 Hz, locked approach, actual
  key pickup, immediate unlock, crossing, reactor/escape, death/retry, timeout,
  reset and cleanup. Passed.
- Approved player model 111,396 assertions; winding regression and About 3 passed.
- Each physical frame: 1,488 triangles, 4 material batches. At most 6 static entries
  use 4 instanced draws in total; gate adds 4, optical field 1. Maximum 10,416 physical
  frame triangles plus 12 field triangles. Existing 96-triangle gate torus removed.
- No new textures or lights. Existing procedural grunge is reused; rest-space UVs
  repeat per metre and broad face paint is assigned in the authored section.
- No LOD switching for these bounded low-count assets. This is a geometry/draw
  budget, not an FPS speedup claim. Measured CPU construction costs are recorded below.
- Static geometry follows cave disposal; module-shared materials survive level
  reloads. The gate owns and disposes its private indicator material and field.

## Reproduce

Pinned Three.js 0.179.0 is resolved by `tools/ship-test-loader.mjs`; set
`THREE_MODULE` to its build/three.module.js if not installed in the sibling
validation-deps directory. The test reads baseline density code directly from
Git commit dc6fcec, so no separate checkout is required.

```powershell
node --loader ./tools/ship-test-loader.mjs tools/architecture-unit.mjs
node --loader ./tools/ship-test-loader.mjs tools/architecture-mission-unit.mjs
node --loader ./tools/ship-test-loader.mjs tools/ship-model-unit.mjs
node --loader ./tools/ship-test-loader.mjs tools/ship-winding-unit.mjs
node --test tests/about-contract.cjs
node tools/serve.mjs 8136
```

Acquire the shared browser/GPU lease before running capture. The current harness
launches muted, isolated headless Chromium, uses page-local synthetic keyboard
events and disables gamepads in that page. It makes no pointer-lock request, focus
call or OS input injection. These restrictions implement Trent's latest instruction.
Legacy root task wrappers for input-affecting tests are disabled.

The committed seed 1337 view fixtures use the same viewport and normal game
renderer for before/after. Closeups are debug-positioned and paused; traversal
uses the real Ship code with invulnerability. Historical before/after captures
used trusted CDP input before the cursor restriction; they were not repeated.
The subsequent detail run asserts pointer lock is off and passes page-local
movement, unlock, reactor/escape, next depth, death and retry with zero exceptions.
It hides actor meshes and holds the ship still only during the deactivation
closeup, restoring actual flight for traversal. The normal after recording keeps
actors visible, including an obstructing robot. Video is silent canvas-only footage
and excludes the DOM HUD. The separate lab uses controlled lighting and actual
game assets; it is not presented as gameplay.

## Inspected evidence and measured cost

Local evidence lives under `tools/out/architecture-before`, `architecture-after`
and `architecture-detail`, with JSON receipts. Front, front-quarter, rear-quarter,
closed, half-open and open lab views were inspected. The normal after recording
and the additional controlled detail recording exercise the operating field and
actual player traversal. The full physical frame remains after deactivation.

| Seed | Previous build | Candidate build | Cave/decor/props draws | Submitted triangles |
| --- | --- | --- | --- | --- |
| 1337 | 1,248 ms | 1,441 ms | 61 to 64 | 79,436 to 85,056 |
| 1338 | 1,856 ms | 2,091 ms | 68 to 70 | 91,212 to 96,972 |
| 1339 | 1,779 ms | 1,967 ms | 63 to 67 | 81,992 to 87,872 |

These are one sequential CPU construction sample per seed using identical
configuration, excluding GameState objective props; not a GPU frame-time test.
The gate adds four physical draws and its twelve-triangle field outside those
counts. Each seeded fixture has four static entries. Geometry memory increases
by about 0.36 to 0.39 MB. `tools/architecture-cost.mjs` reproduces this accounting;
pass a baseline `src/procgen/levelbuilder.js` path for the previous build.

Native Library artifacts, all version 0:

- Reference: `libfile_adcc739a6e708191b1bd7379f3069346`
- Before gate: `libfile_4a8b27654f7c8191a29d40b0dd3b5580`
- After gate: `libfile_077d6bf7c130819192fccc212cc43a00`
- Normal traversal video: `libfile_70a625b89994819183fa5ee4dbb3e53c`
- Static entry: `libfile_8e66054b68c88191bb675bcc5f507421`
- Controlled deactivation detail: `libfile_f888da657c0c8191b666c12c5217bf55`

The prepared-upload route could not transfer locally without its CLI. The supported
host-upload route succeeded. Windows lacks Unix xattrs, so local identity/hash
sidecars retain the returned Library IDs and version numbers without signed URLs.

## Review boundaries

This checkpoint requires independent review before publication. No environment
change has been pushed. The existing roll fix is separate and unmerged; this
stage does not claim to solve its known post-collision frame-rate divergence.
The cave is still an approximate SDF with coarse marching-cubes surfaces. Existing
ribs and props elsewhere in the mine retain their previous behavior. The recorded
CPU build increase is an explicit cost of the authored assemblies and sockets.
