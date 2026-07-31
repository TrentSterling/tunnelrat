// marchingcubes.js : classic marching cubes over a density field region.
//
// CONTRACT (implement exactly):
//
// polygonize(field, min:THREE.Vector3, size:number, res:number) -> {
//   positions: Float32Array,  // world-space triangle soup, 9 floats per tri
//   normals:   Float32Array,  // per-vertex, from field.collisionNormal (negated so the
//                             // rendered surface normal faces INTO the cave air where the
//                             // camera is; verify visually: walls lit by headlamp, not black)
// } | null when the region produced no triangles (fully solid or fully open)
//
// min = region corner, size = region edge length (m), res = cells per axis.
// Grid has (res+1)^3 samples; cache them in a Float32Array first, then march cells
// with the standard edgeTable/triTable (embed the full 256-entry tables inline).
// Vertex position via linear interpolation to the zero crossing.
// Surface exists where sample crosses 0 (air < 0 convention from density.js).
//
// Pure function, no scene objects. Keep allocations to the output arrays
// (accumulate in a plain JS array, convert to Float32Array once at the end).
import * as THREE from 'three';

export function polygonize(field, min, size, res) {
  throw new Error('NOT IMPLEMENTED: polygonize');
}
