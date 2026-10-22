# Entry and gate review correction

This repairs rejected `228dab3` locally; the approved live ship model is unchanged.
The environment branch still excludes the roll correction and requires re-review.

## Placement and navigation

Gate installation now validates every nearby graph segment, including unrelated
branches. A conservative annular envelope contains every physical part. Samples
are at most 0.25 m apart and include half-interval distance slack, certifying the
continuous centerline capsule for the 1.4 m ship sphere. Static entries additionally
reject entire unrelated corridor segments using continuous closest-point distance,
rather than checking only their polyline vertices.

The gate tries its original midpoint first, then one-metre offsets along the
unchanged straight locked corridor. Rendering, density and GameState use the
same accepted pose. Seeds 83, 91, 107 and 165 move 2, 3, 3 and 2 m respectively.
If no safe seat exists, the original optical gate remains at its original plane
without an unchecked physical frame. This exceptional fallback is tested; all
200 swept seeds retain modeled gates. Six static entries remain the maximum.

The guarantee protects the navigable centerline and ship radius. It does not
claim every point of an overlapping cavern retains its previous open width.
At the exact review points, clearance is now 2.683 / 3.343 / 3.272 / 2.716 m.
All four stationary ships stay exactly still before and after unlock; seed 107
previously moved 1.088539 m. Existing key activation distance, immediate unblock,
one-second field fade, reactor/escape and retry behavior are unchanged.

## Physical fastener seats

The two faces now have a recessed service rail with chamfered sides. Each hex
head seats on its 1.00 m axial floor, rises 0.07 m, and remains 0.03 m below the
1.10 m flange. There is no coincident exposed cap/flange plane. Shared collision
includes the actual hex heads inside the original 2.2 m depth; there is no
collision-envelope enlargement, DoubleSide material or depth-bias workaround.

The authored section has 22 stations. Each frame now has 1,680 triangles (+192),
still four material batches. Six entries plus one gate cost at most 11,760
physical triangles, plus the 12-triangle optical sheet. CPU geometry accounting
for seeds 1337/1338/1339 is 64/70/67 cave/decor/props draws and
85,824/97,740/88,640 submitted triangles; the gate is counted separately.
The extra seat geometry adds 25,344 bytes to those static-instance fixtures.
One corrected CPU build sample was 1,418 / 2,181 / 2,381 ms. No FPS claim.

## Validation and proof

- 550,437 geometry/navigation assertions, 203 seeded layouts, 180 Ship crossings.
- Independent-review sweep reproduced: 200 seeds, 633,757 centerline samples,
  zero newly blocked samples, zero static segment overlaps, minimum passing
  clearance 1.653675 m. Zero exposed cap triangles remain on the flange plane.
- Twenty-one Ship/GameState cases include all four failed seeds at 30/60/144 Hz.
- Twenty-four additional actual Ship crossings exercise the four previously
  obstructed neighboring corridors in both directions at three roll angles,
  with full shields and no snag. This is separate from the stationary probes.
- Every physical vertex is inside collision coverage, winding/FrontSide rays
  pass, and transformed ship clearance remains 0.173918 m in the inner-wall test.
- Front and oblique fastener closeups use the same views and actual materials
  as the review reproduction. Their new seat depth and clean cap were inspected.
- Fresh muted headless detail capture passed actual gate/entry flight, operating
  fade, reactor/exit, next depth, death/retry and zero browser exceptions. Actor
  meshes are hidden and flight held only during the labeled fade closeup.

```powershell
node --loader ./tools/ship-test-loader.mjs tools/architecture-unit.mjs
node --loader ./tools/ship-test-loader.mjs tools/architecture-path-regression.mjs
node --loader ./tools/ship-test-loader.mjs tools/architecture-mission-unit.mjs
node --loader ./tools/ship-test-loader.mjs tools/architecture-cost.mjs
```

Receipts are in `tools/out/architecture-*-corrected.json` and
`tools/out/fastener-corrected`. Capture is isolated, headless and muted before
launch, with exclusive shared GPU leases. No physical cursor, OS input, focus,
pointer lock or audio tests. The static lab loads no game runtime or input code.
Historical Library version-0 artifacts describe the rejected candidate until
explicitly replaced; they must not be presented as this correction's proof.

The current Library prepared-upload helper failed before preparation with
`Library prepare_uploads is not available`. No replacement or new native proof
ID was produced. Corrected screenshots, silent video and receipts remain in
`tools/out/architecture-detail` and `tools/out/fastener-corrected`.
