// deathsite.js : the corpse run. When the ship dies, the wreck location is
// remembered for that (seed, depth); after respawn the burned ship corpse plus a
// scatter of XP orbs appears there. Orbs magnetize to the ship and pay out XP.
import * as THREE from 'three';
import { makeRng, randRange } from './util/rng.js';
import { buildRobot, scorch } from './robots.js';

const ORB_COUNT = 6;
const ORB_XP = 10;
const _toShip = new THREE.Vector3();

const orbGeo = new THREE.OctahedronGeometry(0.45, 0);
const orbMat = new THREE.MeshLambertMaterial({ color: 0x5cff8a, emissive: 0x5cff8a, emissiveIntensity: 2.2 });

export class DeathSite {
  constructor(scene) {
    this.scene = scene;
    this.record = null;   // { seed, depth, pos, quat }
    this.group = null;    // live props for the current level
    this.orbs = [];
    this.time = 0;
  }

  recordDeath(seed, depth, pos, quat) {
    this.record = { seed, depth, pos: pos.clone(), quat: quat.clone() };
  }

  // call after a level builds; only spawns props when this level is the death level
  buildProps(seed, depth) {
    this.clearProps();
    const r = this.record;
    if (!r || r.seed !== seed || r.depth !== depth) return;

    this.group = new THREE.Group();
    this.group.name = 'deathsite';

    const corpse = scorch(buildRobot('ship', makeRng(seed)).group);
    corpse.position.copy(r.pos);
    corpse.quaternion.copy(r.quat);
    corpse.rotateZ(0.6); // settled at a wrong angle, like all good wrecks
    this.group.add(corpse);

    const rng = makeRng((seed ^ (depth * 7919)) >>> 0);
    this.orbs = [];
    for (let i = 0; i < ORB_COUNT; i++) {
      const orb = new THREE.Mesh(orbGeo, orbMat);
      orb.position.copy(r.pos).add(new THREE.Vector3(
        randRange(rng, -3, 3), randRange(rng, -2, 2), randRange(rng, -3, 3)));
      orb.userData.base = orb.position.clone();
      orb.userData.phase = randRange(rng, 0, Math.PI * 2);
      this.group.add(orb);
      this.orbs.push(orb);
    }
    this.scene.add(this.group);
  }

  // returns xp collected this frame
  update(dt, shipPos) {
    if (!this.group) return 0;
    this.time += dt;
    let gained = 0;
    for (const orb of this.orbs) {
      if (!orb.visible) continue;
      _toShip.copy(shipPos).sub(orb.position);
      const d = _toShip.length();
      if (d < 2.2) {
        orb.visible = false;
        gained += ORB_XP;
        continue;
      }
      if (d < 7) {
        orb.position.addScaledVector(_toShip.normalize(), dt * (8 - d) * 2.2); // magnet
      } else {
        orb.position.y = orb.userData.base.y + Math.sin(this.time * 2 + orb.userData.phase) * 0.3;
      }
      orb.rotation.y += dt * 3;
    }
    return gained;
  }

  clearProps() {
    if (!this.group) return;
    this.scene.remove(this.group);
    this.group.traverse((o) => { if (o.isMesh && o.geometry !== orbGeo) { o.geometry?.dispose(); o.material?.dispose(); } });
    this.group = null;
    this.orbs = [];
  }
}
