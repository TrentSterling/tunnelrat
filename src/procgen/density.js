// density.js : the cave as a signed scalar field. This field IS the level geometry
// source (marching cubes samples it) AND the physics world (SDF collision + LOS).
//
// SIGN CONVENTION (critical, everything depends on it):
//   sample(x,y,z) < 0  : open air (inside carved cave)
//   sample(x,y,z) > 0  : solid rock
//   magnitude is approximately signed distance in meters.
//
// CONTRACT (implement exactly):
//
// createDensityField(graph, seed, config) -> {
//   sample(x, y, z) -> number,
//   collisionNormal(x, y, z, out:THREE.Vector3) -> out,
//     unit vector pointing INTO OPEN AIR (away from rock): the direction to push a
//     colliding body. Computed via central differences on sample with eps ~0.5.
//   raycast(origin:Vector3, dir:Vector3 (unit), maxDist:number, step=0.8) -> number | -1,
//     marches from origin; returns distance at first sample >= 0, or -1 if clear.
//     Used for enemy line-of-sight and hitscan checks.
//   bounds: { min:THREE.Vector3, max:THREE.Vector3 },   // world box that contains all carving + margin
// }
//
// Field construction:
//   base = +4 (solid). For each room node: sdfSphere(p, node.pos, node.radius).
//   For each edge: a Catmull-Rom spline from a.pos to b.pos with 2 interior waypoints
//   jittered by rng (up to 22% of edge length, perpendicular-ish), sampled into a
//   polyline of ~14 segments; sdfCapsule along each segment with radius
//   randRange(rng, ...config.world.tunnelRadius) per edge (one radius per edge).
//   field = min(base, all sdfs), then organic walls:
//   result += fbm3(noise, p * config.world.noiseFreq) * config.world.noiseAmp,
//   with noiseAmp faded to 0 within 6m of every node.pos of kind 'spawn'|'exit'
//   (keep gameplay-critical rooms clean) . Precompute edge polylines ONCE in
//   createDensityField; sample() must not allocate (reuse scratch vectors).
//
// PERF: sample() is called ~1-4 million times during meshing; keep the inner loop
// tight, use squared-distance early-outs against each edge's bounding sphere.
//
// Deterministic for a given seed (own makeRng(seed ^ 0xCAFE), own makeNoise3D(seed)).
import * as THREE from 'three';
import { makeRng, randRange } from '../util/rng.js';
import { makeNoise3D, fbm3 } from '../util/noise.js';

export function createDensityField(graph, seed, config) {
  throw new Error('NOT IMPLEMENTED: createDensityField');
}
