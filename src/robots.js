// robots.js : procedural OG-Descent-style robot bodies. Flat-shaded, zero textures,
// chunky low-poly hulls with armor plates, spikes, vents and glowing eye visors. Every
// call is seeded-unique: proportions, palette, spike counts and greebles vary per
// instance; grunt/claw/hulk/sniper each roll one of TWO hull recipes so a level shows
// silhouette variety while staying readable per class.
//
// buildRobot(kind, rng) -> { group, refs }
//   kind: 'grunt' | 'claw' | 'hulk' | 'sniper' | 'turret' | 'reactor' | 'ship'
//   group: THREE.Group, forward = local +Z (AI rotates +Z onto travel direction)
//   refs: { head }    turret only: aimable subgroup (barrel points local +Z)
//         { coreMat } reactor only: emissive material for damage flash
// Scale: bodies fit roughly inside config radius for their class (caller scales if needed).
import * as THREE from 'three';
import { randRange, randInt, pick } from './util/rng.js';
import { grungeTexture } from './util/grungetex.js';

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
  const map = grungeTexture();
  return {
    hull: new THREE.MeshLambertMaterial({ color: hull, flatShading: true, map }),
    panel: new THREE.MeshLambertMaterial({ color: panel, flatShading: true, map }),
    dark: new THREE.MeshLambertMaterial({ color: dark, flatShading: true, map }),
    eye: new THREE.MeshLambertMaterial({ color: eye, emissive: eye, emissiveIntensity: 2.6 }),
    spike: new THREE.MeshLambertMaterial({ color: 0xb8b8c0, flatShading: true, map }),
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

// scattered greeble blocks in panel color for that scratched-insert armor look
function addGreebles(g, m, rng, extent, count) {
  for (let i = 0; i < count; i++) {
    part(g, box(randRange(rng, 0.2, 0.5) * extent, randRange(rng, 0.1, 0.3) * extent, randRange(rng, 0.2, 0.5) * extent),
      pick(rng, [m.panel, m.dark]),
      randRange(rng, -0.5, 0.5) * extent, randRange(rng, 0.3, 0.6) * extent, randRange(rng, -0.5, 0.5) * extent,
      0, randRange(rng, 0, Math.PI), 0);
  }
}

// a row of n small dark vent slats centered on (x,y,z), spread along local axis 'x'|'y'|'z'
function addVents(g, m, x, y, z, axis, n, spacing, w, h, d, rx = 0, ry = 0, rz = 0) {
  for (let i = 0; i < n; i++) {
    const off = (i - (n - 1) / 2) * spacing;
    const px = x + (axis === 'x' ? off : 0);
    const py = y + (axis === 'y' ? off : 0);
    const pz = z + (axis === 'z' ? off : 0);
    part(g, box(w, h, d), m.dark, px, py, pz, rx, ry, rz);
  }
}

// thin cylinder mast + tiny emissive tip bead, optionally tilted
function addAntenna(g, m, x, y, z, len, rx = 0, rz = 0) {
  const grp = new THREE.Group();
  grp.position.set(x, y, z);
  grp.rotation.set(rx, 0, rz);
  part(grp, prism(0.025, len, 5), m.spike, 0, len / 2, 0);
  part(grp, new THREE.OctahedronGeometry(0.055, 0), m.eye, 0, len, 0);
  g.add(grp);
  return grp;
}

// n tiny rivet studs jittered along the straight line from (x0,y0,z0) to (x1,y1,z1)
function addRivetRow(g, m, rng, x0, y0, z0, x1, y1, z1, n) {
  for (let i = 0; i < n; i++) {
    const t = n <= 1 ? 0.5 : i / (n - 1);
    const j = randRange(rng, -0.02, 0.02);
    part(g, box(0.06, 0.06, 0.06), m.spike,
      x0 + (x1 - x0) * t + j, y0 + (y1 - y0) * t + j, z0 + (z1 - z0) * t + j);
  }
}

// ---------------------------------------------------------------------------
// GRUNT: two hull recipes, picked per-instance. Weakest, most common class.
// ---------------------------------------------------------------------------

// saucer: flattened hull + wheel-like side gun pods (the classic ITD-bot disc)
function buildGruntSaucer(g, m, rng) {
  const w = randRange(rng, 1.6, 2.0), h = randRange(rng, 0.55, 0.75);
  const hullMesh = part(g, new THREE.OctahedronGeometry(1, 0), m.hull, 0, 0, 0, 0, randRange(rng, 0, 0.4), 0);
  hullMesh.scale.set(w, h, w * randRange(rng, 0.8, 1.0));
  part(g, box(w * 1.15, h * 0.5, 0.7), m.panel, 0, 0, 0.1);            // waistband plate
  part(g, box(w * 1.0, h * 0.22, 0.5), m.dark, 0, h * 0.28, 0.15);     // layered trim plate above it
  for (const side of [-1, 1]) {
    part(g, prism(0.32, 0.5, 6), m.dark, side * w * 0.72, 0, 0, Math.PI / 2, 0, Math.PI / 2);
    part(g, box(0.16, 0.16, 0.8), m.spike, side * w * 0.72, 0, 0.45);
    part(g, box(0.1, 0.1, 0.1), m.spike, side * w * 0.55, h * 0.3, -0.2); // rivet stud
  }
  addVisor(g, m, rng, w * 0.7, h * 0.15, w * 0.55, randInt(rng, 1, 2));
  addVents(g, m, 0, -h * 0.1, -w * 0.5, 'x', 3, w * 0.28, 0.14, 0.08, 0.06);
  addAntenna(g, m, 0, h * 0.5, -w * 0.2, randRange(rng, 0.3, 0.5));
}

// winged wedge: flattened dart body, swept wings, wingtip gun pods, tail fin
function buildGruntWedge(g, m, rng) {
  const len = randRange(rng, 1.6, 2.0), wid = randRange(rng, 0.9, 1.1), hgt = randRange(rng, 0.5, 0.65);
  part(g, box(wid, hgt, len), m.hull);
  part(g, box(wid * 0.7, hgt * 0.4, len * 0.5), m.panel, 0, hgt * 0.35, len * 0.1);   // spine plate
  part(g, box(wid * 0.6, hgt * 0.3, len * 0.3), m.dark, 0, hgt * 0.1, len * 0.55);     // nose taper block
  for (const side of [-1, 1]) {
    part(g, box(wid * 1.6, hgt * 0.18, len * 0.55), m.panel, side * wid * 0.85, 0, -len * 0.05, 0, 0, side * 0.15);
    part(g, box(wid * 1.44, hgt * 0.1, len * 0.4), m.dark, side * wid * 0.85, hgt * 0.12, -len * 0.02, 0, 0, side * 0.15); // layered wing plate
    part(g, prism(0.14, 0.4, 6), m.dark, side * wid * 1.55, -hgt * 0.05, -len * 0.15, Math.PI / 2, 0, Math.PI / 2); // wingtip pod
    part(g, box(0.1, 0.1, 0.5), m.spike, side * wid * 1.55, -hgt * 0.05, len * 0.05); // gun barrel
  }
  part(g, box(0.08, hgt * 1.1, len * 0.35), m.panel, 0, hgt * 0.6, -len * 0.35); // vertical tail fin
  addVisor(g, m, rng, wid * 0.55, hgt * 0.15, len * 0.5, randInt(rng, 1, 2));
  addVents(g, m, 0, -hgt * 0.4, -len * 0.1, 'x', 3, wid * 0.35, 0.12, 0.07, 0.05);
  addAntenna(g, m, 0, hgt * 0.55, -len * 0.2, randRange(rng, 0.3, 0.45));
}

function buildGrunt(g, m, rng) {
  pick(rng, [buildGruntSaucer, buildGruntWedge])(g, m, rng);
}

// ---------------------------------------------------------------------------
// CLAW: two hull recipes. Fast melee harasser.
// ---------------------------------------------------------------------------

// X-frame: diamond core with 4 radiating swingarms tipped in diamond spikes
function buildClawXFrame(g, m, rng) {
  const c = randRange(rng, 0.55, 0.7);
  part(g, new THREE.OctahedronGeometry(c * 1.25, 0), m.hull, 0, 0, 0, 0, 0, Math.PI / 4);
  part(g, box(c * 1.7, c * 0.5, c * 0.9), m.panel, 0, 0, 0);
  part(g, box(c * 1.3, c * 0.2, c * 0.6), m.dark, 0, c * 0.3, 0); // layered top plate
  addVisor(g, m, rng, c * 1.1, 0, c * 0.85, 1);
  const arms = 4;
  for (let i = 0; i < arms; i++) {
    const a = (i / arms) * Math.PI * 2 + Math.PI / arms;
    const arm = new THREE.Group();
    arm.position.set(Math.cos(a) * c, Math.sin(a) * c * 0.6, 0);
    arm.rotation.z = a;
    part(arm, box(c * 1.5, c * 0.28, c * 0.28), m.dark, c * 0.75, 0, 0);
    part(arm, box(c * 0.9, c * 0.14, c * 0.14), m.spike, c * 0.6, 0, 0); // armor strip along the arm
    part(arm, spike(c * 0.22, c * 0.9, 4), m.spike, c * 1.55, 0, 0, 0, 0, -Math.PI / 2);
    g.add(arm);
  }
  addAntenna(g, m, 0, c * 0.6, 0, randRange(rng, 0.25, 0.4));
}

// trident fork: compact core, tail stabilizer fin, three forward-fanned lance prongs
function buildClawTrident(g, m, rng) {
  const c = randRange(rng, 0.55, 0.75);
  part(g, new THREE.OctahedronGeometry(c * 1.1, 0), m.hull, 0, 0, 0);
  part(g, box(c * 1.4, c * 0.5, c * 1.3), m.panel, 0, 0, c * 0.1);
  part(g, box(c * 1.1, c * 0.2, c * 0.9), m.dark, 0, c * 0.28, c * 0.05); // layered top trim
  addVisor(g, m, rng, c * 0.9, c * 0.1, c * 0.9, 1);
  part(g, box(0.1, c * 0.8, c * 0.6), m.dark, 0, c * 0.5, -c * 0.8); // rear stabilizer fin
  const prongs = 3;
  for (let i = 0; i < prongs; i++) {
    const ang = (i - (prongs - 1) / 2) * 0.5;
    const grp = new THREE.Group();
    grp.position.set(0, 0, c * 0.3);
    grp.rotation.y = ang;
    part(grp, box(c * 0.22, c * 0.22, c * 1.6), m.dark, 0, 0, c * 0.9);
    part(grp, spike(c * 0.16, c * 0.5, 4), m.spike, 0, 0, c * 1.75, Math.PI / 2, 0, 0);
    g.add(grp);
  }
  addAntenna(g, m, 0, c * 0.55, -c * 0.3, randRange(rng, 0.25, 0.4));
}

function buildClaw(g, m, rng) {
  pick(rng, [buildClawXFrame, buildClawTrident])(g, m, rng);
}

// ---------------------------------------------------------------------------
// HULK: two hull recipes. Slow, heavily armored bruiser.
// ---------------------------------------------------------------------------

// crab: wide squat body, shoulder pauldrons, hanging claw arms, twin barrels
function buildHulkCrab(g, m, rng) {
  const w = randRange(rng, 1.9, 2.3), h = randRange(rng, 1.1, 1.4), d = randRange(rng, 1.3, 1.6);
  part(g, box(w, h, d), m.hull);
  part(g, box(w * 0.8, h * 0.45, d * 1.06), m.panel, 0, h * 0.42, 0); // brow slab
  part(g, box(w * 1.06, h * 0.3, d * 0.8), m.dark, 0, -h * 0.35, 0);  // undercarriage
  for (const side of [-1, 1]) {
    part(g, box(w * 0.32, h * 0.75, d * 0.75), m.panel, side * w * 0.62, h * 0.15, 0, 0, 0, side * -0.18); // pauldron
    part(g, box(w * 0.34, h * 0.2, d * 0.3), m.dark, side * w * 0.62, h * 0.5, d * 0.15); // layered pauldron trim
    const arm = part(g, box(w * 0.2, h * 0.9, d * 0.28), m.dark, side * w * 0.6, -h * 0.55, d * 0.2);
    arm.rotation.x = -0.25;
    part(g, spike(0.18, 0.55, 4), m.spike, side * w * 0.6, -h * 1.0, d * 0.42, Math.PI, 0, 0); // claw tip
    part(g, box(0.2, 0.2, d * 0.9), m.spike, side * w * 0.3, -h * 0.05, d * 0.55); // twin barrels
    addRivetRow(g, m, rng, side * w * 0.45, h * 0.55, d * 0.35, side * w * 0.75, h * 0.55, -d * 0.1, 3);
  }
  const spikes = randInt(rng, 0, 4);
  for (let i = 0; i < spikes; i++) {
    part(g, spike(0.14, randRange(rng, 0.4, 0.7), 4), m.spike,
      randRange(rng, -0.4, 0.4) * w, h * 0.62, randRange(rng, -0.4, 0.4) * d);
  }
  addGreebles(g, m, rng, w * 0.5, randInt(rng, 2, 4));
  addVisor(g, m, rng, w * 0.55, h * 0.18, d * 0.53, randInt(rng, 2, 3));
  addVents(g, m, 0, h * 0.05, d * 0.52, 'x', 3, w * 0.2, 0.14, 0.1, 0.06);
  addAntenna(g, m, 0, h * 0.72, -d * 0.3, randRange(rng, 0.35, 0.55));
}

// brick fortress: boxy stacked-slab body, single big shoulder cannon, side vent banks
function buildHulkFortress(g, m, rng) {
  const w = randRange(rng, 1.8, 2.1), h = randRange(rng, 1.5, 1.8), d = randRange(rng, 1.4, 1.7);
  part(g, box(w, h, d), m.hull);                                       // main brick body
  part(g, box(w * 1.05, h * 0.25, d * 1.05), m.panel, 0, h * 0.45, 0);  // top slab
  part(g, box(w * 1.05, h * 0.2, d * 1.05), m.dark, 0, -h * 0.45, 0);   // base slab
  part(g, box(w * 0.9, h * 0.7, 0.15), m.panel, 0, 0, d * 0.55);        // front armor plate
  part(g, box(w * 0.7, h * 0.5, 0.1), m.dark, 0, -h * 0.05, d * 0.62);  // layered inset front plate
  const side = pick(rng, [-1, 1]);
  const mount = new THREE.Group();
  mount.position.set(side * w * 0.35, h * 0.55, d * 0.1);
  part(mount, box(w * 0.3, h * 0.25, d * 0.3), m.panel, 0, 0, 0);                      // cannon mount base
  part(mount, prism(0.28, 1.1, 8), m.dark, 0, 0.05, d * 0.35, Math.PI / 2, 0, 0);       // barrel
  part(mount, prism(0.32, 0.25, 8), m.spike, 0, 0.05, d * 0.35 + 0.55, Math.PI / 2, 0, 0); // muzzle brake
  g.add(mount);
  addVents(g, m, w * 0.51, h * 0.1, 0, 'z', 3, d * 0.3, 0.08, 0.16, 0.14);
  addVents(g, m, -w * 0.51, h * 0.1, 0, 'z', 3, d * 0.3, 0.08, 0.16, 0.14);
  addRivetRow(g, m, rng, -w * 0.45, h * 0.44, d * 0.5, w * 0.45, h * 0.44, d * 0.5, 5);
  addGreebles(g, m, rng, w * 0.4, randInt(rng, 2, 3));
  addVisor(g, m, rng, w * 0.5, h * 0.02, d * 0.53, randInt(rng, 2, 3));
  addAntenna(g, m, -side * w * 0.3, h * 0.7, -d * 0.2, randRange(rng, 0.4, 0.6));
}

function buildHulk(g, m, rng) {
  pick(rng, [buildHulkCrab, buildHulkFortress])(g, m, rng);
}

// ---------------------------------------------------------------------------
// SNIPER: two hull recipes. Long-range, thin profile.
// ---------------------------------------------------------------------------

// overslung rail: diamond hull with a huge top-mounted rail and swept fins
function buildSniperRail(g, m, rng) {
  const L = randRange(rng, 1.5, 1.8);
  const bodyMesh = part(g, new THREE.OctahedronGeometry(1, 0), m.hull, 0, 0, 0);
  bodyMesh.scale.set(0.7, 0.55, L * 0.75);
  part(g, box(0.5, 0.3, L * 0.9), m.panel, 0, 0.35, -L * 0.1);  // spine ridge
  part(g, box(0.26, 0.26, L * 1.9), m.spike, 0, 0.5, L * 0.5);  // the overslung rail
  part(g, box(0.44, 0.44, 0.6), m.dark, 0, 0.5, L * 1.3);       // muzzle brake
  part(g, box(0.34, 0.5, 0.7), m.dark, 0, 0.42, -L * 0.55);     // rear capacitor block
  for (const side of [-1, 1]) {
    part(g, box(1.0, 0.1, 0.65), m.panel, side * 0.75, -0.1, -L * 0.35, 0, side * 0.5, side * 0.35);
    part(g, box(0.9, 0.06, 0.55), m.dark, side * 0.78, -0.02, -L * 0.32, 0, side * 0.5, side * 0.35); // layered fin trim
    part(g, spike(0.1, 0.5, 4), m.spike, side * 1.15, -0.28, -L * 0.62, 0, 0, side * 1.9);
  }
  part(g, new THREE.OctahedronGeometry(0.26, 0), m.eye, 0, 0.05, L * 0.72); // cyclops eye
  addVents(g, m, 0, -0.15, -L * 0.2, 'x', 3, 0.3, 0.12, 0.08, 0.06);
  addAntenna(g, m, 0, 0.35, -L * 0.55, randRange(rng, 0.3, 0.45));
  addRivetRow(g, m, rng, -0.2, 0.5, L * 0.9, 0.2, 0.5, L * 0.9, 3);
}

// twin-boom: central pod, rail slung between two boom fuselages, finned tails
function buildSniperTwinBoom(g, m, rng) {
  const L = randRange(rng, 1.6, 1.9);
  part(g, box(0.5, 0.4, L * 0.6), m.hull, 0, 0, 0);            // central pod
  part(g, box(0.55, 0.15, L * 0.5), m.panel, 0, 0.25, 0);       // top plate
  part(g, box(0.24, 0.24, L * 1.7), m.spike, 0, 0.05, L * 0.55); // rail slung between the booms
  part(g, box(0.4, 0.4, 0.5), m.dark, 0, 0.05, L * 1.35);       // muzzle brake
  for (const side of [-1, 1]) {
    part(g, box(0.28, 0.28, L * 1.1), m.dark, side * 0.55, -0.05, -L * 0.05);  // boom fuselage
    part(g, box(0.3, 0.1, 0.3), m.panel, side * 0.55, 0.12, L * 0.35);          // boom top plate
    part(g, box(0.06, 0.4, 0.4), m.panel, side * 0.55, 0.1, -L * 0.55);         // tail fin
    part(g, spike(0.08, 0.4, 4), m.spike, side * 0.55, 0.32, -L * 0.6, 0, 0, side * 0.3); // fin tip
    part(g, prism(0.13, 0.5, 6), m.dark, side * 0.55, -0.05, -L * 0.65, Math.PI / 2, 0, 0); // engine nub
  }
  part(g, new THREE.OctahedronGeometry(0.22, 0), m.eye, 0, 0.1, L * 0.32); // eye
  addVents(g, m, 0, -0.1, -L * 0.1, 'x', 3, 0.22, 0.1, 0.07, 0.05);
  addAntenna(g, m, 0, 0.3, -L * 0.2, randRange(rng, 0.3, 0.45));
}

function buildSniper(g, m, rng) {
  pick(rng, [buildSniperRail, buildSniperTwinBoom])(g, m, rng);
}

// TURRET: armored socket base + boxy aiming head (refs.head, barrel along +Z)
function buildTurret(g, m, rng) {
  part(g, prism(1.1, 0.5, 8), m.dark, 0, 0.2, 0);   // base socket
  part(g, prism(1.25, 0.15, 8), m.panel, 0, -0.02, 0); // base rim plate
  part(g, prism(0.8, 0.45, 6), m.panel, 0, 0.55, 0);   // riser
  const studs = 5;
  for (let i = 0; i < studs; i++) {
    const a = (i / studs) * Math.PI * 2;
    part(g, box(0.06, 0.06, 0.06), m.spike, Math.cos(a) * 1.02, 0.28, Math.sin(a) * 1.02);
  }
  const head = new THREE.Group();
  head.position.y = 0.95;
  part(head, box(0.9, 0.6, 1.0), m.hull);
  part(head, box(0.96, 0.25, 0.7), m.panel, 0, 0.3, -0.1);
  part(head, box(0.7, 0.15, 0.5), m.dark, 0, 0.42, -0.15); // layered top trim
  part(head, box(0.22, 0.22, 1.4), m.spike, 0, 0, 0.9);
  part(head, box(0.3, 0.3, 0.3), m.dark, 0, 0, 1.5);
  part(head, box(0.34, 0.34, 0.15), m.panel, 0, 0, 1.35); // muzzle collar
  part(head, box(0.3, 0.16, 0.1), m.eye, 0, 0.14, 0.52);
  addVents(head, m, -0.3, -0.15, -0.35, 'y', 2, 0.15, 0.12, 0.08, 0.3);
  addAntenna(head, m, 0.35, 0.35, -0.3, randRange(rng, 0.25, 0.35));
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
    part(g, box(0.36, 0.5, 0.36), m.dark, Math.cos(a) * 1.2, 0.7, Math.sin(a) * 1.2, 0, -a, 0); // strut armor collar
    part(g, spike(0.2, 0.7, 4), m.spike, Math.cos(a) * 1.2, 1.5, Math.sin(a) * 1.2);
    part(g, spike(0.2, 0.7, 4), m.spike, Math.cos(a) * 1.2, -1.5, Math.sin(a) * 1.2, Math.PI, 0, 0);
  }
  part(g, prism(1.45, 0.3, 6), m.hull, 0, 1.35, 0);
  part(g, prism(1.45, 0.3, 6), m.hull, 0, -1.35, 0);
  part(g, prism(1.15, 0.1, 6), m.panel, 0, 1.5, 0);  // top vent ring
  part(g, prism(1.15, 0.1, 6), m.panel, 0, -1.5, 0); // bottom vent ring
  addVents(g, m, 0, 1.35, 1.5, 'x', 4, 0.5, 0.15, 0.06, 0.1);
  return { coreMat };
}

