import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as THREE from 'three';
import { CONFIG } from '../src/config.js';
import { generateLevelGraph } from '../src/procgen/graph.js';
import { createDensityField } from '../src/procgen/density.js';
import { frameSolid } from '../src/procgen/architecture-layout.js';
import { frameGeometries, buildSecurityFrame, buildEntryFrames } from '../src/architecture-model.js';
import { Ship } from '../src/ship.js';
import { GameState } from '../src/gamestate.js';
import { buildPlayerShip } from '../src/ship-model.js';
globalThis.document = { createElement: () => ({ getContext: () => ({ fillRect() {} }) }) };
// Read the immutable deployed baseline from Git, so review needs no sibling clone.
const baseline = execFileSync('git', ['show', 'dc6fcec4785f121bb88761b3dac368b2b11754d2:src/procgen/density.js'], { encoding: 'utf8' })
  .replaceAll("'../util/rng.js'", JSON.stringify(new URL('../src/util/rng.js', import.meta.url).href))
  .replaceAll("'../util/noise.js'", JSON.stringify(new URL('../src/util/noise.js', import.meta.url).href));
const { createDensityField: originalField } = await import('data:text/javascript;base64,' + Buffer.from(baseline).toString('base64'));
let checks = 0; const check = (v, m) => { assert(v, m); checks++; };
const report = { meshes: [], seeds: [], traversal: [] };
const p = new THREE.Vector3(), a = p.clone(), b = p.clone(), c = p.clone(), n = p.clone();
for (const inner of [5.2, 7.8]) {
  let triangles = 0;
  const geometries = frameGeometries(inner, true);
  for (const [name, geometry] of Object.entries(geometries)) {
    const pos = geometry.attributes.position, norm = geometry.attributes.normal; let volume = 0;
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i); n.fromBufferAttribute(norm, i);
      check(p.toArray().every(Number.isFinite), 'finite geometry');
      check(Math.abs(n.length() - 1) < 1e-5, 'unit normals');
      check(Math.abs(p.z) <= 1.100001, 'hardware within axial collision envelope');
      check(frameSolid(...p.toArray(), inner) >= -1e-5, 'every physical vertex covered by matching collision');
    }
    for (let i = 0; i < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
      volume += a.dot(b.clone().cross(c)) / 6;
      const face = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
      n.fromBufferAttribute(norm, i); check(face.dot(n) > (name === 'liner-and-fasteners' ? .85 : .999), 'stored normal agrees with winding');
      if (name === 'load-bearing-shell') {
        const center = a.clone().add(b).add(c).multiplyScalar(1 / 3);
        const inside = center.clone().addScaledVector(face, -.01);
        const outside = center.clone().addScaledVector(face, .01);
        // Body's concealed inner wall joins the separate 4 cm liner.
        if (Math.hypot(center.x, center.y) > inner + .1)
          check(frameSolid(...inside.toArray(), inner, false) > frameSolid(...outside.toArray(), inner, false), 'outward section face');
      }
    }
    check(volume > 0, 'positive signed shell volume'); triangles += pos.count / 3;
    report.meshes.push({ inner, name, triangles: pos.count / 3, volume });
  }
  check(triangles === 1680, '1680 triangles including modeled fastener seats');
  // FrontSide ray tests against each outer and inner planar side, plus both faces.
  const mesh = new THREE.Mesh(geometries['load-bearing-shell'], new THREE.MeshBasicMaterial());
  mesh.updateMatrixWorld(true);
  for (let i = 0; i < 12; i++) {
    const dir = new THREE.Vector3(Math.cos(i * Math.PI / 6), Math.sin(i * Math.PI / 6), 0);
    const ray = new THREE.Raycaster(dir.clone().multiplyScalar(inner + 3), dir.clone().negate());
    const hits = ray.intersectObject(mesh); check(hits.length > 0 && Math.abs(hits[0].distance - 1.55) < 1e-4, 'outer face FrontSide ray');
    const innerHits = new THREE.Raycaster(new THREE.Vector3(), dir).intersectObject(mesh);
    check(innerHits.length > 0 && Math.abs(innerHits[0].distance - inner - .04) < 1e-4, 'inner face FrontSide ray');
  }
  for (const side of [-1, 1]) {
    const hits = new THREE.Raycaster(new THREE.Vector3(inner + .2, 0, side * 3), new THREE.Vector3(0, 0, -side)).intersectObject(mesh);
    check(hits.length > 0 && Math.abs(hits[0].distance - 2) < 1e-4, 'front and rear recessed seat rays');
    const heads = new THREE.Mesh(geometries['liner-and-fasteners'], new THREE.MeshBasicMaterial()); heads.updateMatrixWorld(true);
    const caps = new THREE.Raycaster(new THREE.Vector3(inner + .23, 0, side * 3), new THREE.Vector3(0, 0, -side)).intersectObject(heads);
    check(caps.length > 0 && Math.abs(caps[0].distance - 1.93) < 1e-4, 'head cap has 7 cm seat depth and 3 cm flange separation');
    heads.material.dispose();
  }
  Object.values(geometries).forEach(g => g.dispose()); mesh.material.dispose();
}
const airframe = buildPlayerShip().group, vertices = [];
airframe.updateMatrixWorld(true);
airframe.traverse(o => { if (o.geometry) { const a = o.geometry.attributes.position;
  for (let i = 0; i < a.count; i++) vertices.push(new THREE.Vector3().fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld));
} });
let minimumTransformedGap = Infinity;
for (let side = 0; side < 12; side++) for (const roll of [0, Math.PI / 2, Math.PI]) {
  const angle = side * Math.PI / 6, center = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0).multiplyScalar(5.2 - CONFIG.ship.radius);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(.4, -.35, roll));
  for (const vertex of vertices) {
    p.copy(vertex).applyQuaternion(q).add(center);
    const gap = -frameSolid(...p.toArray(), 5.2); minimumTransformedGap = Math.min(minimumTransformedGap, gap);
    check(gap > 0, 'real transformed ship stays outside frame at sphere contact');
  }
}
report.minimumTransformedGap = minimumTransformedGap;
airframe.traverse(o => o.geometry?.dispose());
const input = { axis: { x: 0, y: 0, z: 1, roll: 0 }, boost: false, mouseDX: 0, mouseDY: 0 };
for (const seed of [1337, 1338, 1339, ...Array.from({ length: 200 }, (_, i) => i + 1)]) {
  const graph = generateLevelGraph(seed, CONFIG), before = originalField(graph, seed, CONFIG);
  const started = performance.now(), field = createDensityField(graph, seed, CONFIG);
  const constructionMs = performance.now() - started;
  const repeated = createDensityField(graph, seed, CONFIG);
  check(JSON.stringify(field.architecture) === JSON.stringify(repeated.architecture), 'deterministic layout');
  check(field.architecture.length <= 7, 'bounded assembly count');
  check(field.architecture.some(s => s.kind === 'gate'), `modeled gate retained in swept seed ${seed}`);
  let minCenter = Infinity, maxLostClearance = 0;
  for (const e of field.decor.edges) for (let i = 1; i < e.polyline.length; i++) for (let t = 0; t <= 1; t += .125) {
    p.lerpVectors(e.polyline[i - 1], e.polyline[i], t);
    const previous = -before.sample(...p.toArray()), current = -field.sample(...p.toArray());
    minCenter = Math.min(minCenter, current);
    maxLostClearance = Math.max(maxLostClearance, Math.min(previous, CONFIG.ship.radius) - current);
    check(current >= Math.min(previous, CONFIG.ship.radius) - .001, `graph connectivity seed ${seed}`);
  }
  report.seeds.push({ seed, entries: field.architecture.length - 1, minCenter, maxLostClearance, constructionMs });
  if (![1337, 1338, 1339].includes(seed)) continue;
  for (const spec of field.architecture) {
    const assembled = spec.kind === 'gate' ? buildSecurityFrame(spec) : buildEntryFrames([spec]);
    assembled.traverse(o => { if (o.material) check(o.material.side === THREE.FrontSide, 'all structural surfaces FrontSide'); });
    if (spec.kind === 'gate') {
      for (const t of [0, .25, .5, .75, 1]) { assembled.userData.setOpenFraction(t); check(assembled.userData.openFraction === t, 'normalized gate pose'); }
      assembled.userData.dispose();
    } else assembled.traverse(o => o.geometry?.dispose());
    for (const sign of [-1, 1]) for (const roll of [0, Math.PI / 2, Math.PI]) for (const offset of [0, 2.5]) {
      const ship = new Ship(CONFIG); ship.field = field;
      ship.object3d.position.copy(spec.position).addScaledVector(spec.normal, sign * 4).addScaledVector(spec.right, offset);
      ship.object3d.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), spec.normal.clone().multiplyScalar(-sign));
      ship.object3d.rotateZ(roll); ship.velocity.copy(spec.normal).multiplyScalar(-sign * 6);
      let minimum = Infinity;
      for (let i = 0; i < 85; i++) { ship.update(1 / 60, input); minimum = Math.min(minimum, -field.sample(...ship.object3d.position.toArray())); }
      const along = ship.object3d.position.clone().sub(spec.position).dot(spec.normal) * sign;
      check(along < -3, `actual Ship traverses ${seed}/${spec.kind} roll ${roll} offset ${offset}: ${along}`);
      check(minimum >= CONFIG.ship.radius - .01, 'sphere remains clear throughout crossing');
      report.traversal.push({ seed, kind: spec.kind, sign, roll, offset, along, minimum });
    }
  }
  const scene = new THREE.Scene(), state = new GameState(scene, CONFIG); state.startLevel(graph, field, 1);
  const ship = new Ship(CONFIG); ship.field = field;
  ship.object3d.position.copy(state.doorPos).addScaledVector(state.doorNormal, .4);
  check(state.update(1 / 60, ship).includes('doorBlocked'), 'locked approach blocks');
  state.hasKey = true; check(state.update(1 / 60, ship).includes('doorOpen'), 'key immediately unlocks');
  const assembly = state.doorAssembly;
  for (let i = 0; i < 61; i++) state.update(1 / 60, ship);
  check(state.doorMesh === null && state.doorAssembly === assembly, 'energy fades; physical frame stays');
  check(assembly.userData.openFraction === 1, 'fully open indicator');
  state.clearProps(); check(scene.children.length === 0, 'all mission props disposed');
}
report.pass = true; report.checks = checks; console.log(JSON.stringify(report, null, 2));



