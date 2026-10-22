# Authored asset acceptance

Apply this checklist to each asset and record its evidence, rather than citing
the reference once for the whole project. The reference is a method, not a
licensed aircraft design to copy into this original mining game.

## Reference provenance

Trent's latest Library attachment is `libfile_e482e136c2c88191aaff1331df2c126a`,
*Jets made of numbers*, VIPER 11 note 8 by apek. It was materialized into this
task's executor and read on 2026-10-22. Actual length: 12,838 bytes. SHA-256:
`85b5ad9037846e2439138d8d7a2843869fd7a10d80fbc994cd8e5b46ecac24c2`.
The bytes were compared with the earlier attachment and match; that was verified,
not assumed. The local receipt retains Library identity because Windows Python
does not support the requested Unix extended attributes.

## Checklist for every asset

- [ ] **Measured reference pack.** List dimensions and proportions in metres,
  source, confidence and contradictions. Distinguish game constraints from
  original design choices. Numerical constraints override inconsistent images.
- [ ] **Locked views.** Compare front, side, top and perspective at consistent
  scale and lighting. Correct the silhouette before detailing. Include an actual
  in-game view with the normal camera and headlamp; a studio render is insufficient.
- [ ] **Authored cross-sections.** Record stations, section outlines, thicknesses,
  deliberate creases and smooth transitions. Interpolation must not overshoot.
  Verify closed surfaces, outward winding, FrontSide culling and lighting normals
  from several directions. The ship housing review demonstrated why this matters.
- [ ] **Complete physical assembly.** Explain the load path and construction:
  liner, jamb/frame, mounting supports, seals, recesses and service hardware as
  applicable. Parts must meet at plausible interfaces rather than float together.
- [ ] **Functional movement.** Classify a static entrance separately from an
  operable gate. Give genuinely moving parts names and real pivot/slide axes.
  One normalized pose API must drive game and inspection fixtures. Verify closed,
  intermediate and open poses, end stops and swept clearances. Do not animate a
  static entry merely to make it move.
- [ ] **Navigation and collision.** Compare rendered solid geometry with the
  collision representation and transformed player vertices. Exercise both
  directions, full roll/inversion, off-center paths and operating transitions.
  Preserve graph connectivity, gate/key/reactor/escape rules and input bindings.
  Decorative geometry must not silently intersect a legal flight path.
- [ ] **Materials and markings.** Separate structural metal, liners, seals and
  powered surfaces through depth and plausible response to light. Avoid z-fighting
  and excessive emissive washout. Paint/UVs use physical dimensions and rest-space
  coordinates so markings remain attached to articulated parts.
- [ ] **Cost and lifecycle.** Record triangles, draw calls, repeated-instance count,
  build cost, texture bytes and any LOD policy. Use the actual asset in the game,
  lab and capture harness. Verify disposal/retry and preserve shared materials.
  Do not infer an FPS improvement from draw-count changes alone.
- [ ] **Evidence and limits.** Keep deterministic seeded fixtures, before/after
  views, traversal receipts and animation evidence for operating mechanisms.
  Record actual test results and remaining limitations. Seek independent review
  of each staged checkpoint before publication.

## Current asset review ledger

Environment checkpoint `228dab3` was rejected for gate placement and coplanar
fastener caps. The local correction is described in `ENTRY-CORRECTION.md` and
awaits independent re-review. The table below records the original asset design;
its old navigation/material passes were insufficient and are superseded by the
203-layout / 200-seed continuous-path and modeled-seat acceptance results.

| Asset | Status | Evidence |
| --- | --- | --- |
| Player interceptor | Independently approved at `0a5b66f` | `SHIP-MODEL-PASS.md`; outward housings, fixed multi-view references, collider envelope and gameplay |
| Static tunnel entry architecture | Locally validated; independent review pending | `ENTRY-GATE-MODEL.md`; measured 7.8 m apothem, full closed section, socket/liner/seals, 33 seeded layouts, 180 total entry/gate crossings, inspected matched views |
| Operable security gate | Locally validated; independent review pending | `ENTRY-GATE-MODEL.md`; physical fixed emitter, preserved immediate unblock and one-second fade, shared normalized pose API, closed/intermediate/open views and mission lifecycle |

The article's particular jet dimensions, triangle counts, canopy optics and
cockpit offsets are examples, not targets for TUNNELRAT. Its shared material
interfaces and honest notes on unfinished work are applicable; aircraft control
surfaces, bank-turn physics and licensed airframes are not imported.

## Entry/gate acceptance record

| Checklist item | Static entries | Energy gate |
| --- | --- | --- |
| Measured reference/proportions | Pass: 7.8 m opening apothem, 2.2 m depth | Pass: 5.2 m opening apothem, 2.2 m depth |
| Locked views and silhouette | Pass: matching game front/quarters | Pass: matching game views plus front/side/rear/front-quarter lab |
| Authored sections and outward shells | Pass: fourteen stations, FrontSide ray tests | Pass: same construction family, positive volumes |
| Complete physical assembly | Pass: liner, stepped flange, socket shoulders, seals, fasteners, lamps | Pass: same structure plus paired emitter contacts and fitted optical sheet |
| Functional motion | Static by design | No mechanical sweep; normalized field deactivation tested at 0/0.5/1 |
| Navigation and collision | Pass: original flare contained, transformed ship checks | Pass: clear opening, immediate key unlock, lifecycle and crossing |
| Material/rest-space paint | Pass: metre UVs, distinct metal/liner/seal/power surfaces | Pass: same, operating contact colors and field opacity |
| Cost/lifecycle | Pass with measured build increase disclosed | Pass: persistent frame, private material/field cleanup |
| Evidence/limits | Inspected local and native Library proof | Normal gameplay and additional labeled background detail proof |

Independent review remains required for both assets. These local acceptance
results are evidence for that review, not an assertion that review has happened.
