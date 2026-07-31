// props.js : cave junk. Mining leftovers + biome formations scattered through SOME
// of the level; bare rooms and tunnels are intentional (seeded coverage rolls, see
// config.props). Everything is chunky flat-shaded low poly on the shared grunge
// texture, instanced wherever repeated.
//
// CONTRACT:
//
// buildProps(field, graph, config, biome, seed) -> THREE.Group  (name 'propsGroup')
//   field  : from createDensityField; reads field.decor (edges/rooms) and uses
//            field.sample / field.raycast / field.collisionNormal to plant props on
//            the ACTUAL carved surfaces. Never recomputes splines.
//   graph  : from generateLevelGraph (unused today beyond parity with decor.js; kept
//            in the signature so future mission-aware props need no rewire).
//   config : CONFIG (config.props coverage tunables).
//   biome  : from getBiome(depth) in config.js; drives prop colors + mix weights.
//   seed   : level seed; rng = makeRng(seed ^ 0x9c37). Deterministic, no Math.random.
//
// Prop vocabulary:
//   stal    : stalactite/stalagmite cone fields (long thin icicles in the ice biome)
//   crystal : emissive ore octahedra clusters (gold mine / cyan ice / orange magma)
//   crates  : crate + barrel stashes on floors (occasional stacked crate)
//   lamp    : standing mining lamp, post + emissive warm bulb; the first
//             config.props.maxPointLights lamps carry a REAL PointLight, rest fake
//   drill   : abandoned drill rig centerpiece (box body + cone drill + wheels),
//             capped at config.props.maxDrills per level
//   ember   : glowing ember-vein chains crawling along the floor (magma biome)
//   pipes   : wall pipe runs along built corridors (built edges only, never locked)
//
// Coverage (all seeded): ~props.roomClusterChance of plain cave rooms get ONE
// weighted cluster; ~tunnelFeatureChance of cave tunnels get 1-2 features;
// built rooms (except spawn/exit) get crates at builtCrateChance; built edges get
// pipes at builtPipeChance. Mission cave rooms (spawn/key/exit) stay clean.
//
// Rendering rules (same regime as decor.js):
//   - Repeated units are InstancedMesh, frustumCulled=false; the whole group costs
//     ~10 draw calls plus a handful of meshes per drill rig.
//   - Materials + textures are MODULE-SCOPE SHARED (biome-dependent ones cached per
//     biome name); geometries are created fresh per call, so main.js disposal
//     (geometries only) stays correct.
//   - Group lives inside caveGroup (levelbuilder adds it): automap hologram +
//     disposal pick it up automatically.
import * as THREE from 'three';
import { makeRng, randRange, randInt } from '../util/rng.js';
import { grungeTexture } from '../util/grungetex.js';

// ---------- module-scope shared materials ----------

let _shared = null;
function sharedMats() {
  if (_shared) return _shared;
  const grunge = grungeTexture();
  _shared = {
    metal: new THREE.MeshLambertMaterial({ color: 0x6a7280, map: grunge, flatShading: true }),
    crate: new THREE.MeshLambertMaterial({ color: 0x8a6a3a, map: grunge, flatShading: true }),
    barrel: new THREE.MeshLambertMaterial({ color: 0x3f6a52, map: grunge, flatShading: true }),
    tire: new THREE.MeshLambertMaterial({ color: 0x23262c, map: grunge, flatShading: true }),
    lampGlow: new THREE.MeshBasicMaterial({ color: 0xffc27a }),
  };
  return _shared;
}

const _biomeMats = new Map(); // biome.name -> { stone, crystal, ember }
function biomeMats(biome) {
  let m = _biomeMats.get(biome.name);
  if (!m) {
    const grunge = grungeTexture();
    m = {
      stone: new THREE.MeshLambertMaterial({ color: biome.stone, map: grunge, flatShading: true }),
      crystal: new THREE.MeshBasicMaterial({ color: biome.crystal }),
      ember: new THREE.MeshBasicMaterial({ color: biome.ember }),
    };
    _biomeMats.set(biome.name, m);
  }
  return m;
}

// ---------- scratch (build-time only) ----------

const _X = new THREE.Vector3(1, 0, 0);
const _Y = new THREE.Vector3(0, 1, 0);
const _Z = new THREE.Vector3(0, 0, 1);
const _origin = new THREE.Vector3();
const _hit = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _n = new THREE.Vector3();
const _segDir = new THREE.Vector3();
const _pt = new THREE.Vector3();
const _side = new THREE.Vector3();
const _upv = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _scale = new THREE.Vector3();

