// gamestate.js : mission logic + objective props (key, door, exit beacon). Owns the
// phase machine; main.js reads phase and wires transitions to hud/sfx.
//
// CONTRACT (implement exactly):
//
// class GameState {
//   constructor(scene, config)
//   phase: 'playing' | 'escape' | 'dead' | 'won'
//   hasKey: boolean
//   escapeRemaining: number    // seconds, only meaningful in 'escape'
//   depth: number
//
//   startLevel(graph, field, depth)  // builds objective props into scene:
//     // KEY: spinning gold octahedron + point light at key node center (bob slowly)
//     // DOOR: glowing red disc/hex barrier mesh centered on the locked edge's tunnel:
//     //   position = midpoint of lockedEdge node positions projected: use the point on
//     //   the edge polyline nearest the reactor-side node minus 6m... SIMPLE RULE:
//     //   place at the locked edge midpoint, oriented so its plane normal = edge
//     //   direction (a.pos - b.pos normalized). Radius config.game.doorRadius. Double
//     //   sided, pulsing emissive, slow spin.
//     // EXIT: cyan beacon (cone + light) at exit node, dim until 'escape' phase then bright + strobe.
//   update(dt, ship) -> events: array of strings emitted THIS frame, any of:
//     'keyPickup' | 'doorOpen' | 'doorBlocked' | 'escapeStart' | 'escaped' | 'died' | 'timeUp'
//     // keyPickup: dist(ship, key) < keyPickupDist -> hasKey=true, hide key mesh
//     // door: while locked, if ship sphere intersects door disc plane within
//     //   doorRadius: push ship out along the disc normal (matching side), zero the
//     //   into-plane velocity; emit 'doorBlocked' at most once per second while shoving.
//     //   If hasKey and dist(ship, door) < doorRadius + 4: unlock (emit 'doorOpen',
//     //   fade the barrier out over 1s, stop blocking, tell automap via main).
//     // NOTE: while locked the door must ALSO block enemy/player bolts? NO: keep it
//     //   simple, bolts pass, only the ship is blocked.
//     // 'died': ship.alive false (watch it here so main has one place to poll)
//   reactorDestroyed()   // called by main when EnemyManager fires onReactorDestroyed:
//     // phase='escape', escapeRemaining = min(escapeTime + 5*(depth-1), 70), emits
//     // 'escapeStart' from next update; in escape, timer counts down: 0 -> kill ship
//     // (emit 'timeUp' + 'died'); reaching exit (dist < exitDist) -> phase='won', 'escaped'.
//   clearProps()         // remove key/door/exit meshes (level transition)
// }
//
// Keep all THREE objects internal; expose doorMesh position readonly if trivially easy
// (automap does not need it). Deterministic prop placement (no rng needed).
import * as THREE from 'three';

export class GameState {
  constructor(scene, config) {
    throw new Error('NOT IMPLEMENTED: GameState');
  }
}
