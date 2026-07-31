# TUNNELRAT : design (v0.1 vertical slice)

Procgen 6DOF Descent-clone in Three.js. One seeded level, full loop:
spawn, explore, grab keycard, unlock door, kill reactor, escape before detonation,
reach exit, next depth with harder params. Approved 2026-07-31.

## Generation (graph + marching cubes hybrid)

1. Graph layout: 14 room points scattered in a 240m cube (min spacing), k-nearest
   edges, MST, 3 loop edges added back.
2. Mission on the graph before geometry: BFS-farthest node from spawn = reactor;
   last critical-path edge = locked door; key in a branch reachable without the door;
   exit node near the reactor neighborhood. Solvable by construction.
3. Density field: solid rock, carve spheres at rooms + capsules along jittered
   Catmull-Rom splines per edge, simplex noise on the carve surface for organic walls.
   Sign convention: negative = air, positive = rock, approx signed distance.
4. Marching cubes over 32^3 chunks (1.6m voxels), vertex colors by depth.
5. The field doubles as physics: SDF sphere collision + gradient normals + raymarch LOS.
   The graph doubles as mission DAG + AI pathfinding + automap.

## Systems

- Ship: pointer-lock mouse pitch/yaw, Q/E roll, WASD + R/F strafe, Shift boost.
  Newtonian velocity + damping, substepped SDF collision with wall slide.
- Combat: pooled projectiles; drones (patrol/chase/strafe, graph A*, half-lead aim),
  wall turrets (LOS + cooldown), reactor boss (fires back, death starts escape).
- Loop: GameState phase machine (playing, escape, dead, won); 45s escape timer
  (+5s per depth, cap 70); die = retry same seed, win = seed+1 depth+1.
- UX: DOM HUD (shields, energy, key, objective, timer), Tab wireframe automap from
  the graph (visited-only reveal), WebAudio procedural sfx, red strobe escape fx.

## Structure

index.html + src/ ESM, Three.js 0.179 via esm.sh import map, no build step.
Module contracts live as JSDoc headers in each src file; main.js is the only place
modules meet. tools/serve.mjs (static server) + tools/shoot.mjs (CDP screenshot +
console capture) for automated verification. Debug API window.TR for smoke tests.

## Out of scope v0.1

Multiple weapons, powerups, more enemy types, biome wings, dynamic hazards,
music, saving, multiplayer, Unity/Synty port.
