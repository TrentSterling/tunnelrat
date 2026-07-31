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

const BASE = 4; // solid rock value far from any carving

// closest-point-on-segment distance, plain floats, zero allocation
function capsuleDist(x, y, z, ax, ay, az, bx, by, bz) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const apx = x - ax, apy = y - ay, apz = z - az;
  const abLenSq = abx * abx + aby * aby + abz * abz;
  let t = abLenSq > 1e-9 ? (apx * abx + apy * aby + apz * abz) / abLenSq : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const cx = ax + abx * t, cy = ay + aby * t, cz = az + abz * t;
  const dx = x - cx, dy = y - cy, dz = z - cz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function createDensityField(graph, seed, config) {
  const rng = makeRng(seed ^ 0xcafe);
  const noise = makeNoise3D(seed);
  const { noiseAmp, noiseFreq, tunnelRadius } = config.world;

  const nodeById = new Map();
  for (const n of graph.nodes) nodeById.set(n.id, n);

  // ---------- room spheres ----------
  // each: cx,cy,cz,r, boundSq = (r + BASE)^2 : outside this, sd > BASE, can't beat base
  const spheres = graph.nodes.map((n) => {
    const r = n.radius;
    const bound = r + BASE;
    return { cx: n.pos.x, cy: n.pos.y, cz: n.pos.z, r, boundSq: bound * bound };
  });

  // ---------- edge polylines ----------
  // each: { cx,cy,cz (centroid), boundSq, radius, segments:[{ax,ay,az,bx,by,bz}] }
  const edgePolylines = [];
  const arbY = new THREE.Vector3(0, 1, 0);
  const arbX = new THREE.Vector3(1, 0, 0);

  for (const edge of graph.edges) {
    const a = nodeById.get(edge.a);
    const b = nodeById.get(edge.b);
    if (!a || !b) continue;

    const dir = new THREE.Vector3().subVectors(b.pos, a.pos);
    const edgeLen = dir.length();
    if (edgeLen > 1e-6) dir.normalize(); else dir.set(1, 0, 0);

    const arbitrary = Math.abs(dir.y) < 0.9 ? arbY : arbX;
    const perp1 = new THREE.Vector3().crossVectors(dir, arbitrary);
    if (perp1.lengthSq() < 1e-9) perp1.set(1, 0, 0); else perp1.normalize();
    const perp2 = new THREE.Vector3().crossVectors(dir, perp1).normalize();

    const jitterMag = edgeLen * 0.22;

    function jitteredWaypoint(t) {
      const p = new THREE.Vector3().lerpVectors(a.pos, b.pos, t);
      const jx = randRange(rng, -1, 1) * jitterMag;
      const jy = randRange(rng, -1, 1) * jitterMag;
      p.addScaledVector(perp1, jx);
      p.addScaledVector(perp2, jy);
      return p;
    }

    const w1 = jitteredWaypoint(1 / 3);
    const w2 = jitteredWaypoint(2 / 3);

    const curve = new THREE.CatmullRomCurve3([a.pos.clone(), w1, w2, b.pos.clone()]);
    const segCount = 14;
    const pts = curve.getPoints(segCount); // segCount+1 points

    const radius = randRange(rng, tunnelRadius[0], tunnelRadius[1]);

    // centroid + max extent for a single bounding sphere over the whole polyline
    let cx = 0, cy = 0, cz = 0;
    for (const p of pts) { cx += p.x; cy += p.y; cz += p.z; }
    cx /= pts.length; cy /= pts.length; cz /= pts.length;

    let maxExtent = 0;
    for (const p of pts) {
      const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > maxExtent) maxExtent = d;
    }

    const bound = maxExtent + radius + BASE;
    const segments = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i], p1 = pts[i + 1];
      segments.push({ ax: p0.x, ay: p0.y, az: p0.z, bx: p1.x, by: p1.y, bz: p1.z });
    }

    edgePolylines.push({ cx, cy, cz, boundSq: bound * bound, radius, segments });
  }

  // ---------- noise fade anchors (spawn/exit rooms stay clean) ----------
  const fadeNodes = graph.nodes
    .filter((n) => n.kind === 'spawn' || n.kind === 'exit')
    .map((n) => ({ x: n.pos.x, y: n.pos.y, z: n.pos.z }));

  function noiseFadeAt(x, y, z) {
    let fade = 1;
    for (let i = 0; i < fadeNodes.length; i++) {
      const n = fadeNodes[i];
      const dx = x - n.x, dy = y - n.y, dz = z - n.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < 6) return 0;
      if (dist < 9) {
        const f = smoothstep(6, 9, dist);
        if (f < fade) fade = f;
      }
    }
    return fade;
  }

  function sample(x, y, z) {
    let d = BASE;

    for (let i = 0; i < spheres.length; i++) {
      const s = spheres[i];
      const dx = x - s.cx, dy = y - s.cy, dz = z - s.cz;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq > s.boundSq) continue;
      const dist = Math.sqrt(distSq);
      const sd = dist - s.r;
      if (sd < d) d = sd;
    }

    for (let i = 0; i < edgePolylines.length; i++) {
      const e = edgePolylines[i];
      const dx = x - e.cx, dy = y - e.cy, dz = z - e.cz;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq > e.boundSq) continue;
      const segs = e.segments;
      for (let j = 0; j < segs.length; j++) {
        const seg = segs[j];
        const dist = capsuleDist(x, y, z, seg.ax, seg.ay, seg.az, seg.bx, seg.by, seg.bz);
        const sd = dist - e.radius;
        if (sd < d) d = sd;
      }
    }

    const fade = noiseFadeAt(x, y, z);
    if (fade > 0) {
      d += fbm3(noise, x * noiseFreq, y * noiseFreq, z * noiseFreq) * noiseAmp * fade;
    }

    return d;
  }

  function collisionNormal(x, y, z, out) {
    const e = 0.5;
    const dx = sample(x + e, y, z) - sample(x - e, y, z);
    const dy = sample(x, y + e, z) - sample(x, y - e, z);
    const dz = sample(x, y, z + e) - sample(x, y, z - e);
    out.set(-dx, -dy, -dz);
    const len = out.length();
    if (len > 1e-6) out.multiplyScalar(1 / len);
    else out.set(0, 1, 0);
    return out;
  }

  function raycast(origin, dir, maxDist, step = 0.8) {
    let t = 0;
    while (t <= maxDist) {
      const px = origin.x + dir.x * t;
      const py = origin.y + dir.y * t;
      const pz = origin.z + dir.z * t;
      if (sample(px, py, pz) >= 0) return t;
      t += step;
    }
    return -1;
  }

  // ---------- bounds ----------
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const s of spheres) {
    min.x = Math.min(min.x, s.cx - s.r); min.y = Math.min(min.y, s.cy - s.r); min.z = Math.min(min.z, s.cz - s.r);
    max.x = Math.max(max.x, s.cx + s.r); max.y = Math.max(max.y, s.cy + s.r); max.z = Math.max(max.z, s.cz + s.r);
  }
  for (const e of edgePolylines) {
    for (const seg of e.segments) {
      for (const p of [[seg.ax, seg.ay, seg.az], [seg.bx, seg.by, seg.bz]]) {
        min.x = Math.min(min.x, p[0] - e.radius); min.y = Math.min(min.y, p[1] - e.radius); min.z = Math.min(min.z, p[2] - e.radius);
        max.x = Math.max(max.x, p[0] + e.radius); max.y = Math.max(max.y, p[1] + e.radius); max.z = Math.max(max.z, p[2] + e.radius);
      }
    }
  }
  const margin = noiseAmp + Math.max(tunnelRadius[1], 4) + 4;
  min.subScalar(margin);
  max.addScalar(margin);

  return {
    sample,
    collisionNormal,
    raycast,
    bounds: { min, max },
  };
}
