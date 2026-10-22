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
//   +Z using the damped local roll velocity). NO euler clamping, NO world up vector: full
//   6DOF, upside down must be stable and drift-free.
//   Thrust: local axis vector (x,y,-z? NOTE: axis.z=+1 means forward, i.e. along -Z local)
//   scaled by config.ship.thrust (* boostMult when input.boost), rotated to world,
//   added to velocity. Damping and displacement extend the original 60 Hz response
//   over elapsed time. Clamp speed to maxSpeed (boost raises cap by boostMult).
//   Rotation, thrust and sphere collision use bounded steps of at most 1/240 s.
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
const _motionVelocity = new THREE.Vector3();
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
    if (!this.alive || !(dt > 0) || !Number.isFinite(dt)) return;
    // Bounded coupled rotation/thrust/collision steps, with no accumulator or
    // delayed input. Mouse deltas are pixels per frame; distribute them once.
    const steps = Math.max(1, Math.ceil(dt * 240 - 1e-10));
    let impact = 0;
    for (let i = 0; i < steps; i++) impact = Math.max(impact, this._step(dt / steps, input, 1 / steps));
    if (impact > 6) {
      if (this.onImpact) this.onImpact(impact);
      this.takeDamage((impact - 6) * 0.8);
    }
  }

  _step(dt, input, mouseFraction) {
    const cfg = this.config.ship;
    const q = this.object3d.quaternion;

    // --- rotation: compose incrementally in local space, no euler clamps ---
    _qYaw.setFromAxisAngle(AXIS_Y, -input.mouseDX * cfg.lookSpeed * mouseFraction);
    q.multiply(_qYaw);
    _qPitch.setFromAxisAngle(AXIS_X, -input.mouseDY * cfg.lookSpeed * mouseFraction);
    q.multiply(_qPitch);
    // roll is a velocity, not a snap: accelerates toward the held direction and
    // bleeds off when released (newtonian angular feel, matches the linear drift)
    // Extend the tuned 60 Hz damped response to elapsed time. Integrating the
    // angle from the same response preserves the 60 Hz step, including release,
    // rather than multiplying the final velocity by a variable frame duration.
    const h = 1 / 60, base = 1 - cfg.rollDamping * h;
    const accel = -input.axis.roll * cfg.rollAccel;
    const start = this.rollVel;
    let angle;
    if (cfg.rollDamping > 0 && base > 0) {
      const decay = Math.pow(base, dt / h);
      const steady = accel * base / cfg.rollDamping;
      angle = steady * dt + (start - steady) * h * base * (1 - decay) / (1 - base);
      this.rollVel = steady + (start - steady) * decay;
    } else if (base <= 0) {
      this.rollVel = 0;
      angle = 0;
    } else {
      this.rollVel += accel * dt;
      angle = start * dt + accel * dt * (dt + h) / 2;
    }
    const rollCap = cfg.rollSpeed;
    if (this.rollVel > rollCap) this.rollVel = rollCap;
    else if (this.rollVel < -rollCap) this.rollVel = -rollCap;
    if (angle !== 0) {
      _qRoll.setFromAxisAngle(AXIS_Z, Math.max(-rollCap * dt, Math.min(rollCap * dt, angle)));
      q.multiply(_qRoll);
    }
    q.normalize();

    // --- thrust: local axis vector, rotated to world, added as acceleration ---
    const boosting = !!input.boost;
    const thrustMag = cfg.thrust * (boosting ? cfg.boostMult : 1);
    _thrustLocal.set(input.axis.x, input.axis.y, -input.axis.z);
    _thrustWorld.copy(_thrustLocal).applyQuaternion(q).multiplyScalar(thrustMag);
    // The same elapsed-time response for translation. For constant thrust,
    // both velocity and displacement match the original 60 Hz recurrence.
    // Integrate displacement as well as velocity: endpoint-velocity Euler
    // integration would otherwise reintroduce frame dependence after release.
    const linearBase = 1 - cfg.damping * h;
    if (cfg.damping > 0 && linearBase > 0) {
      const decay = Math.pow(linearBase, dt / h);
      const response = linearBase / cfg.damping;
      const driftTime = h * linearBase * (1 - decay) / (1 - linearBase);
      _motionVelocity.copy(this.velocity).multiplyScalar(driftTime / dt)
        .addScaledVector(_thrustWorld, response * (dt - driftTime) / dt);
      this.velocity.multiplyScalar(decay).addScaledVector(_thrustWorld, response * (1 - decay));
    } else if (linearBase <= 0) {
      _motionVelocity.set(0, 0, 0);
      this.velocity.set(0, 0, 0);
    } else {
      _motionVelocity.copy(this.velocity).addScaledVector(_thrustWorld, (dt + h) / 2);
      this.velocity.addScaledVector(_thrustWorld, dt);
    }

    // --- clamp speed ---
    const maxSpeed = cfg.maxSpeed * (boosting ? cfg.boostMult : 1);
    const speedSq = this.velocity.lengthSq();
    if (speedSq > maxSpeed * maxSpeed) {
      this.velocity.multiplyScalar(maxSpeed / Math.sqrt(speedSq));
      _motionVelocity.copy(this.velocity);
    }

    // --- energy regen ---
    this.energy = Math.min(cfg.energy, this.energy + cfg.energyRegen * dt);

    // --- integrate position with substepped SDF collision ---
    return this._integrateAndCollide(dt, _motionVelocity);
  }

  _integrateAndCollide(dt, motion = this.velocity) {
    const cfg = this.config.ship;
    const field = this.field;
    if (!field || this.noclip) {
      this.object3d.position.addScaledVector(motion, dt);
      return 0;
    }

    const speed = motion.length();
    const travel = speed * dt;
    const substeps = travel > cfg.radius ? Math.ceil(travel / cfg.radius) : 1;
    const subDt = dt / substeps;

    let maxImpactSpeed = 0;

    for (let s = 0; s < substeps; s++) {
      this.object3d.position.addScaledVector(motion, subDt);

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
        if (motion !== this.velocity) {
          motion.addScaledVector(_normal, -Math.min(0, motion.dot(_normal)) * (1 + cfg.bounce));
        }
      }
    }

    return maxImpactSpeed;
  }
}
