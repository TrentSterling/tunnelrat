// robots.js : procedural OG-Descent-style robot bodies. Flat-shaded, zero textures,
// chunky low-poly hulls with armor plates, spikes and glowing eye visors. Every call
// is seeded-unique: proportions, palette, spike counts and greebles vary per instance.
//
// buildRobot(kind, rng) -> { group, refs }
//   kind: 'grunt' | 'claw' | 'hulk' | 'sniper' | 'turret' | 'reactor'
//   group: THREE.Group, forward = local +Z (AI rotates +Z onto travel direction)
//   refs: { head }    turret only: aimable subgroup (barrel points local +Z)
//         { coreMat } reactor only: emissive material for damage flash
// Scale: bodies fit roughly inside config radius for their class (caller scales if needed).
import * as THREE from 'three';
import { randRange, randInt, pick } from './util/rng.js';

// Descent-flavored palettes: [hull, panel/trim, dark, eyeEmissive]
const PALETTES = [
  [0x8a5a34, 0x5a3a20, 0x2a2018, 0xff2020], // hulk brown / red eyes
  [0x4a7a3a, 0x777f70, 0x1e2a1a, 0xff3020], // green camo / red eyes
  [0xa03028, 0x8f8f96, 0x351210, 0x20ff40], // red + silver / green eyes
  [0x5a5a8a, 0x3a3a55, 0x1c1c30, 0x30ff50], // violet-blue hulk / green eyes
  [0xa07828, 0x6a4a1c, 0x302410, 0xff3020], // gold ochre / red eyes
  [0x6a3a2a, 0x2f2f34, 0x1a1210, 0x30ff50], // rust + black / green eyes
];

function mats(rng) {
  const [hull, panel, dark, eye] = pick(rng, PALETTES);
  return {
    hull: new THREE.MeshLambertMaterial({ color: hull, flatShading: true }),
    panel: new THREE.MeshLambertMaterial({ color: panel, flatShading: true }),
    dark: new THREE.MeshLambertMaterial({ color: dark, flatShading: true }),
    eye: new THREE.MeshLambertMaterial({ color: eye, emissive: eye, emissiveIntensity: 2.6 }),
    spike: new THREE.MeshLambertMaterial({ color: 0xb8b8c0, flatShading: true }),
  };
}

