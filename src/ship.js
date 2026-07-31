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

export class Ship {
  constructor(config, field) {
    throw new Error('NOT IMPLEMENTED: Ship');
  }
}
