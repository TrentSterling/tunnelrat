// decor.js : industrial dressing for BUILT sections (see graph.js style pass).
// OG Descent mines are not just caves; constructed corridors get rib rings, glowing
// light strips and a hazard-striped frame at the security door; built rooms get wall
// panels, a ceiling light fixture and floor trim.
//
// CONTRACT:
//
// buildDecor(field, graph, config) -> THREE.Group  (name 'decorGroup')
//   field  : from createDensityField; reads field.decor (edges/rooms/seed), never
//            recomputes splines.
//   graph  : from generateLevelGraph (exitId + lockedEdge for strip colors).
//   config : CONFIG (config.built.* tunables, config.colors.*).
//
// Rendering rules (integration relies on these):
//   - All repeated units are InstancedMesh (one draw call per material), so the whole
//     group adds ~10 draw calls regardless of level size. frustumCulled=false on
//     instanced meshes (instance transforms live outside the unit geometry bounds).
//   - Materials + textures are MODULE-SCOPE SHARED across levels: main.js disposal
//     traverses caveGroup and disposes GEOMETRIES ONLY. Geometries are created fresh
//     per buildDecor call so that disposal is correct.
//   - Light strips are emissive-look MeshBasicMaterial (fake lights, fog still applies):
//     amber normal, cyan on edges touching the exit room, red on the locked-door edge.
//   - LIGHT BUDGET: at most one PointLight per built room, priority reactor > exit >
//     rest, hard cap config.built.maxLights (5). No lights in tunnels.
//   - Deterministic: seeded rng from field.decor.seed; no Math.random.
import * as THREE from 'three';
import { makeRng, randRange, randInt } from '../util/rng.js';
import { grungeTexture } from '../util/grungetex.js';

// ---------- module-scope shared textures + materials ----------

let _hazardTex = null;
function hazardTexture() {
  if (_hazardTex) return _hazardTex;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const stripe = ((x + y) >> 3) % 2 === 0;
      ctx.fillStyle = stripe ? '#e8b520' : '#16161c';
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(8, 1); // torus u runs around the ring; ~16 stripe alternations
  _hazardTex = tex;
  return tex;
}

let _mats = null;
function getMats(config) {
  if (_mats) return _mats;
  const c = config.colors;
  const grunge = grungeTexture();
  _mats = {
    rib: new THREE.MeshLambertMaterial({ color: c.ribMetal, map: grunge, flatShading: true }),
    panel: new THREE.MeshLambertMaterial({ color: c.panelMetal, map: grunge, flatShading: true }),
    trim: new THREE.MeshLambertMaterial({ color: c.trimMetal, map: grunge, flatShading: true }),
    fixture: new THREE.MeshLambertMaterial({ color: 0x2c333f, map: grunge, flatShading: true }),
    glow: new THREE.MeshBasicMaterial({ color: c.roomLight }),
    stripAmber: new THREE.MeshBasicMaterial({ color: c.stripAmber }),
    stripCyan: new THREE.MeshBasicMaterial({ color: c.stripCyan }),
    stripRed: new THREE.MeshBasicMaterial({ color: c.stripRed }),
    hazard: new THREE.MeshLambertMaterial({
      map: hazardTexture(), emissive: 0xffffff, emissiveMap: hazardTexture(),
      emissiveIntensity: 0.5, flatShading: true,
    }),
  };
  return _mats;
}

// ---------- scratch (build-time only, no hot path here) ----------

const _Z = new THREE.Vector3(0, 0, 1);
const _Y = new THREE.Vector3(0, 1, 0);
const _X = new THREE.Vector3(1, 0, 0);
const _segDir = new THREE.Vector3();
const _pt = new THREE.Vector3();
const _side = new THREE.Vector3();
const _upv = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _mtx = new THREE.Matrix4();

// call fn(point, unitDir) every `spacing` meters of polyline arclength
function walkPolyline(pts, spacing, fn) {
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    _segDir.subVectors(b, a);
    const len = _segDir.length();
    if (len < 1e-6) continue;
    _segDir.multiplyScalar(1 / len);
    let t = spacing - acc;
    while (t <= len) {
      _pt.copy(a).addScaledVector(_segDir, t);
      fn(_pt, _segDir);
      t += spacing;
    }
    acc = (acc + len) % spacing;
  }
}

