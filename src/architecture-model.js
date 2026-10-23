// Original mine pressure frames. Authored closed sections, physical-unit rest UVs,
// and a full liner. Structural meshes are FrontSide, including their backs.
import * as THREE from 'three';
import { FRAME_SECTION, SECTORS } from './procgen/architecture-layout.js';
import { grungeTexture } from './util/grungetex.js';

export function sectionGeometry(inner, section) {
  const p = [], c = [], tri = (a, b, d, color) => {
    p.push(...a, ...b, ...d);
    for (let k = 0; k < 3; k++) c.push(...color);
  };
  const point = (i, j) => {
    const [offset, z] = section[j], a = (i + .5) * Math.PI * 2 / SECTORS;
    const r = (inner + offset) / Math.cos(Math.PI / SECTORS);
    return [Math.cos(a) * r, Math.sin(a) * r, z];
  };
  for (let j = 0; j < section.length; j++) for (let i = 0; i < SECTORS; i++) {
    const a = point(i, j), b = point(i + 1, j), d = point(i, (j + 1) % section.length), e = point(i + 1, (j + 1) % section.length);
    const color = new THREE.Color(j === 0 || j === section.length - 2 ? (i % 3 === 1 ? 0xbdb087 : 0x657a80) : 0x4b616b).toArray();
    tri(a, b, e, color); tri(a, e, d, color);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  g.computeVertexNormals();
  return g;
}

class Batch {
  constructor() { this.p = []; this.n = []; this.c = []; this.uv = []; }
  add(source, color, matrix = new THREE.Matrix4()) {
    const g = source.index ? source.toNonIndexed() : source.clone(); g.applyMatrix4(matrix);
    const { position: p, normal: n, color: col } = g.attributes, tint = new THREE.Color(color);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      this.p.push(x, y, z); this.n.push(n.getX(i), n.getY(i), n.getZ(i));
      this.c.push(...(col ? [col.getX(i), col.getY(i), col.getZ(i)] : tint.toArray()));
      this.uv.push(Math.abs(n.getX(i)) > .65 ? z : x, Math.abs(n.getY(i)) > .65 ? z : y);
    }
    g.dispose(); source.dispose();
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    for (const [key, a, size] of [['position', this.p, 3], ['normal', this.n, 3], ['color', this.c, 3], ['uv', this.uv, 2]])
      g.setAttribute(key, new THREE.Float32BufferAttribute(a, size));
    g.computeBoundingBox(); g.computeBoundingSphere(); return g;
  }
}

const transform = (x, y, z, rx = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, rz)), new THREE.Vector3(1, 1, 1));
const band = (a, b, z0, z1) => [[a, z0], [b, z0], [b, z1], [a, z1]];

export function frameGeometries(inner, gate = false) {
  const body = new Batch(), lining = new Batch(), seals = new Batch(), power = new Batch();
  const bodySection = FRAME_SECTION.map(([r, z]) => [r === 0 ? .04 : r, z]);
  body.add(sectionGeometry(inner, bodySection), 0x536c75);
  const liner = sectionGeometry(inner, band(0, .04, -1.1, 1.1)); liner.deleteAttribute('color');
  lining.add(liner, 0x94a6aa);
  // Gaskets fill the service recess; they have thickness and sit below its rim.
  for (const side of [-1, 1]) {
    const seal = sectionGeometry(inner, band(.53, .85, side < 0 ? -1.015 : .98, side < 0 ? -.98 : 1.015));
    seal.deleteAttribute('color'); seals.add(seal, 0x17262c);
  }
  for (let i = 0; i < SECTORS; i++) {
    const a = i * Math.PI / 6, x = Math.cos(a), y = Math.sin(a);
    for (const side of [-1, 1]) {
      // Heads seat on the 1.00 m recess floor. Their exposed caps are at 1.07 m,
      // 3 cm below the flange, with chamfered walls and visible clearance around
      // each head. Both faces remain inside the original 2.2 m envelope.
      const bolt = new THREE.CylinderGeometry(.105, .105, .07, 6);
      lining.add(bolt, 0xb3b9b6, transform(x * (inner + .23), y * (inner + .23), side * 1.035, Math.PI / 2));
      // Three repeated status pockets on each face. Gate pockets are paired field
      // electrodes; entries use steady amber clearance lamps, without animation.
      if (i % 2 === 0) {
        const pocket = new THREE.BoxGeometry(.25, .65, .07);
        seals.add(pocket, 0x101c22, transform(x * (inner + .7), y * (inner + .7), side * 1.025, 0, a));
        power.add(new THREE.BoxGeometry(.12, .46, .025), gate ? 0xffffff : 0xffb14e,
          transform(x * (inner + .7), y * (inner + .7), side * 1.065, 0, a));
      }
    }
  }
  return { 'load-bearing-shell': body.geometry(), 'liner-and-fasteners': lining.geometry(),
    'gaskets-and-recesses': seals.geometry(), 'power-contacts': power.geometry() };
}

