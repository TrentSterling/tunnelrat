// ship.js : the 6DOF flight model + SDF collision. THE FEEL LIVES HERE.
//
// CONTRACT (implement exactly):
//
// class Ship {
//   constructor(config, field)
//   field                        // public writable: main.js swaps it on level change
//   object3d: THREE.Object3D     // pose container; main.js parents the camera to it
//   velocity: THREE.Vector3      // world-space m/s
//   shields, energy: number      // start at config.ship.shields / .energy
//   alive: boolean
//   noclip: boolean              // cheat console toggle (default false); while true,
//                                // _integrateAndCollide skips the SDF collision resolve
//                                // block entirely (position still integrates from velocity)
//   onImpact: null | (speed:number) => void   // set by main; fired on wall hits > 6 m/s
//
//   reset(pos:Vector3, quat:Quaternion)       // also refills shields/energy, alive=true
//   update(dt, input:Input)
//   takeDamage(n) -> boolean     // true if this kill dropped shields <= 0 (sets alive=false)
//   spendEnergy(n) -> boolean    // false if insufficient (no partial spend)
//   forward(out:Vector3) -> out  // -Z of object3d in world space
//   muzzlePos(out:Vector3) -> out // 1.2m ahead, 0.4m below eye
// }
//
// update():
//   Rotation: quaternion-compose in LOCAL space (order: yaw around local +Y by
//   -mouseDX*lookSpeed, pitch around local +X by -mouseDY*lookSpeed, roll around local
//   +Z by -input.axis.roll*rollSpeed*dt). NO euler clamping, NO world up vector: full
//   6DOF, upside down must be stable and drift-free.
//   Thrust: local axis vector (x,y,-z? NOTE: axis.z=+1 means forward, i.e. along -Z local)
//   scaled by config.ship.thrust (* boostMult when input.boost), rotated to world,
//   added to velocity. Damping: velocity *= max(0, 1 - damping*dt). Clamp speed to
//   maxSpeed (boost raises cap by boostMult). Integrate position.
//   Energy regen: energyRegen * dt up to max.
//
// Collision (SDF sphere, robust at 34 m/s vs voxelSize 1.6):
//   After integration, do up to 3 resolution iterations:
//     d = field.sample(pos); if d > -config.ship.radius (wall closer than radius):
//       n = field.collisionNormal(pos); push pos along n by (d + radius) (i.e. out of
//       the wall); remove velocity component INTO the wall: v -= n * min(0, v.dot(n))
//       * (1 + bounce). Track pre-resolve normal speed; if > 6 call onImpact(speed)
//       once per frame and apply impact damage: takeDamage((speed-6) * 0.8).
//   Also substep: if |v|*dt > radius, split the integration into ceil(|v|*dt/radius)
//   substeps, resolving each. Never tunnel through walls at max speed.
import * as THREE from 'three';

// module-scope scratch: no per-frame allocation in the hot update/collision path
const _qYaw = new THREE.Quaternion();
const _qPitch = new THREE.Quaternion();
const _qRoll = new THREE.Quaternion();
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
const _thrustLocal = new THREE.Vector3();
const _thrustWorld = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _muzzleLocal = new THREE.Vector3();

export class Ship {
  constructor(config, field) {
    this.config = config;
    this.field = field;
    this.object3d = new THREE.Object3D();
    this.velocity = new THREE.Vector3();
    this.rollVel = 0; // rad/s, integrated with accel + damping in update()
    this.shields = config.ship.shields;
    this.energy = config.ship.energy;
    this.alive = true;
    this.noclip = false; // cheat console; not reset by reset() so it survives retries/level loads
    this.onImpact = null;
  }

  reset(pos, quat) {
    this.object3d.position.copy(pos);
    this.object3d.quaternion.copy(quat);
    this.velocity.set(0, 0, 0);
    this.rollVel = 0;
    this.shields = this.config.ship.shields;
    this.energy = this.config.ship.energy;
    this.alive = true;
  }

  forward(out) {
    out.set(0, 0, -1);
    out.applyQuaternion(this.object3d.quaternion);
    return out;
  }

  muzzlePos(out) {
    _muzzleLocal.set(0, -0.4, -1.2);
    _muzzleLocal.applyQuaternion(this.object3d.quaternion);
    out.copy(this.object3d.position).add(_muzzleLocal);
    return out;
  }

