// weapons.js : pooled projectiles for player + enemies, wall hits via density field.
//
// CONTRACT (implement exactly):
//
// class ProjectileSystem {
//   constructor(scene, field, config)
//   spawn(owner, pos:Vector3, dir:Vector3 unit, kind)
//     owner: 'player' | 'enemy'
//     kind:  'laser' | 'enemyBolt' | 'reactorBolt' (keys into config.weapons)
//   update(dt, ctx) where ctx = {
//     enemies,        // EnemyManager: iterate ctx.enemies.list() -> { pos, radius, takeDamage(n), alive }
//     ship,           // Ship (pos = ship.object3d.position, radius config.ship.radius)
//     onShipHit: (damage) => void,     // main wires: sfx + hud flash + shake
//     onEnemyHit: (enemy, damage) => void,
//     onWallHit: (pos) => void,
//   }
//   clear()          // despawn all (level transition)
// }
//
// Behavior per projectile per frame: move pos += dir*speed*dt; life -= dt.
//   Wall: field.sample(pos) >= 0 -> onWallHit, despawn.
//   Player bolts test vs enemies (sphere dist < radius+enemy.radius): enemy.takeDamage,
//   onEnemyHit, despawn. Enemy bolts test vs ship: onShipHit(damage), despawn.
//   life <= 0 -> despawn.
// Visuals: pool of ~128 reusable meshes (small elongated box or capsule-ish, oriented
//   along dir, MeshBasicMaterial with the kind's color, plus an additive-blended
//   slightly larger transparent shell for glow). NO per-shot allocations after pool
//   warmup; hide despawned via .visible=false.
// One shared PointLight (color per last player shot) is OPTIONAL; skip if simpler.
import * as THREE from 'three';

export class ProjectileSystem {
  constructor(scene, field, config) {
    throw new Error('NOT IMPLEMENTED: ProjectileSystem');
  }
}
