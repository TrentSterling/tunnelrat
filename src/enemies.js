// enemies.js : drones (patrol/chase/strafe), wall turrets, and the reactor boss.
//
// CONTRACT (implement exactly):
//
// class EnemyManager {
//   constructor(scene, config)
//   populate(graph, field, projectiles, seed, depth)
//     // clears previous, spawns dronesBase + 2*depth drones, turretsBase + depth
//     // turrets, 1 reactor in the reactor room. Uses makeRng(seed ^ 0xBEEF).
//     // Drones spawn at random non-spawn, non-exit nodes (jitter inside room, keep
//     //   field.sample < -drone.radius). Never within 2 hops of spawn node.
//     // Turrets: pick random room nodes (not spawn/exit), raycast from node center in a
//     //   random direction to a wall (field.raycast), plant on hit point, oriented
//     //   with +Y along the collision normal.
//     // Reactor: at reactor node center; big emissive octahedron + spin.
//   update(dt, ship, field, graph)   // all AI; fires via the ProjectileSystem given in populate
//   list() -> array of { pos:Vector3, radius, alive, takeDamage(n) }  // includes reactor
//     while alive; the reactor entry additionally has isReactor:true (main.js debug uses it)
//   reactorAlive: boolean
//   onReactorDestroyed: null | () => void
//   onEnemyKilled: null | (enemy) => void   // for sfx/explosion fx (main wires)
//   clear()
// }
//
// Drone AI (state machine per drone):
//   PATROL: drift between its node and random neighbors (findPath not needed: pick
//     random neighbor node, steer to its center, repeat). Speed 40% of max.
//   CHASE: trigger when dist(ship) < sightRange AND field.raycast(dronePos ->
//     dirToShip, dist) === -1 (clear LOS). A* / BFS via findPath(graph,
//     nearestNodeId(drone), nearestNodeId(ship)) every ~1s (stagger by drone index,
//     NOT all on the same frame); steer toward next path node center, or straight at
//     ship when LOS is clear. Maintain 12-20m preferred range, strafe perpendicular
//     (sin of per-drone phase) while in range.
//   FIRE: in CHASE with LOS and dist < fireRange, cooldown timer: spawn 'enemyBolt'
//     aimed at ship.pos + ship.velocity * (dist/boltSpeed) * 0.5 (half lead: dodgeable).
//   Movement is velocity-based with accel toward desired dir, damping 2.0/s; collide
//   vs field with same push-out trick as ship (1 iteration is fine).
//   Visuals: cheap geometric hulls, MeshLambertMaterial flat colors + small emissive;
//   e.g. octahedron body + ring. Face velocity direction.
//
// Turret AI: static; if LOS to ship and dist < fireRange: slerp aim, fire on cooldown.
//   Visual: short cylinder base + box barrel, barrel lookAt ship when active.
//
// Reactor: spins; if LOS and dist < fireRange fires 'reactorBolt' at ship (no lead)
//   on cooldown. takeDamage flashes its emissive. On death: alive=false, call
//   onReactorDestroyed(), leave a dimming husk mesh.
import * as THREE from 'three';
import { makeRng, randRange, randInt, pick } from './util/rng.js';
import { findPath, nearestNodeId } from './procgen/graph.js';

export class EnemyManager {
  constructor(scene, config) {
    throw new Error('NOT IMPLEMENTED: EnemyManager');
  }
}
