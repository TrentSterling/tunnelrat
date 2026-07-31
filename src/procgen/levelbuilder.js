// levelbuilder.js : orchestrates graph -> field -> chunked marching cubes -> THREE meshes.
//
// CONTRACT (implement exactly):
//
// buildLevel(seed, config, onProgress?) -> {
//   graph,                       // from generateLevelGraph
//   field,                       // from createDensityField
//   caveGroup: THREE.Group,      // all cave chunk meshes, ready to scene.add()
//   spawnPos: THREE.Vector3,     // spawn node center
//   spawnQuat: THREE.Quaternion, // facing the first corridor (toward spawn's first neighbor)
// }
//
// Chunking: cover field.bounds with cubes of edge (config.world.chunk * config.world.voxelSize),
// call polygonize(field, chunkMin, chunkSize, config.world.chunk) per chunk, skip nulls.
// Overlap adjacent chunks by exactly one voxel (start each chunk one cell early / pad size
// by one voxelSize) so there are no seams; simpler: use exact tiling, seams are avoided
// because samples on shared faces are identical (field is pure). Use exact tiling.
//
// Per-chunk geometry: BufferGeometry with position + normal from polygonize, plus a
// 'color' attribute: vertex color = lerp(colors.rockDeep, colors.rockShallow,
// clamp01((y - bounds.min.y) / (bounds.max.y - bounds.min.y))) with a small (+-8%)
// deterministic per-vertex value jitter from position hash for texture.
// Material (ONE shared instance): MeshLambertMaterial({ vertexColors:true }).
// mesh.matrixAutoUpdate = false. Name meshes 'cave-cx-cy-cz'.
//
// onProgress(fractionDone 0..1) called between chunks when provided (loading screen).
// NOTE: caller may run this inside a setTimeout chain; keep buildLevel synchronous,
// main.js owns any async slicing.
import * as THREE from 'three';
import { generateLevelGraph } from './graph.js';
import { createDensityField } from './density.js';
import { polygonize } from './marchingcubes.js';

export function buildLevel(seed, config, onProgress) {
  throw new Error('NOT IMPLEMENTED: buildLevel');
}