// add a part: geometry, material, position, euler rotation, scale
function part(parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  if (typeof s === 'number') m.scale.setScalar(s); else m.scale.copy(s);
  parent.add(m);
  return m;
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const prism = (r, h, n) => new THREE.CylinderGeometry(r, r, h, n); // low-seg cylinder = prism
const spike = (r, h, n = 4) => new THREE.ConeGeometry(r, h, n);

// glowing eye strip on a dark visor recess, facing +Z
function addVisor(g, m, rng, width, y, z, eyeCount) {
  part(g, box(width, width * 0.34, 0.14), m.dark, 0, y, z);
  const n = eyeCount ?? randInt(rng, 1, 3);
  const spacing = width / (n + 1);
  for (let i = 0; i < n; i++) {
    part(g, box(spacing * 0.5, width * 0.2, 0.1), m.eye, -width / 2 + spacing * (i + 1), y, z + 0.09);
  }
}

// scattered greeble blocks in panel color for that armor-plate look
function addGreebles(g, m, rng, extent, count) {
  for (let i = 0; i < count; i++) {
    part(g, box(randRange(rng, 0.2, 0.5) * extent, randRange(rng, 0.1, 0.3) * extent, randRange(rng, 0.2, 0.5) * extent),
      pick(rng, [m.panel, m.dark]),
      randRange(rng, -0.5, 0.5) * extent, randRange(rng, 0.3, 0.6) * extent, randRange(rng, -0.5, 0.5) * extent,
      0, randRange(rng, 0, Math.PI), 0);
  }
}

// GRUNT: flattened saucer with side gun pods (the ITD-bot silhouette)
function buildGrunt(g, m, rng) {
  const w = randRange(rng, 1.6, 2.0), h = randRange(rng, 0.55, 0.75);
  const hullMesh = part(g, new THREE.OctahedronGeometry(1, 0), m.hull, 0, 0, 0, 0, randRange(rng, 0, 0.4), 0);
  hullMesh.scale.set(w, h, w * randRange(rng, 0.8, 1.0));
  part(g, box(w * 1.15, h * 0.5, 0.7), m.panel, 0, 0, 0.1); // waistband plate
  for (const side of [-1, 1]) { // wheel-like gun pods
    part(g, prism(0.32, 0.5, 6), m.dark, side * w * 0.72, 0, 0, Math.PI / 2, 0, Math.PI / 2);
    part(g, box(0.16, 0.16, 0.8), m.spike, side * w * 0.72, 0, 0.45);
  }
  addVisor(g, m, rng, w * 0.7, h * 0.15, w * 0.55, randInt(rng, 1, 2));
}

// CLAW: compact core with 4 diamond-tipped swingarms (Diamond Claw)
function buildClaw(g, m, rng) {
  const c = randRange(rng, 0.55, 0.7);
  part(g, new THREE.OctahedronGeometry(c * 1.25, 0), m.hull, 0, 0, 0, 0, 0, Math.PI / 4);
  part(g, box(c * 1.7, c * 0.5, c * 0.9), m.panel, 0, 0, 0);
  addVisor(g, m, rng, c * 1.1, 0, c * 0.85, 1);
  const arms = randInt(rng, 3, 4);
  for (let i = 0; i < arms; i++) {
    const a = (i / arms) * Math.PI * 2 + Math.PI / arms;
    const arm = new THREE.Group();
    arm.position.set(Math.cos(a) * c, Math.sin(a) * c * 0.6, 0);
    arm.rotation.z = a;
    part(arm, box(c * 1.5, c * 0.28, c * 0.28), m.dark, c * 0.75, 0, 0);
    part(arm, spike(c * 0.22, c * 0.9, 4), m.spike, c * 1.55, 0, 0, 0, 0, -Math.PI / 2)
      .rotation.z = -Math.PI / 2;
    g.add(arm);
  }
}

// HULK: wide squat crab body, shoulder pauldrons, hanging claw arms, twin barrels
function buildHulk(g, m, rng) {
  const w = randRange(rng, 1.9, 2.3), h = randRange(rng, 1.1, 1.4), d = randRange(rng, 1.3, 1.6);
  part(g, box(w, h, d), m.hull);
  part(g, box(w * 0.8, h * 0.45, d * 1.06), m.panel, 0, h * 0.42, 0); // brow slab
  part(g, box(w * 1.06, h * 0.3, d * 0.8), m.dark, 0, -h * 0.35, 0);  // undercarriage
  for (const side of [-1, 1]) {
    part(g, box(w * 0.32, h * 0.75, d * 0.75), m.panel, side * w * 0.62, h * 0.15, 0, 0, 0, side * -0.18); // pauldron
    const arm = part(g, box(w * 0.2, h * 0.9, d * 0.28), m.dark, side * w * 0.6, -h * 0.55, d * 0.2);
    arm.rotation.x = -0.25;
    part(g, spike(0.18, 0.55, 4), m.spike, side * w * 0.6, -h * 1.0, d * 0.42, Math.PI, 0, 0); // claw tip
    part(g, box(0.2, 0.2, d * 0.9), m.spike, side * w * 0.3, -h * 0.05, d * 0.55); // twin barrels
  }
  const spikes = randInt(rng, 0, 4);
  for (let i = 0; i < spikes; i++) {
    part(g, spike(0.14, randRange(rng, 0.4, 0.7), 4), m.spike,
      randRange(rng, -0.4, 0.4) * w, h * 0.62, randRange(rng, -0.4, 0.4) * d);
  }
  addGreebles(g, m, rng, w * 0.5, randInt(rng, 2, 4));
  addVisor(g, m, rng, w * 0.55, h * 0.18, d * 0.53, randInt(rng, 2, 3));
}

// SNIPER: angular gun-platform: diamond hull, huge overslung rail, swept fins
function buildSniper(g, m, rng) {
  const L = randRange(rng, 1.5, 1.8);
  const bodyMesh = part(g, new THREE.OctahedronGeometry(1, 0), m.hull, 0, 0, 0);
  bodyMesh.scale.set(0.7, 0.55, L * 0.75);
  part(g, box(0.5, 0.3, L * 0.9), m.panel, 0, 0.35, -L * 0.1); // spine ridge
  part(g, box(0.26, 0.26, L * 1.9), m.spike, 0, 0.5, L * 0.5); // the overslung rail
  part(g, box(0.44, 0.44, 0.6), m.dark, 0, 0.5, L * 1.3);      // muzzle brake
  part(g, box(0.34, 0.5, 0.7), m.dark, 0, 0.42, -L * 0.55);    // rear capacitor block
  for (const side of [-1, 1]) { // swept stabilizer fins
    part(g, box(1.0, 0.1, 0.65), m.panel, side * 0.75, -0.1, -L * 0.35, 0, side * 0.5, side * 0.35);
    part(g, spike(0.1, 0.5, 4), m.spike, side * 1.15, -0.28, -L * 0.62, 0, 0, side * 1.9);
  }
  part(g, new THREE.OctahedronGeometry(0.26, 0), m.eye, 0, 0.05, L * 0.72); // cyclops eye
}

// TURRET: armored socket base + boxy aiming head (refs.head, barrel along +Z)
function buildTurret(g, m, rng) {
  part(g, prism(1.1, 0.5, 8), m.dark, 0, 0.2, 0);
  part(g, prism(0.8, 0.45, 6), m.panel, 0, 0.55, 0);
  const head = new THREE.Group();
  head.position.y = 0.95;
  part(head, box(0.9, 0.6, 1.0), m.hull);
  part(head, box(0.96, 0.25, 0.7), m.panel, 0, 0.3, -0.1);
  part(head, box(0.22, 0.22, 1.4), m.spike, 0, 0, 0.9);
  part(head, box(0.3, 0.3, 0.3), m.dark, 0, 0, 1.5);
  part(head, box(0.3, 0.16, 0.1), m.eye, 0, 0.14, 0.52);
  g.add(head);
  return { head };
}

// REACTOR: faceted core in an angular armor cage, big and mean
function buildReactor(g, m, rng) {
  const coreMat = new THREE.MeshLambertMaterial({
    color: 0xff7a2f, emissive: 0xff7a2f, emissiveIntensity: 1.1, flatShading: true,
  });
  part(g, new THREE.DodecahedronGeometry(1, 0), coreMat);
  const cage = randInt(rng, 5, 6);
  for (let i = 0; i < cage; i++) {
    const a = (i / cage) * Math.PI * 2;
    part(g, box(0.3, 2.6, 0.3), m.panel, Math.cos(a) * 1.2, 0, Math.sin(a) * 1.2, 0, -a, 0);
    part(g, spike(0.2, 0.7, 4), m.spike, Math.cos(a) * 1.2, 1.5, Math.sin(a) * 1.2);
    part(g, spike(0.2, 0.7, 4), m.spike, Math.cos(a) * 1.2, -1.5, Math.sin(a) * 1.2, Math.PI, 0, 0);
  }
  part(g, prism(1.45, 0.3, 6), m.hull, 0, 1.35, 0);
  part(g, prism(1.45, 0.3, 6), m.hull, 0, -1.35, 0);
  return { coreMat };
}

const BUILDERS = { grunt: buildGrunt, claw: buildClaw, hulk: buildHulk, sniper: buildSniper, turret: buildTurret, reactor: buildReactor };

export function buildRobot(kind, rng) {
  const g = new THREE.Group();
  const m = mats(rng);
  const refs = BUILDERS[kind](g, m, rng) || {};
  return { group: g, refs };
}
