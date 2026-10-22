// Original pressure-frame dimensions in metres. Pure data shared by collision,
// renderer and fixtures; no DOM or random draws that could perturb generation.
import * as THREE from 'three';

export const SECTORS = 12;
export const FRAME_SECTION = [
  [0, -1.1], [.42, -1.1], [.48, -.98], [.9, -.98],
  [.96, -1.1], [1.05, -1.1], [1.45, -.8], [1.45, .8],
  [1.05, 1.1], [.96, 1.1], [.9, .98], [.48, .98], [.42, 1.1], [0, 1.1],
];
const normals = Array.from({ length: SECTORS }, (_, i) => [Math.cos(i * Math.PI / 6), Math.sin(i * Math.PI / 6)]);
const Z = new THREE.Vector3(0, 0, 1);
function apothem(x, y) {
  let r = -Infinity;
  for (const [nx, ny] of normals) r = Math.max(r, x * nx + y * ny);
  return r;
}

export function frameSpec(kind, position, normal, inner, edge) {
  const quaternion = new THREE.Quaternion().setFromUnitVectors(Z, normal);
  return { kind, position: position.clone(), normal: normal.clone(), quaternion, inner, edge,
    right: new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion),
    up: new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion),
    recessRadius: (inner + 1.45) / Math.cos(Math.PI / 12) + .3 };
}

export function planArchitecture(graph, decor, config) {
  const rooms = new Map(graph.nodes.map(n => [n.id, n]));
  const a = rooms.get(graph.lockedEdge.a), b = rooms.get(graph.lockedEdge.b);
  const gate = frameSpec('gate', a.pos.clone().add(b.pos).multiplyScalar(.5),
    a.pos.clone().sub(b.pos).normalize(), config.built.tunnelRadius, graph.lockedEdge);
  const result = [gate];
  const edges = decor.edges.filter(e => e.style === 'built' && !e.locked).sort((a, b) =>
    Number(b.a === graph.spawnId || b.b === graph.spawnId) - Number(a.a === graph.spawnId || a.b === graph.spawnId));
  for (const edge of edges) {
    for (const id of [edge.a, edge.b]) {
      if (result.length >= 7) break;
      const room = rooms.get(id), pts = id === edge.a ? edge.polyline : [...edge.polyline].reverse();
      // The opening contains even the original maximum mouth flare, not just the
      // nominal corridor radius. No metal narrows that existing circular carve.
      const inner = edge.radius * (config.world.mouthFlare ?? 1.5);
      for (let i = 1; i < pts.length; i++) {
        if (pts[i].distanceTo(room.pos) < room.radius + 2.5) continue;
        const p = pts[i].clone(), normal = pts[i - 1].clone().sub(p).normalize();
        const spec = frameSpec('entry', p, normal, inner, { a: edge.a, b: edge.b });
        // Reject intersections with room volumes, another assembly, or unrelated
        // corridor centerlines. The unmodified graph remains the navigation graph.
        const occupied = result.some(s => s.position.distanceTo(p) < s.recessRadius + spec.recessRadius + 2)
          || graph.nodes.some(n => n.id !== id && n.pos.distanceTo(p) < n.radius + spec.recessRadius)
          || decor.edges.some(e => e !== edge && e.polyline.some(q => q.distanceTo(p) < spec.recessRadius + e.radius + 2));
        if (!occupied) result.push(spec);
        break;
      }
    }
  }
  return result;
}

export function frameLocal(spec, x, y, z, out) {
  const dx = x - spec.position.x, dy = y - spec.position.y, dz = z - spec.position.z;
  out[0] = dx * spec.right.x + dy * spec.right.y + dz * spec.right.z;
  out[1] = dx * spec.up.x + dy * spec.up.y + dz * spec.up.z;
  out[2] = dx * spec.normal.x + dy * spec.normal.y + dz * spec.normal.z;
  return out;
}