  takeDamage(n) {
    if (!this.alive) return false;
    this.shields -= n;
    if (this.shields <= 0) {
      this.shields = 0;
      this.alive = false;
      return true;
    }
    return false;
  }

  spendEnergy(n) {
    if (this.energy < n) return false;
    this.energy -= n;
    return true;
  }

  update(dt, input) {
    const cfg = this.config.ship;
    const q = this.object3d.quaternion;

    // --- rotation: compose incrementally in local space, no euler clamps ---
    _qYaw.setFromAxisAngle(AXIS_Y, -input.mouseDX * cfg.lookSpeed);
    q.multiply(_qYaw);
    _qPitch.setFromAxisAngle(AXIS_X, -input.mouseDY * cfg.lookSpeed);
    q.multiply(_qPitch);
    // roll is a velocity, not a snap: accelerates toward the held direction and
    // bleeds off when released (newtonian angular feel, matches the linear drift)
    this.rollVel += -input.axis.roll * cfg.rollAccel * dt;
    this.rollVel *= Math.max(0, 1 - cfg.rollDamping * dt);
    const rollCap = cfg.rollSpeed;
    if (this.rollVel > rollCap) this.rollVel = rollCap;
    else if (this.rollVel < -rollCap) this.rollVel = -rollCap;
    if (Math.abs(this.rollVel) > 1e-4) {
      _qRoll.setFromAxisAngle(AXIS_Z, this.rollVel * dt);
      q.multiply(_qRoll);
    }
    q.normalize();

    // --- thrust: local axis vector, rotated to world, added as acceleration ---
    const boosting = !!input.boost;
    const thrustMag = cfg.thrust * (boosting ? cfg.boostMult : 1);
    _thrustLocal.set(input.axis.x, input.axis.y, -input.axis.z);
    _thrustWorld.copy(_thrustLocal).applyQuaternion(q).multiplyScalar(thrustMag);
    this.velocity.addScaledVector(_thrustWorld, dt);

    // --- damping ---
    const dampFactor = Math.max(0, 1 - cfg.damping * dt);
    this.velocity.multiplyScalar(dampFactor);

    // --- clamp speed ---
    const maxSpeed = cfg.maxSpeed * (boosting ? cfg.boostMult : 1);
    const speedSq = this.velocity.lengthSq();
    if (speedSq > maxSpeed * maxSpeed) {
      this.velocity.multiplyScalar(maxSpeed / Math.sqrt(speedSq));
    }

    // --- energy regen ---
    this.energy = Math.min(cfg.energy, this.energy + cfg.energyRegen * dt);

    // --- integrate position with substepped SDF collision ---
    this._integrateAndCollide(dt);
  }

  _integrateAndCollide(dt) {
    const cfg = this.config.ship;
    const field = this.field;
    if (!field || this.noclip) {
      this.object3d.position.addScaledVector(this.velocity, dt);
      return;
    }

    const speed = this.velocity.length();
    const travel = speed * dt;
    const substeps = travel > cfg.radius ? Math.ceil(travel / cfg.radius) : 1;
    const subDt = dt / substeps;

    let maxImpactSpeed = 0;

    for (let s = 0; s < substeps; s++) {
      this.object3d.position.addScaledVector(this.velocity, subDt);

      for (let i = 0; i < 3; i++) {
        const p = this.object3d.position;
        const d = field.sample(p.x, p.y, p.z);
        if (d <= -cfg.radius) break;

        field.collisionNormal(p.x, p.y, p.z, _normal);
        const push = d + cfg.radius;
        p.addScaledVector(_normal, push);

        const vInto = Math.min(0, this.velocity.dot(_normal));
        if (vInto < 0) {
          const impactSpeed = -vInto;
          if (impactSpeed > maxImpactSpeed) maxImpactSpeed = impactSpeed;
          this.velocity.addScaledVector(_normal, -vInto * (1 + cfg.bounce));
        }
      }
    }

    if (maxImpactSpeed > 6) {
      if (this.onImpact) this.onImpact(maxImpactSpeed);
      this.takeDamage((maxImpactSpeed - 6) * 0.8);
    }
  }
}