let materials;
function sharedMaterials() {
  return materials ||= {
    'load-bearing-shell': new THREE.MeshLambertMaterial({ vertexColors: true, map: grungeTexture(), flatShading: true }),
    'liner-and-fasteners': new THREE.MeshStandardMaterial({ vertexColors: true, metalness: .45, roughness: .58 }),
    'gaskets-and-recesses': new THREE.MeshLambertMaterial({ vertexColors: true }),
    'power-contacts': new THREE.MeshBasicMaterial({ vertexColors: true }),
  };
}

export function buildEntryFrames(specs) {
  const group = new THREE.Group(); group.name = 'authored-static-entries';
  const entries = specs.filter(s => s.kind === 'entry'); if (!entries.length) return group;
  const mats = sharedMaterials(), geometries = frameGeometries(entries[0].inner);
  for (const [name, geo] of Object.entries(geometries)) {
    const mesh = new THREE.InstancedMesh(geo, mats[name], entries.length); mesh.name = name;
    entries.forEach((s, i) => mesh.setMatrixAt(i, new THREE.Matrix4().compose(s.position, s.quaternion, new THREE.Vector3(1, 1, 1))));
    mesh.instanceMatrix.needsUpdate = true; mesh.frustumCulled = false; group.add(mesh);
  }
  return group;
}

export function buildSecurityFrame(spec) {
  const group = new THREE.Group(); group.name = 'security-field-emitter';
  group.position.copy(spec.position); group.quaternion.copy(spec.quaternion);
  const mats = sharedMaterials(), powerMaterial = mats['power-contacts'].clone();
  for (const [name, geo] of Object.entries(frameGeometries(spec.inner, true))) {
    const mesh = new THREE.Mesh(geo, name === 'power-contacts' ? powerMaterial : mats[name]); mesh.name = name; group.add(mesh);
  }
  // There is no mechanical leaf or fabricated hinge: this is an existing energy
  // gate. The normalized operating state changes paired emitter contacts from red
  // to green while the existing field fades. The structural sweep is empty.
  group.userData.setOpenFraction = (value, fieldMesh = null) => {
    const t = Math.max(0, Math.min(1, value)); group.userData.openFraction = t;
    powerMaterial.color.setRGB(1 - .75 * t, .08 + .82 * t, .04 + .32 * t);
    if (fieldMesh) fieldMesh.material.opacity = (1 - t) * .55;
  };
  group.userData.dispose = () => { group.traverse(o => o.geometry?.dispose()); powerMaterial.dispose(); };
  group.userData.setOpenFraction(0); return group;
}

// Intentionally two-sided optical field; every physical mesh remains FrontSide.
export function buildEnergyField(inner, color) {
  return new THREE.Mesh(new THREE.CircleGeometry(inner / Math.cos(Math.PI / 12), 12, Math.PI / 12),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .55, side: THREE.DoubleSide }));
}
