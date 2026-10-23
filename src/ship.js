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
//   Rotation, thrust and sphere collision use fixed 1/240 s steps, with an
//   immediate partial-tick pose preview for rendering and externally writable state.
//   Energy regen: energyRegen * dt up to max.
//
// Collision (SDF sphere, robust at 34 m/s vs voxelSize 1.6):
//   After integration, do up to 12 resolution iterations:
//     d = field.sample(pos); if d > -config.ship.radius (wall closer than radius):
//       n = field.collisionNormal(pos); push pos along n by (d + radius) (i.e. out of
//       the wall); remove velocity component INTO the wall: v -= n * min(0, v.dot(n))
//       * (1 + bounce). Track pre-resolve normal speed; if > 6 call onImpact(speed)
//       at most once per outer update. Damage is accounted once per fixed tick.
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
const TICK = 1 / 240;
const motionState = () => ({ position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), velocity: new THREE.Vector3(), rollVel: 0 });
function readMotion(ship, state) {
  state.position.copy(ship.object3d.position); state.quaternion.copy(ship.object3d.quaternion);
  state.velocity.copy(ship.velocity); state.rollVel = ship.rollVel;
}
function writeMotion(ship, state) {
  ship.object3d.position.copy(state.position); ship.object3d.quaternion.copy(state.quaternion);
  ship.velocity.copy(state.velocity); ship.rollVel = state.rollVel;
}
function commitImpact(ship, speed) {
  ship._frameImpact = Math.max(ship._frameImpact, speed);
  if (speed > 6) ship.takeDamage((speed - 6) * .8);
}

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
    this._anchor = motionState(); this._published = motionState();
    this._pending = { time: 0, x: 0, y: 0, z: 0, roll: 0, mouseDX: 0, mouseDY: 0, boost: false };
    this._tickInput = { axis: { x: 0, y: 0, z: 0, roll: 0 }, mouseDX: 0, mouseDY: 0, boost: false, thrustScale: 1 };
    this._clockReady = false; this._previewImpact = 0;
  }

  reset(pos, quat) {
    this.object3d.position.copy(pos);
    this.object3d.quaternion.copy(quat);
    this.velocity.set(0, 0, 0);
    this.rollVel = 0;
    this.shields = this.config.ship.shields;
    this.energy = this.config.ship.energy;
    this.alive = true;
    this._clockReady = false;
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
    const p = this._pending, last = this._published;
    this._frameImpact = 0;
    // GameState doors, weapon impulses, cheats and level swaps can write the
    // public pose/velocity. Rebase from that result, never restore over it.
    const edited = !last.position.equals(this.object3d.position) || !last.quaternion.equals(this.object3d.quaternion)
      || !last.velocity.equals(this.velocity) || last.rollVel !== this.rollVel
      || this._clockField !== this.field || this._clockNoclip !== this.noclip;
    if (!this._clockReady || edited) {
      if (this._clockReady) commitImpact(this, this._previewImpact);
      readMotion(this, this._anchor); this._clearPending(); this._clockReady = true;
    }
    writeMotion(this, this._anchor);
    let remaining = dt;
    while (remaining > 1e-12 && this.alive) {
      const chunk = Math.min(remaining, TICK - p.time), fraction = chunk / dt;
      const thrustScale = input.boost ? this.config.ship.boostMult : 1;
      p.x += input.axis.x * thrustScale * chunk; p.y += input.axis.y * thrustScale * chunk;
      p.z += input.axis.z * thrustScale * chunk; p.roll += input.axis.roll * chunk;
      p.mouseDX += input.mouseDX * fraction; p.mouseDY += input.mouseDY * fraction;
      p.boost ||= !!input.boost; p.time += chunk; remaining -= chunk;
      if (p.time >= TICK - 1e-12) {
        commitImpact(this, this._step(TICK, this._pendingInput(), 1));
        readMotion(this, this._anchor); this._clearPending();
      }
    }
    // Evaluate the unfinished tick for a fresh camera/aim pose. It is recomputed
    // from its anchor next frame, so render boundaries never become contact steps.
    // Preview contacts do not deal damage; completed ticks account for each impact
    // exactly once. The callback retains the maximum speed once per outer update.
    this._previewImpact = p.time > 1e-12 && this.alive ? this._step(p.time, this._pendingInput(), 1) : 0;
    this.energy = Math.min(this.config.ship.energy, this.energy + this.config.ship.energyRegen * dt);
    readMotion(this, this._published); this._clockField = this.field; this._clockNoclip = this.noclip;
    if (this._frameImpact > 6 && this.onImpact) this.onImpact(this._frameImpact);
  }

  _clearPending() {
    const p = this._pending;
    p.time = p.x = p.y = p.z = p.roll = p.mouseDX = p.mouseDY = 0; p.boost = false;
    this._previewImpact = 0;
  }

  _pendingInput() {
    const p = this._pending, input = this._tickInput;
    input.axis.x = p.x / p.time; input.axis.y = p.y / p.time;
    input.axis.z = p.z / p.time; input.axis.roll = p.roll / p.time;
    input.mouseDX = p.mouseDX; input.mouseDY = p.mouseDY; input.boost = p.boost;
    return input;
  }

  // No game persistence exists yet. This explicit JSON-safe flight snapshot also
  // preserves the unfinished tick, rather than silently dropping its history.
  captureFlightState() {
    const encode = s => ({ position: s.position.toArray(), quaternion: s.quaternion.toArray(), velocity: s.velocity.toArray(), rollVel: s.rollVel });
    const current = motionState(); readMotion(this, current);
    return { ...encode(current), shields: this.shields, energy: this.energy, alive: this.alive, noclip: this.noclip,
      integration: { ready: this._clockReady, anchor: encode(this._anchor), published: encode(this._published),
        pending: { ...this._pending }, previewImpact: this._previewImpact } };
  }

  restoreFlightState(state) {
    const decode = (value, target) => {
      target.position.fromArray(value.position); target.quaternion.fromArray(value.quaternion);
      target.velocity.fromArray(value.velocity); target.rollVel = value.rollVel;
    };
    decode(state, this._published); writeMotion(this, this._published);
    for (const key of ['shields', 'energy', 'alive', 'noclip']) this[key] = state[key];
    const tick = state.integration;
    this._clockReady = !!tick?.ready;
    if (tick) {
      decode(tick.anchor, this._anchor); decode(tick.published, this._published);
      Object.assign(this._pending, tick.pending); this._previewImpact = tick.previewImpact;
    }
    this._clockField = this.field; this._clockNoclip = this.noclip;
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
    const thrustMag = cfg.thrust * (input.thrustScale ?? (boosting ? cfg.boostMult : 1));
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

      for (let i = 0; i < 12; i++) {
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