function composeInto(list, pos, quat, sx, sy, sz) {
  _scale.set(sx, sy, sz);
  list.push(new THREE.Matrix4().compose(pos, quat, _scale));
}

function makeInstanced(geo, mat, matrices, name) {
  const mesh = new THREE.InstancedMesh(geo, mat, matrices.length);
  for (let i = 0; i < matrices.length; i++) mesh.setMatrixAt(i, matrices[i]);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false; // unit geometry bounds don't cover instance transforms
  mesh.name = name;
  return mesh;
}

// ---------- public API ----------

export function buildDecor(field, graph, config) {
  const group = new THREE.Group();
  group.name = 'decorGroup';
  const mats = getMats(config);
  const built = config.built || {};
  const rng = makeRng((field.decor.seed ^ 0xdec0) >>> 0);

  const roomById = new Map(field.decor.rooms.map((r) => [r.id, r]));
  const ribSpacing = built.ribSpacing ?? 4;
  const ribTube = built.ribTube ?? 0.42;
  const stripSize = built.stripSize ?? 0.3;
  const builtR = built.tunnelRadius ?? 4.4;

  const ribMatrices = [];
  const stripMatrices = { amber: [], cyan: [], red: [] };

  // ---------- built corridors: rib rings + light strips ----------
  for (const edge of field.decor.edges) {
    if (edge.style !== 'built') continue;
    const roomA = roomById.get(edge.a);
    const roomB = roomById.get(edge.b);
    if (!roomA || !roomB) continue;
    const clearA = roomA.radius + 1;
    const clearB = roomB.radius + 1;

    // rib rings every ~ribSpacing meters, skipping stretches inside the end rooms
    walkPolyline(edge.polyline, ribSpacing, (p, dir) => {
      if (p.distanceTo(roomA.pos) < clearA || p.distanceTo(roomB.pos) < clearB) return;
      _quat.setFromUnitVectors(_Z, dir);
      composeInto(ribMatrices, p, _quat, 1, 1, 1);
    });

    // light strips: one long box per polyline segment, shoulder height, alternating sides
    const colorKey = edge.locked ? 'red'
      : (edge.a === graph.exitId || edge.b === graph.exitId) ? 'cyan' : 'amber';
    const target = stripMatrices[colorKey];
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
      const sideSign = i % 2 === 0 ? 1 : -1;
      _pt.addScaledVector(_side, sideSign * edge.radius * 0.78);
      _pt.addScaledVector(_upv, edge.radius * 0.28);

      _quat.setFromUnitVectors(_Z, _segDir);
      composeInto(target, _pt, _quat, stripSize, stripSize, len * 0.96);
    }
  }

  // rib ring: low-seg torus reads as an octagonal bulkhead rib (built radius is one
  // constant, so a single geometry serves every corridor)
  if (ribMatrices.length > 0) {
    const ribGeo = new THREE.TorusGeometry(builtR * 0.92, ribTube, 4, 8);
    group.add(makeInstanced(ribGeo, mats.rib, ribMatrices, 'decor-ribs'));
  }
  const stripGeo = new THREE.BoxGeometry(1, 1, 1);
  if (stripMatrices.amber.length > 0) group.add(makeInstanced(stripGeo, mats.stripAmber, stripMatrices.amber, 'decor-strips-amber'));
  if (stripMatrices.cyan.length > 0) group.add(makeInstanced(stripGeo, mats.stripCyan, stripMatrices.cyan, 'decor-strips-cyan'));
  if (stripMatrices.red.length > 0) group.add(makeInstanced(stripGeo, mats.stripRed, stripMatrices.red, 'decor-strips-red'));

  // ---------- hazard-striped door frame at the locked edge midpoint ----------
  // Matches gamestate.js door disc placement exactly: straight-line midpoint of the
  // locked edge, normal along (a - b). The locked edge carve is dead straight
  // (density.js) so the frame sits inside the corridor.
  {
    const a = roomById.get(graph.lockedEdge.a);
    const b = roomById.get(graph.lockedEdge.b);
    if (a && b) {
      const frameGeo = new THREE.TorusGeometry(builtR * 1.0, 0.85, 4, 12);
      const frame = new THREE.Mesh(frameGeo, mats.hazard);
      frame.position.addVectors(a.pos, b.pos).multiplyScalar(0.5);
      _segDir.subVectors(a.pos, b.pos).normalize();
      frame.quaternion.setFromUnitVectors(_Z, _segDir);
      frame.name = 'decor-doorframe';
      frame.matrixAutoUpdate = false;
      frame.updateMatrix();
      group.add(frame);
    }
  }

  // ---------- built rooms: wall panels, ceiling fixture, floor trim, lights ----------
  const panelMatrices = [];
  const fixtureMatrices = [];
  const glowMatrices = [];
  const trimMatrices = [];
  const floorDrop = built.floorDrop ?? 0.45;
  const panelCount = built.panelCount ?? [4, 8];

  const builtRooms = field.decor.rooms.filter((r) => r.style === 'built');
  // light priority: reactor, then exit, then the rest (hard cap below)
  builtRooms.sort((r1, r2) => {
    const rank = (r) => (r.kind === 'reactor' ? 0 : r.kind === 'exit' ? 1 : 2);
    return rank(r1) - rank(r2);
  });

  const maxLights = built.maxLights ?? 5;
  let lightCount = 0;

  for (const room of builtRooms) {
    const r = room.radius;

    // wall panels: pushed into the wall band, facing the room center
    const n = randInt(rng, panelCount[0], panelCount[1]);
    for (let i = 0; i < n; i++) {
      const az = randRange(rng, 0, Math.PI * 2);
      const el = randRange(rng, -0.15, 0.6);
      _segDir.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
      _pt.copy(room.pos).addScaledVector(_segDir, r * 0.94);
      _quat.setFromUnitVectors(_Z, _segDir.negate());
      const w = 2.4 + r * 0.14;
      composeInto(panelMatrices, _pt, _quat, w, w * 0.66, 0.4);
    }

    // ceiling light fixture: housing + emissive under-plate
    _pt.copy(room.pos); _pt.y += r * 0.8;
    _quat.identity();
    composeInto(fixtureMatrices, _pt, _quat, 2.6, 0.5, 2.6);
    _pt.y -= 0.34;
    composeInto(glowMatrices, _pt, _quat, 2.0, 0.18, 2.0);

    // floor trim ring where the flat floor meets the sphere wall
    const drop = r * floorDrop;
    const ringR = Math.sqrt(Math.max(1, r * r - drop * drop)) * 0.94;
    _pt.set(room.pos.x, room.pos.y - drop + 0.18, room.pos.z);
    _quat.setFromUnitVectors(_Z, _Y);
    composeInto(trimMatrices, _pt, _quat, ringR, ringR, ringR);

    // one small real light per built room, budget-capped
    if (lightCount < maxLights) {
      const color = room.kind === 'reactor' ? config.colors.reactor
        : room.kind === 'exit' ? config.colors.stripCyan : config.colors.roomLight;
      const light = new THREE.PointLight(color, 160, r * 3.2, 2);
      light.position.copy(room.pos); light.position.y += r * 0.55;
      light.name = 'decor-roomlight';
      group.add(light);
      lightCount++;
    }
  }

  if (panelMatrices.length > 0) {
    group.add(makeInstanced(new THREE.BoxGeometry(1, 1, 1), mats.panel, panelMatrices, 'decor-panels'));
  }
  if (fixtureMatrices.length > 0) {
    group.add(makeInstanced(new THREE.BoxGeometry(1, 1, 1), mats.fixture, fixtureMatrices, 'decor-fixtures'));
    group.add(makeInstanced(new THREE.BoxGeometry(1, 1, 1), mats.glow, glowMatrices, 'decor-fixture-glow'));
  }
  if (trimMatrices.length > 0) {
    group.add(makeInstanced(new THREE.TorusGeometry(1, 0.05, 4, 16), mats.trim, trimMatrices, 'decor-floortrim'));
  }

  return group;
}