function composeInto(list, pos, quat, sx, sy, sz) {
  _scale.set(sx, sy, sz);
  list.push(new THREE.Matrix4().compose(pos, quat, _scale));
}

function makeInstanced(geo, mat, matrices, name) {
  const mesh = new THREE.InstancedMesh(geo, mat, matrices.length);
  for (let i = 0; i < matrices.length; i++) mesh.setMatrixAt(i, matrices[i]);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false; // instance transforms live outside the unit geometry bounds
  mesh.name = name;
  return mesh;
}

// entries: [key, weight][] with total weight > 0
function weightedPick(rng, entries) {
  let total = 0;
  for (let i = 0; i < entries.length; i++) total += entries[i][1];
  let t = rng() * total;
  for (let i = 0; i < entries.length; i++) {
    t -= entries[i][1];
    if (t <= 0) return entries[i][0];
  }
  return entries[entries.length - 1][0];
}

// ---------- public API ----------

export function buildProps(field, graph, config, biome, seed) {
  const group = new THREE.Group();
  group.name = 'propsGroup';
  const rng = makeRng((seed ^ 0x9c37) >>> 0);
  const pc = config.props || {};
  const mats = sharedMats();
  const bmats = biomeMats(biome);
  const icy = biome.name === 'ice';

  const maxLights = pc.maxPointLights ?? 3;
  const maxDrills = pc.maxDrills ?? 2;
  let lightCount = 0;
  let drillCount = 0;

  // fresh geometries per call (disposal in main.js disposes geometries only)
  const coneGeo = new THREE.ConeGeometry(1, 1, 6); coneGeo.translate(0, 0.5, 0);   // base at origin, tip +Y
  const boxGeo = new THREE.BoxGeometry(1, 1, 1); boxGeo.translate(0, 0.5, 0);      // base at origin
  const octaGeo = new THREE.OctahedronGeometry(1);
  const barrelGeo = new THREE.CylinderGeometry(0.5, 0.5, 1.3, 7); barrelGeo.translate(0, 0.65, 0);
  const pipeGeo = new THREE.CylinderGeometry(0.28, 0.28, 1, 6); pipeGeo.rotateX(Math.PI / 2);      // axis Z
  const pipeThinGeo = new THREE.CylinderGeometry(0.16, 0.16, 1, 6); pipeThinGeo.rotateX(Math.PI / 2);
  const wheelGeo = new THREE.CylinderGeometry(0.65, 0.65, 0.5, 7); wheelGeo.rotateZ(Math.PI / 2);  // axis X

  const lists = {
    stal: [], crystal: [], crate: [], barrel: [],
    post: [], bulb: [], pipe: [], pipeThin: [], ember: [],
  };

  // ---------- placement helpers (closures over field/rng/lists) ----------

  function airOk(p) {
    return field.sample(p.x, p.y, p.z) < -0.5;
  }

  // raycast from _origin along (dx,dy,dz); fills _hit with the surface point.
  // Rejects immediate hits (origin hugging or inside rock).
  function surfaceFrom(dx, dy, dz, maxDist) {
    _dir.set(dx, dy, dz).normalize();
    const t = field.raycast(_origin, _dir, maxDist, 0.4);
    if (t < 1.0) return false;
    _hit.copy(_origin).addScaledVector(_dir, t);
    return true;
  }

  // sign +1: floor cones pointing up; -1: ceiling cones hanging down
  function plantCones(center, spread, maxDist, count, sign, iciclesLook) {
    for (let i = 0; i < count; i++) {
      _origin.copy(center);
      _origin.x += randRange(rng, -spread, spread);
      _origin.z += randRange(rng, -spread, spread);
      if (!airOk(_origin)) continue;
      if (!surfaceFrom(0, -sign, 0, maxDist)) continue;
      const h = iciclesLook ? randRange(rng, 1.6, 4.8) : randRange(rng, 1.1, 3.4);
      const r = iciclesLook ? h * randRange(rng, 0.09, 0.16) : h * randRange(rng, 0.24, 0.42);
      if (sign > 0) _q.identity();
      else _q.setFromAxisAngle(_X, Math.PI); // flip tip downward
      composeInto(lists.stal, _hit, _q, r, h, r);
    }
  }

  function stalCluster(center, spread, maxDist) {
    plantCones(center, spread, maxDist, randInt(rng, 2, icy ? 7 : 5), -1, icy);
    if (!icy || rng() < 0.5) plantCones(center, spread, maxDist, randInt(rng, 1, 4), 1, false);
  }

  // ore octahedra hugging the actual wall (one jittered raycast per crystal)
  function crystalCluster(center, maxDist) {
    if (!airOk(center)) return;
    _n.set(randRange(rng, -1, 1), randRange(rng, -1, 1), randRange(rng, -1, 1));
    if (_n.lengthSq() < 1e-4) _n.set(0, -1, 0);
    _n.normalize();
    const bx = _n.x, by = _n.y, bz = _n.z;
    const count = randInt(rng, 4, 8);
    for (let i = 0; i < count; i++) {
      _origin.copy(center);
      if (!surfaceFrom(
        bx + randRange(rng, -0.35, 0.35),
        by + randRange(rng, -0.35, 0.35),
        bz + randRange(rng, -0.35, 0.35),
        maxDist,
      )) continue;
      field.collisionNormal(_hit.x, _hit.y, _hit.z, _n);
      _q.setFromUnitVectors(_Y, _n);
      _q2.setFromAxisAngle(_Y, randRange(rng, 0, Math.PI * 2));
      _q.multiply(_q2);
      const s = randRange(rng, 0.35, 1.1);
      composeInto(lists.crystal, _hit, _q, s * 0.55, s * 1.2, s * 0.55);
    }
  }

  function crateCluster(center, spread, maxDist) {
    const count = randInt(rng, 2, 5);
    for (let i = 0; i < count; i++) {
      _origin.copy(center);
      _origin.x += randRange(rng, -spread, spread);
      _origin.z += randRange(rng, -spread, spread);
      if (!airOk(_origin)) continue;
      if (!surfaceFrom(0, -1, 0, maxDist)) continue;
      const s = randRange(rng, 1.1, 2.0);
      _hit.y -= 0.1 + s * 0.15; // settle into the rough/sloped floor (bigger crate sinks more)
      _q.setFromAxisAngle(_Y, randRange(rng, 0, Math.PI * 2));
      composeInto(lists.crate, _hit, _q, s, s * randRange(rng, 0.8, 1.05), s);
      if (rng() < 0.3) { // stacked smaller crate
        _hit.y += s * 0.82;
        _q.setFromAxisAngle(_Y, randRange(rng, 0, Math.PI * 2));
        const s2 = s * randRange(rng, 0.55, 0.8);
        composeInto(lists.crate, _hit, _q, s2, s2, s2);
      }
    }
    const barrels = randInt(rng, 0, 2);
    for (let i = 0; i < barrels; i++) {
      _origin.copy(center);
      _origin.x += randRange(rng, -spread, spread);
      _origin.z += randRange(rng, -spread, spread);
      if (!airOk(_origin)) continue;
      if (!surfaceFrom(0, -1, 0, maxDist)) continue;
      _hit.y -= 0.05;
      const s = randRange(rng, 0.8, 1.2);
      _q.setFromAxisAngle(_Y, randRange(rng, 0, Math.PI * 2));
      composeInto(lists.barrel, _hit, _q, s, s, s);
    }
  }

  function miningLamp(center, spread, maxDist) {
    _origin.copy(center);
    _origin.x += randRange(rng, -spread, spread);
    _origin.z += randRange(rng, -spread, spread);
    if (!airOk(_origin)) return;
    if (!surfaceFrom(0, -1, 0, maxDist)) return;
    _q.setFromAxisAngle(_Y, randRange(rng, 0, Math.PI * 2));
    composeInto(lists.post, _hit, _q, 0.16, 2.3, 0.16);
    _hit.y += 2.3;
    composeInto(lists.bulb, _hit, _q, 0.44, 0.36, 0.44);
    if (lightCount < maxLights) {
      const light = new THREE.PointLight(0xffc27a, 110, 22, 2);
      light.position.copy(_hit);
      light.position.y += 0.2;
      light.name = 'prop-lamplight';
      group.add(light);
      lightCount++;
    }
  }

  // glowing chain crawling along the floor (magma signature prop)
  function emberVein(center, spread, maxDist) {
    _origin.copy(center);
    _origin.x += randRange(rng, -spread, spread);
    _origin.z += randRange(rng, -spread, spread);
    if (!airOk(_origin)) return;
    if (!surfaceFrom(0, -1, 0, maxDist)) return;
    const steps = randInt(rng, 4, 9);
    const az = randRange(rng, 0, Math.PI * 2);
    const sx = Math.cos(az), sz = Math.sin(az);
    let px = _hit.x, py = _hit.y, pz = _hit.z;
    for (let i = 0; i < steps; i++) {
      _q.setFromAxisAngle(_Y, az + randRange(rng, -0.5, 0.5));
      _pt.set(px, py - 0.06, pz);
      composeInto(lists.ember, _pt, _q, randRange(rng, 0.5, 0.9), 0.16, randRange(rng, 0.25, 0.45));
      _origin.set(px + sx * 0.9, py + 1.6, pz + sz * 0.9);
      if (!airOk(_origin)) break;
      if (!surfaceFrom(0, -1, 0, 6)) break;
      px = _hit.x; py = _hit.y; pz = _hit.z;
    }
  }

  // abandoned drill rig centerpiece: wheels + body + cab + forward cone drill
  function drillRig(center, maxDist) {
    _origin.copy(center);
    if (!airOk(_origin)) return false;
    if (!surfaceFrom(0, -1, 0, maxDist)) return false;
    const rig = new THREE.Group();
    rig.name = 'prop-drillrig';
    rig.position.copy(_hit);
    rig.rotation.y = randRange(rng, 0, Math.PI * 2);
    for (const [wx, wz] of [[-1.25, -0.95], [1.25, -0.95], [-1.25, 0.95], [1.25, 0.95]]) {
      const w = new THREE.Mesh(wheelGeo, mats.tire);
      w.position.set(wx, 0.6, wz);
      rig.add(w);
    }
    const body = new THREE.Mesh(boxGeo, mats.metal);
    body.position.y = 0.85;
    body.scale.set(3.4, 1.7, 2.1);
    rig.add(body);
    const cab = new THREE.Mesh(boxGeo, mats.metal);
    cab.position.set(-0.9, 2.5, 0);
    cab.scale.set(1.4, 1.1, 1.9);
    rig.add(cab);
    const drill = new THREE.Mesh(coneGeo, mats.metal);
    drill.position.set(1.7, 1.5, 0);
    drill.rotation.z = -Math.PI / 2; // tip points forward (+X of the rig)
    drill.scale.set(0.9, 2.4, 0.9);
    rig.add(drill);
    group.add(rig);
    return true;
  }

  // ---------- coverage rolls ----------

  const rooms = field.decor.rooms;
  const edges = field.decor.edges;
  const roomById = new Map(rooms.map((r) => [r.id, r]));

  const w = biome.weights || { stal: 3, crystal: 2, crates: 2, lamp: 1.5, drill: 1, ember: 0 };
  const entriesFor = (keys) => keys.filter((k) => (w[k] || 0) > 0).map((k) => [k, w[k]]);
  const roomEntries = entriesFor(['stal', 'crystal', 'crates', 'lamp', 'drill', 'ember']);
  const tunnelEntries = entriesFor(['stal', 'crystal', 'lamp', 'ember']);

  // rooms: one weighted cluster on ~roomClusterChance of PLAIN cave rooms;
  // built rooms (not spawn/exit) get crates only; everything else stays bare.
  for (const room of rooms) {
    const maxDist = room.radius * 3 + 12;
    const spread = room.radius * 0.55;
    if (room.style === 'built') {
      if (room.kind !== 'spawn' && room.kind !== 'exit' && rng() < (pc.builtCrateChance ?? 0.6)) {
        crateCluster(room.pos, room.radius * 0.5, maxDist);
      }
      continue;
    }
    if (room.kind !== 'room') continue;                        // mission cave rooms stay clean
    if (rng() >= (pc.roomClusterChance ?? 0.4)) continue;      // bare on purpose
    if (roomEntries.length === 0) continue;
    let type = weightedPick(rng, roomEntries);
    if (type === 'drill' && drillCount >= maxDrills) type = 'crates';
    switch (type) {
      case 'stal':
        stalCluster(room.pos, spread, maxDist);
        break;
      case 'crystal':
        crystalCluster(room.pos, room.radius * 2 + 8);
        if (rng() < 0.5) crystalCluster(room.pos, room.radius * 2 + 8);
        break;
      case 'crates':
        crateCluster(room.pos, spread, maxDist);
        break;
      case 'lamp':
        miningLamp(room.pos, spread * 0.6, maxDist);
        crateCluster(room.pos, spread, maxDist);
        break;
      case 'drill':
        if (drillRig(room.pos, maxDist)) {
          drillCount++;
          miningLamp(room.pos, spread, maxDist);
        }
        break;
      case 'ember': {
        const veins = randInt(rng, 2, 3);
        for (let i = 0; i < veins; i++) emberVein(room.pos, spread, maxDist);
        if (rng() < 0.4) crystalCluster(room.pos, room.radius * 2 + 8);
        break;
      }
    }
  }

  // tunnels: cave edges roll 1-2 features at ~tunnelFeatureChance; built edges roll
  // wall pipe runs; the locked (door) corridor always stays clean.
  for (const edge of edges) {
    if (edge.locked) continue;
    const roomA = roomById.get(edge.a);
    const roomB = roomById.get(edge.b);
    if (edge.style === 'built') {
      if (roomA && roomB && rng() < (pc.builtPipeChance ?? 0.55)) pipeRun(edge, roomA, roomB);
      continue;
    }
    if (rng() >= (pc.tunnelFeatureChance ?? 0.3)) continue;    // bare on purpose
    if (tunnelEntries.length === 0) continue;
    const features = randInt(rng, 1, 2);
    const pts = edge.polyline;
    for (let i = 0; i < features; i++) {
      const idx = Math.max(1, Math.min(pts.length - 2, Math.floor(randRange(rng, 0.2, 0.8) * pts.length)));
      const p = pts[idx];
      const spread = Math.max(1.5, edge.radius * 0.5);
      const maxDist = edge.radius * 3 + 8;
      switch (weightedPick(rng, tunnelEntries)) {
        case 'stal': stalCluster(p, spread, maxDist); break;
        case 'crystal': crystalCluster(p, maxDist); break;
        case 'lamp': miningLamp(p, spread, maxDist); break;
        case 'ember': emberVein(p, spread, maxDist); break;
      }
    }
  }

  // pipe runs: one (sometimes twin) pipe hugging a built corridor wall, same
  // polyline-walk + room-clearance regime as decor.js light strips
  function pipeRun(edge, roomA, roomB) {
    const clearA = roomA.radius + 1;
    const clearB = roomB.radius + 1;
    const sideSign = rng() < 0.5 ? 1 : -1;
    const twin = rng() < 0.6;
    const pts = edge.polyline;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      _segDir.subVectors(b, a);
      const len = _segDir.length();
      if (len < 1e-6) continue;
      _segDir.multiplyScalar(1 / len);
      _pt.lerpVectors(a, b, 0.5);
      if (_pt.distanceTo(roomA.pos) < clearA || _pt.distanceTo(roomB.pos) < clearB) continue;
      const upRef = Math.abs(_segDir.y) > 0.95 ? _X : _Y;
      _side.crossVectors(_segDir, upRef).normalize();
      _upv.crossVectors(_side, _segDir).normalize();
      _pt.addScaledVector(_side, sideSign * edge.radius * 0.82);
      _pt.addScaledVector(_upv, -edge.radius * 0.18);
      _q.setFromUnitVectors(_Z, _segDir);
      composeInto(lists.pipe, _pt, _q, 1, 1, len * 1.02);
      if (twin) {
        _pt.addScaledVector(_upv, 0.62);
        composeInto(lists.pipeThin, _pt, _q, 1, 1, len * 1.02);
      }
    }
  }

  // ---------- instanced mesh emission ----------

  if (lists.stal.length > 0) group.add(makeInstanced(coneGeo, bmats.stone, lists.stal, 'props-stal'));
  if (lists.crystal.length > 0) group.add(makeInstanced(octaGeo, bmats.crystal, lists.crystal, 'props-crystals'));
  if (lists.crate.length > 0) group.add(makeInstanced(boxGeo, mats.crate, lists.crate, 'props-crates'));
  if (lists.barrel.length > 0) group.add(makeInstanced(barrelGeo, mats.barrel, lists.barrel, 'props-barrels'));
  if (lists.post.length > 0) group.add(makeInstanced(boxGeo, mats.metal, lists.post, 'props-lampposts'));
  if (lists.bulb.length > 0) group.add(makeInstanced(boxGeo, mats.lampGlow, lists.bulb, 'props-lampbulbs'));
  if (lists.pipe.length > 0) group.add(makeInstanced(pipeGeo, mats.metal, lists.pipe, 'props-pipes'));
  if (lists.pipeThin.length > 0) group.add(makeInstanced(pipeThinGeo, mats.metal, lists.pipeThin, 'props-pipes-thin'));
  if (lists.ember.length > 0) group.add(makeInstanced(boxGeo, bmats.ember, lists.ember, 'props-embers'));

  return group;
}
