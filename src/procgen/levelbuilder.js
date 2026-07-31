// levelbuilder.js : orchestrates graph -> field -> chunked marching cubes -> THREE meshes.
//
// CONTRACT (implement exactly):
//
// buildLevel(seed, config, onProgress?) -> {
//   graph,                       // from generateLevelGraph
//   field,                       // from createDensityField
//   caveGroup: THREE.Group,      // all cave chunk meshes + the decor group (decor.js),
//                                // ready to scene.add(); automap hologram + level
//                                // disposal pick decor up automatically via traverse
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
import { buildDecor } from './decor.js';
import { grungeTexture } from '../util/grungetex.js';

// One shared material for every chunk mesh across the app lifetime (levels reload,
// disposeLevel() in main.js only disposes geometries, so the material must not be
// recreated per level or it would leak). Grunge map multiplies under the vertex colors.
const caveMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, map: grungeTexture() });

const UV_SCALE = 0.14; // world meters -> uv; 64px texture = chunky ~11cm texels

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Cheap deterministic position hash -> [0,1), no rng.js dependency needed since this
// is purely a function of world position (same vertex position always gets the same
// jitter regardless of build order).
function hash01(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453123;
  return s - Math.floor(s);
}

// scratch (buildLevel is not a hot per-frame path, but avoid needless churn anyway)
const _dir = new THREE.Vector3();
const _origin = new THREE.Vector3(0, 0, 0);
const _upY = new THREE.Vector3(0, 1, 0);
const _upX = new THREE.Vector3(1, 0, 0);
const _lookMat = new THREE.Matrix4();

// Ship forward is -Z of object3d (see ship.js contract); build a quaternion whose
// local -Z axis points along `dir` in world space.
function quatFacing(dir) {
  const up = Math.abs(dir.y) > 0.98 ? _upX : _upY;
  _lookMat.lookAt(_origin, dir, up);
  return new THREE.Quaternion().setFromRotationMatrix(_lookMat);
}

export function buildLevel(seed, config, onProgress) {
  const cfg = config;
  const graph = generateLevelGraph(seed, cfg);
  const field = createDensityField(graph, seed, cfg);

  const res = cfg.world.chunk;
  const chunkSize = cfg.world.chunk * cfg.world.voxelSize;
  const bounds = field.bounds;

  const sizeX = bounds.max.x - bounds.min.x;
  const sizeY = bounds.max.y - bounds.min.y;
  const sizeZ = bounds.max.z - bounds.min.z;
  const nx = Math.max(1, Math.ceil(sizeX / chunkSize));
  const ny = Math.max(1, Math.ceil(sizeY / chunkSize));
  const nz = Math.max(1, Math.ceil(sizeZ / chunkSize));
  const totalChunks = nx * ny * nz;

  const rockDeep = new THREE.Color(cfg.colors.rockDeep);
  const rockShallow = new THREE.Color(cfg.colors.rockShallow);
  const ySpan = sizeY > 1e-6 ? sizeY : 1;

  const caveGroup = new THREE.Group();
  caveGroup.name = 'caveGroup';

  let done = 0;
  const chunkMin = new THREE.Vector3();

  for (let cz = 0; cz < nz; cz++) {
    for (let cy = 0; cy < ny; cy++) {
      for (let cx = 0; cx < nx; cx++) {
        chunkMin.set(
          bounds.min.x + cx * chunkSize,
          bounds.min.y + cy * chunkSize,
          bounds.min.z + cz * chunkSize,
        );

        const result = polygonize(field, chunkMin, chunkSize, res);
        if (result) {
          const vertexCount = result.positions.length / 3;
          const colors = new Float32Array(vertexCount * 3);
          for (let v = 0; v < vertexCount; v++) {
            const px = result.positions[v * 3];
            const py = result.positions[v * 3 + 1];
            const pz = result.positions[v * 3 + 2];

            const t = clamp01((py - bounds.min.y) / ySpan);
            const jitter = (hash01(px, py, pz) * 2 - 1) * 0.08;

            const ci = v * 3;
            colors[ci] = clamp01((rockDeep.r + (rockShallow.r - rockDeep.r) * t) * (1 + jitter));
            colors[ci + 1] = clamp01((rockDeep.g + (rockShallow.g - rockDeep.g) * t) * (1 + jitter));
            colors[ci + 2] = clamp01((rockDeep.b + (rockShallow.b - rockDeep.b) * t) * (1 + jitter));
          }

          // world-space box projection, ONE axis per TRIANGLE (geometric face normal).
          // Per-vertex axis selection interpolated across triangles whose smooth
          // normals straddled an axis flip, smearing the texture into long streaky
          // bands on domes; a per-face choice keeps every texel square.
          const uvs = new Float32Array(vertexCount * 2);
          const P = result.positions;
          for (let v = 0; v < vertexCount; v += 3) {
            const i0 = v * 3, i1 = (v + 1) * 3, i2 = (v + 2) * 3;
            const e1x = P[i1] - P[i0], e1y = P[i1 + 1] - P[i0 + 1], e1z = P[i1 + 2] - P[i0 + 2];
            const e2x = P[i2] - P[i0], e2y = P[i2 + 1] - P[i0 + 1], e2z = P[i2 + 2] - P[i0 + 2];
            const fnx = Math.abs(e1y * e2z - e1z * e2y);
            const fny = Math.abs(e1z * e2x - e1x * e2z);
            const fnz = Math.abs(e1x * e2y - e1y * e2x);
            let ua, wa; // component offsets for the two projected axes
            if (fnx >= fny && fnx >= fnz) { ua = 1; wa = 2; }
            else if (fny >= fnz) { ua = 0; wa = 2; }
            else { ua = 0; wa = 1; }
            for (let k = 0; k < 3; k++) {
              const vi = (v + k) * 3;
              uvs[(v + k) * 2] = P[vi + ua] * UV_SCALE;
              uvs[(v + k) * 2 + 1] = P[vi + wa] * UV_SCALE;
            }
          }

          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(result.positions, 3));
          geo.setAttribute('normal', new THREE.BufferAttribute(result.normals, 3));
          geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
          geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

          const mesh = new THREE.Mesh(geo, caveMaterial);
          mesh.matrixAutoUpdate = false;
          mesh.name = `cave-${cx}-${cy}-${cz}`;
          caveGroup.add(mesh);
        }

        done++;
        if (onProgress) onProgress(done / totalChunks);
      }
    }
  }

  // industrial dressing for built sections; lives INSIDE caveGroup so the automap
  // hologram and disposeLevel() pick it up automatically (materials are shared
  // module-scope in decor.js, disposal only touches geometries)
  caveGroup.add(buildDecor(field, graph, cfg));

  const spawnNode = graph.nodes.find((n) => n.id === graph.spawnId);
  const spawnPos = spawnNode.pos.clone();

  const neighborIds = graph.neighbors.get(graph.spawnId);
  let spawnQuat;
  if (neighborIds && neighborIds.length > 0) {
    const firstNeighbor = graph.nodes.find((n) => n.id === neighborIds[0]);
    _dir.subVectors(firstNeighbor.pos, spawnPos).normalize();
    spawnQuat = quatFacing(_dir);
  } else {
    spawnQuat = new THREE.Quaternion();
  }

  return { graph, field, caveGroup, spawnPos, spawnQuat };
}
