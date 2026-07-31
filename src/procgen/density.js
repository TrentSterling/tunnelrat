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
//   decor: {                                            // for procgen/decor.js; no spline recompute
//     edges: [{ a, b, style, radius, locked, polyline: THREE.Vector3[] }],
//     rooms: [{ id, pos:THREE.Vector3, radius, style, kind }],
//     seed,                                             // level seed (decor derives its own rng)
//   },
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
// BUILT SECTIONS (style 'built' on graph nodes/edges, see graph.js):
//   - built edges carve with ONE constant radius (config.built.tunnelRadius) and
//     reduced spline jitter (config.built.jitterScale; the locked edge is dead
//     straight so the door disc + hazard frame sit inside the corridor).
//   - fbm noise fades to ~0 near every built carve surface (tracked as the min
//     signed distance over built carvers during the same sample loop: free).
//   - built rooms get a flat floor: rock is unioned back below
//     pos.y - radius*config.built.floorDrop, clipped to the room sphere.
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
    return { cx: n.pos.x, cy: n.pos.y, cz: n.pos.z, r, boundSq: bound * bound, built: n.style === 'built' };
  });

  // built room flat floors: rock unioned back below floorY, clipped to the room sphere
  const floors = graph.nodes
    .filter((n) => n.style === 'built')
    .map((n) => {
      const floorY = n.pos.y - n.radius * (config.built?.floorDrop ?? 0.45);
      const bound = n.radius + 4;
      return { cx: n.pos.x, cy: n.pos.y, cz: n.pos.z, r: n.radius, floorY, boundSq: bound * bound };
    });

  // ---------- edge polylines ----------
  // each: { cx,cy,cz (centroid), boundSq, radius, segments:[{ax,ay,az,bx,by,bz}] }
  const edgePolylines = [];
  const decorEdges = [];
  const arbY = new THREE.Vector3(0, 1, 0);
  const arbX = new THREE.Vector3(1, 0, 0);

  for (const edge of graph.edges) {
    const a = nodeById.get(edge.a);
    const b = nodeById.get(edge.b);
    if (!a || !b) continue;

    const built = edge.style === 'built';

    const dir = new THREE.Vector3().subVectors(b.pos, a.pos);
    const edgeLen = dir.length();
    if (edgeLen > 1e-6) dir.normalize(); else dir.set(1, 0, 0);

    const arbitrary = Math.abs(dir.y) < 0.9 ? arbY : arbX;
    const perp1 = new THREE.Vector3().crossVectors(dir, arbitrary);
    if (perp1.lengthSq() < 1e-9) perp1.set(1, 0, 0); else perp1.normalize();
    const perp2 = new THREE.Vector3().crossVectors(dir, perp1).normalize();

    // built corridors run near-straight; the locked (door) edge is dead straight so
    // the blocking disc at the straight-line midpoint sits inside the carve.
    let jitterMag = edgeLen * 0.22;
    if (edge.locked) jitterMag = 0;
    else if (built) jitterMag *= config.built?.jitterScale ?? 0.25;

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

    // keep the rng call unconditional so cave edges keep their shapes regardless of
    // how many edges happen to be built for a given seed
    const natRadius = randRange(rng, tunnelRadius[0], tunnelRadius[1]);
    const radius = built ? (config.built?.tunnelRadius ?? 4.4) : natRadius;

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

    // mouth flare: tunnels bell open near both rooms (radius * mouthFlare at the ends,
    // tapering to the base radius over mouthFlareSpan of the spline), so openings read
    // as openings instead of pinholes
    const flareMul = config.world.mouthFlare ?? 1.5;
    const flareSpan = config.world.mouthFlareSpan ?? 0.25;
    const maxR = radius * flareMul;

    const bound = maxExtent + maxR + BASE;
    const segments = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i], p1 = pts[i + 1];
      const tMid = (i + 0.5) / (pts.length - 1);
      const endT = Math.min(tMid, 1 - tMid);
      const flare = 1 + (flareMul - 1) * (1 - smoothstep(0, flareSpan, endT));
      segments.push({ ax: p0.x, ay: p0.y, az: p0.z, bx: p1.x, by: p1.y, bz: p1.z, r: radius * flare });
    }

    edgePolylines.push({ cx, cy, cz, boundSq: bound * bound, radius, maxR, segments, built });
    decorEdges.push({ a: edge.a, b: edge.b, style: edge.style || 'cave', radius, locked: !!edge.locked, polyline: pts });
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

  // Noise suppression band around built carve surfaces: zero within BUILT_FADE_IN
  // meters of the surface (and everywhere inside), full noise beyond BUILT_FADE_OUT.
  const BUILT_FADE_IN = 0.75;
  const BUILT_FADE_OUT = 3.5;

  function sample(x, y, z) {
    let d = BASE;
    let builtMin = BASE; // min signed distance over BUILT carvers only (free to track)

    for (let i = 0; i < spheres.length; i++) {
      const s = spheres[i];
      const dx = x - s.cx, dy = y - s.cy, dz = z - s.cz;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq > s.boundSq) continue;
      const dist = Math.sqrt(distSq);
      const sd = dist - s.r;
      if (sd < d) d = sd;
      if (s.built && sd < builtMin) builtMin = sd;
    }

    for (let i = 0; i < edgePolylines.length; i++) {
      const e = edgePolylines[i];
      const dx = x - e.cx, dy = y - e.cy, dz = z - e.cz;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq > e.boundSq) continue;
      const segs = e.segments;
      const eBuilt = e.built;
      for (let j = 0; j < segs.length; j++) {
        const seg = segs[j];
        const dist = capsuleDist(x, y, z, seg.ax, seg.ay, seg.az, seg.bx, seg.by, seg.bz);
        const sd = dist - seg.r; // per-segment radius carries the mouth flare
        if (sd < d) d = sd;
        if (eBuilt && sd < builtMin) builtMin = sd;
      }
    }

    let fade = noiseFadeAt(x, y, z);
    if (builtMin < BUILT_FADE_OUT) {
      const bf = smoothstep(BUILT_FADE_IN, BUILT_FADE_OUT, builtMin);
      if (bf < fade) fade = bf;
    }
    if (fade > 0) {
      d += fbm3(noise, x * noiseFreq, y * noiseFreq, z * noiseFreq) * noiseAmp * fade;
    }

    // built room flat floors: union rock back below floorY, clipped to the sphere.
    // Applied after noise so the floor plane stays perfectly flat.
    for (let i = 0; i < floors.length; i++) {
      const f = floors[i];
      if (y >= f.floorY + 4) continue;
      const dx = x - f.cx, dy = y - f.cy, dz = z - f.cz;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq > f.boundSq) continue;
      const dist = Math.sqrt(distSq);
      const hs = Math.min(f.floorY - y, f.r + 2 - dist);
      if (hs > d) d = hs;
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
        min.x = Math.min(min.x, p[0] - e.maxR); min.y = Math.min(min.y, p[1] - e.maxR); min.z = Math.min(min.z, p[2] - e.maxR);
        max.x = Math.max(max.x, p[0] + e.maxR); max.y = Math.max(max.y, p[1] + e.maxR); max.z = Math.max(max.z, p[2] + e.maxR);
      }
    }
  }
  const margin = noiseAmp + Math.max(tunnelRadius[1], 4) + 4;
  min.subScalar(margin);
  max.addScalar(margin);

  const decorRooms = graph.nodes.map((n) => ({
    id: n.id, pos: n.pos.clone(), radius: n.radius, style: n.style || 'cave', kind: n.kind,
  }));

  return {
    sample,
    collisionNormal,
    raycast,
    bounds: { min, max },
    decor: { edges: decorEdges, rooms: decorRooms, seed },
  };
}