// Positive inside the authored annular section. Apothem coordinates preserve the
// exact twelve flat inner walls. Distance is conservative at polygon corners.
export function frameSolid(x, y, z, inner, includeHardware = true) {
  const r = apothem(x, y) - inner;
  let inside = false, distSq = Infinity;
  for (let i = 0, j = FRAME_SECTION.length - 1; i < FRAME_SECTION.length; j = i++) {
    const [ax, az] = FRAME_SECTION[j], [bx, bz] = FRAME_SECTION[i];
    const dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((r - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    distSq = Math.min(distSq, (r - ax - t * dx) ** 2 + (z - az - t * dz) ** 2);
    if ((az > z) !== (bz > z) && r < (bx - ax) * (z - az) / (bz - az) + ax) inside = !inside;
  }
  let solid = Math.sqrt(distSq) * (inside ? 1 : -1);
  // Match the shallow gasket and emitter pockets as well as the structural
  // section. Their outside faces never extend beyond the flange's +/-1.1 m.
  const box = (a, b, c) => -(Math.hypot(Math.max(a, 0), Math.max(b, 0), Math.max(c, 0)) + Math.min(Math.max(a, b, c), 0));
  if (includeHardware && Math.abs(z) > .9 && r > .4 && r < 1) {
    solid = Math.max(solid, box(Math.abs(r - .69) - .16, Math.abs(Math.abs(z) - .9975) - .0175, -1));
    for (let i = 0; i < SECTORS; i += 2) {
      const [nx, ny] = normals[i], radial = x * nx + y * ny - inner - .7, tangent = -x * ny + y * nx;
      solid = Math.max(solid, box(Math.abs(radial) - .125, Math.abs(tangent) - .325, Math.abs(Math.abs(z) - 1.025) - .035),
        box(Math.abs(radial) - .06, Math.abs(tangent) - .23, Math.abs(Math.abs(z) - 1.065) - .0125));
    }
  }
  return solid;
}

export function addArchitectureField(base, graph, config) {
  const architecture = planArchitecture(graph, base.decor, config);
  const local = [0, 0, 0];
  function near(s, x, y, z) {
    return Math.abs(x - s.position.x) < s.recessRadius + 5
      && Math.abs(y - s.position.y) < s.recessRadius + 5
      && Math.abs(z - s.position.z) < s.recessRadius + 5;
  }
  function rockSample(x, y, z) {
    let d = base.sample(x, y, z);
    for (const s of architecture) {
      if (!near(s, x, y, z)) continue;
      frameLocal(s, x, y, z, local);
      // The bell opens gradually over 8 m on either side. An abrupt shallow pocket
      // hid the flange behind the original rock from normal approach sightlines.
      // Normalizing the cone slope keeps this an approximate distance in metres.
      // Twelve broad shoulders embed 3 cm into the rock socket: the frame has a
      // continuous mounting interface rather than floating inside a round pocket.
      const socket = s.inner + 1.42, slope = (socket - config.built.tunnelRadius) / 6.5;
      const radius = socket - slope * Math.max(0, Math.abs(local[2]) - 1.5);
      const a = (apothem(local[0], local[1]) - radius) / Math.hypot(1, slope), b = Math.abs(local[2]) - 8;
      const recess = Math.hypot(Math.max(a, 0), Math.max(b, 0)) + Math.min(Math.max(a, b), 0);
      d = Math.min(d, recess);
    }
    return d;
  }
  function sample(x, y, z) {
    let d = rockSample(x, y, z);
    for (const s of architecture) {
      if (!near(s, x, y, z)) continue;
      frameLocal(s, x, y, z, local);
      d = Math.max(d, frameSolid(...local, s.inner));
    }
    return d;
  }
  function collisionNormal(x, y, z, out) {
    if (!architecture.some(s => near(s, x, y, z))) return base.collisionNormal(x, y, z, out);
    const e = .03;
    out.set(sample(x - e, y, z) - sample(x + e, y, z), sample(x, y - e, z) - sample(x, y + e, z), sample(x, y, z - e) - sample(x, y, z + e));
    return out.lengthSq() > 1e-12 ? out.normalize() : base.collisionNormal(x, y, z, out);
  }
  function raycast(origin, dir, maxDist, step = .8) {
    for (let t = 0; t <= maxDist; t += step) if (sample(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t) >= 0) return t;
    return -1;
  }
  function rockNormal(x, y, z, out) {
    const e = .5;
    return out.set(rockSample(x - e, y, z) - rockSample(x + e, y, z),
      rockSample(x, y - e, z) - rockSample(x, y + e, z), rockSample(x, y, z - e) - rockSample(x, y, z + e)).normalize();
  }
  return { ...base, sample, collisionNormal, raycast, architecture,
    renderField: { sample: rockSample, collisionNormal: rockNormal } };
}