// SHIP: the player's Pyro-GX-ish interceptor (close-up in third person + death cam).
// Central fuselage + raised glass canopy, forked tuning-fork prongs off the wing roots,
// swept layered-armor wings, twin-belled engine block, underslung intake, mast antenna.
// Forward +Z. ~35-40 parts.
function buildShip(g, m, rng) {
  const shipTex = grungeTexture();
  const grey = new THREE.MeshLambertMaterial({ color: 0x8a9096, flatShading: true, map: shipTex });
  const trim = new THREE.MeshLambertMaterial({ color: 0x3f7a4a, flatShading: true, map: shipTex });
  const darkPanel = new THREE.MeshLambertMaterial({ color: 0x33383d, flatShading: true, map: shipTex });
  const glass = new THREE.MeshLambertMaterial({ color: 0x0c1014, flatShading: true });
  const engineGlow = new THREE.MeshLambertMaterial({ color: 0xff7a2f, emissive: 0xff7a2f, emissiveIntensity: 2.2, flatShading: true });

  // -- central fuselage --
  const fus = part(g, new THREE.OctahedronGeometry(1, 0), grey, 0, 0, 0.1);
  fus.scale.set(0.62, 0.5, 1.7);
  part(g, box(0.5, 0.22, 1.3), trim, 0, 0.32, 0.15);                       // dorsal spine plate
  part(g, spike(0.3, 0.5, 4), darkPanel, 0, -0.02, 1.5, Math.PI / 2, 0, 0); // nose taper cone

  // -- raised cockpit canopy: dark glass box + emissive rim --
  part(g, box(0.4, 0.26, 0.5), glass, 0, 0.42, 0.5);      // canopy glass
  part(g, box(0.46, 0.06, 0.58), m.eye, 0, 0.27, 0.5);    // emissive canopy rim glow

  // -- twin forked prongs off the wing roots, jutting forward past the nose --
  for (const side of [-1, 1]) {
    const prong = new THREE.Group();
    prong.position.set(side * 0.42, -0.08, 0.5);
    prong.rotation.y = side * 0.1;
    part(prong, box(0.14, 0.14, 0.3), darkPanel, 0, 0, 0);                    // root fairing
    part(prong, box(0.08, 0.08, 1.3), trim, 0, 0, 0.75);                      // tapered shaft
    part(prong, spike(0.08, 0.3, 4), darkPanel, 0, 0, 1.5, Math.PI / 2, 0, 0); // tip
    g.add(prong);
  }

  // -- swept wings with layered armor plates --
  for (const side of [-1, 1]) {
    const wing = new THREE.Group();
    g.add(wing);
    part(wing, box(1.3, 0.09, 0.85), grey, side * 0.85, -0.05, -0.15, 0, 0, side * 0.32);     // main wing
    part(wing, box(1.1, 0.06, 0.55), darkPanel, side * 0.95, -0.005, -0.1, 0, 0, side * 0.32); // layered plate
    part(wing, box(0.85, 0.05, 0.32), trim, side * 1.05, 0.04, -0.05, 0, 0, side * 0.32);      // trim stripe
    part(wing, spike(0.08, 0.42, 4), darkPanel, side * 1.55, -0.05, -0.55, 0, 0, side * 1.9);  // wingtip fin
    addVents(wing, m, side * 0.6, -0.09, -0.3, 'z', 2, 0.28, 0.12, 0.05, 0.14, 0, side * 0.32, 0);
  }

  // -- engine block with twin engine bells (emissive orange glow discs) --
  part(g, box(0.62, 0.42, 0.55), grey, 0, -0.02, -0.95);       // engine block housing
  part(g, box(0.5, 0.1, 0.4), darkPanel, 0, 0.2, -0.95);        // top armor plate
  for (const side of [-1, 1]) {
    part(g, prism(0.24, 0.5, 8), darkPanel, side * 0.32, -0.05, -1.15, Math.PI / 2, 0, 0);  // engine bell housing
    part(g, prism(0.17, 0.06, 8), engineGlow, side * 0.32, -0.05, -1.42, Math.PI / 2, 0, 0); // glow disc
  }

  // -- underslung intake --
  part(g, box(0.5, 0.2, 0.6), darkPanel, 0, -0.32, 0.25); // intake housing
  part(g, box(0.38, 0.08, 0.42), m.dark, 0, -0.32, 0.42); // dark recess inset

  // -- antenna + rivets + scratched inserts --
  addAntenna(g, m, 0.18, 0.5, 0.05, randRange(rng, 0.35, 0.5), 0, 0.15);
  addRivetRow(g, m, rng, -0.24, 0.32, -0.4, 0.24, 0.32, -0.4, 4);
  addGreebles(g, m, rng, 0.5, 2);
}

// darken a built robot/ship into a burned wreck (fresh materials, originals untouched).
// Kept bright enough to read as a silhouette against the near-black death-cam
// background: a fully-charcoal wreck disappears once the HULL BREACH overlay dims
// the scene further, so burned stays a visible dark-grey (not near-black) and every
// other part embers hot orange instead of a rare 1-in-4 accent.
export function scorch(group) {
  const burned = new THREE.MeshLambertMaterial({ color: 0x38312c, flatShading: true, map: grungeTexture() });
  const ember = new THREE.MeshLambertMaterial({ color: 0x2a1208, emissive: 0xff5a18, emissiveIntensity: 1.8, flatShading: true });
  let i = 0;
  group.traverse((o) => { if (o.isMesh) o.material = (i++ % 2 === 0) ? ember : burned; });
  return group;
}

const BUILDERS = { grunt: buildGrunt, claw: buildClaw, hulk: buildHulk, sniper: buildSniper, turret: buildTurret, reactor: buildReactor, ship: buildShip };

export function buildRobot(kind, rng) {
  const g = new THREE.Group();
  const m = mats(rng);
  const refs = BUILDERS[kind](g, m, rng) || {};
  return { group: g, refs };
}
