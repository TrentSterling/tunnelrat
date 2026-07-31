# TUNNELRAT : feature bible + moonshot ledger

Trent's 2026-07-31 brainstorm, folded into the working roadmap. The rule stays:
keep shipping simple stuff, pull items down in order. Buddy bot is WANTED, not
a maybe.

## Committed next (in rough order)

0. **Combat feel core: AoE + knockback.** EVERY projectile impact (wall or
   target) spawns an explosion with area damage falloff and a velocity impulse:
   lasers small energy pops, missiles room-clearers, plasma the heavy shover.
   Splash hits everything in radius including the player (classic self-splash).
   Enemies and ship both take impulse into their velocity integrators.
0b. **The Matrix view.** Debug visualization layer, OG CRT aesthetic (additive
   green/cyan wireframe, not gizmo soup), toggled via console MATRIX or F3:
   collision spheres (ship, bots, projectiles), enemy sight cones colored by AI
   state (patrol dim, chase red), the room graph as living navmesh with drone
   paths as running light pulses, firing LOS rays, door blocking disc, AoE
   radius ghosts, chase-cam wall probe. Everything the game computes gets a
   pretty visible form.

1. **Hangar / tech tree screen.** XP spending menu at DEPTH CLEARED: three
   offered upgrades per depth across Thrust (strafe accel, top speed, drift),
   Systems (shield cap, energy regen, magnet radius, headlamp range), Weapons
   (damage, energy efficiency, lock-on speed). XP already flows from corpse
   runs and will flow from kills + hostages.
2. **Secondary weapons on right-click.** Concussion rockets (dumbfire, splash),
   then homing missiles (lock-on), proximity mines (dropped behind thrusters
   while fleeing claw bots), smart missiles (submunition burst). Ammo-based,
   found as pickups.
   - **Missile-cam family** (one PiP render-pass system, per-missile behavior):
     homing = fire-and-forget heat seeker whose nose-cam feed plays READ-ONLY
     in the PiP (fly-by-wire theater, no control burden); guided (TV) = the
     Descent 2 manual one, mouse steers the missile while the ship coasts;
     DOOMSDAY = slow ponderous heavy seeker, the cam star, watch the feed
     cruise three corners before the room shakes; swarm = Freespace-style
     6-8 weak seekers ripple-fired in a corkscrew spread, no cams, tunnel
     chaos. Static burst on impact; fullscreen feed toggle for the brave.
3. **Buddy bot (G).** Companion drone deploys from the ship: flies ahead down
   dark tunnels with its own spotlight, marks the nearest objective (key, door,
   reactor, exit), points at secret doors, chirps. Descent 2 guidebot energy.
4. **Energy centers.** Glowing amber recharge booths in built corridors; hover
   inside to refill energy to 100. Later: converter upgrade (energy to shields).
5. **Matcens.** Wall portals with red grid energy that materialize fresh robots
   when alarmed; exposed power conduit on the ceiling kills them permanently.
6. **Dev cheat console (tilde).** Green CRT drop-down terminal, classic codes:
   GOD, GIVEALL, NOCLIP, FRAMES (fps + frametime graph), SLOMO n, SPAWN bot,
   MAPALL, WARP depth. GABBAGABBAHEY accepted as god alias, obviously.
7. **Flares (F).** Magnesium flare launched down dark shafts: point light +
   glow sprite, gravityless drift, burns ~20s, cheap pool.
8. **Intermission screen.** Doom-style tally on depth clear: kills percent,
   hostages saved, secrets found, escape time left, S/A/B/C efficiency, bonus
   XP for full clears.

## Second wave

- **Primary weapon quintet.** Laser L1-L4 + quad upgrade, vulcan (ammo based,
  hitscan stream, works when energy is dry), spreadfire (corridor sweeper),
  plasma (heavy knockback), fusion (chargeable, self-damage on overhold).
  Weapon select 1-5, ammo/energy split per the classics.
- **Hostages in cryo-pods.** Glass tubes in vents and behind secret walls;
  shoot the glass, scoop the miner, big XP + intermission line.
- **Destructible secret walls.** Crumbly rock with visible cracks; missiles or
  lasers blow them open to cache rooms (upgrades, hostages, XP). Field supports
  it: subtract a carve sphere at runtime + re-polygonize the touched chunks.
- **Destructible lights + blackouts.** Shoot out decor fixtures to kill a room's
  light; reactor damage triggers mine-wide blackout events where headlamp and
  flares carry.
- **PiP rear-view mirror.** Small CRT inset rendering a rear camera; essential
  against tail-chasing claws and homers.
- **Cockpit frame + CRT filter toggle.** 3d cockpit glass, dials, thruster
  G-force indicators; optional scanline/chromatic aberration post pass.
- **Forcefield grids.** Translucent barriers gated on a shootable generator
  node; lockdown variants during reactor escape.
- **Ship frames.** Pyro-GX scout vs heavy gunship hulls: different thrust,
  shield, hardpoint counts. Hangar picks the frame.

## Model pipeline moonshot: parametric CSG to one draw call

Keep the part-recipe brains, upgrade the output. Ladder:
1. Merge-bake (near): bake each robot recipe into ONE BufferGeometry at spawn
   (material colors to vertex colors, single shared material); ~40 draw calls
   per bot becomes 1. No CSG required; three's mergeGeometries does it.
2. CSG solids (mid): recipes become union/subtract programs (csg.js BSP style;
   prior art in SAMPLES_CSG_REF + runtimecsg): carved bolt holes, panel insets,
   weapon ports, battle-damage bites. Simple box-projected textures on top.
3. Condense (far): CSG output welded, simplified, retopo'd to clean chunky low
   poly with recomputed flat normals, still one mesh one draw call. Parametric
   smart going in, dumb-fast coming out; same philosophy as the cave pipeline.
Also feeds capitals/stations later: hull = CSG of big primitives, trenches and
docking bays subtracted, then condensed.

## The Freespace frontier

- Galaxy map mission select (mining outpost, asteroid field, derelict capital
  ship, planet surface base), branching routes, modifiers per node.
- Open-space arenas + trench runs: fly into a cruiser docking bay, kill its
  reactor, fly out into the fleet fight. Same ship, same controller.
- TTS mission control via the local GPU stack (Kokoro, GLaDOS pipeline):
  briefings, objective updates, reactor countdown, wingman barks.
- Nebula rendering, sensor ghosts, lightning; full-size capitals + stations as
  scaled part-recipes with subsystem targeting; planet backdrop tech.
- Multiplayer: Trystero P2P co-op corpse runs first, deathmatch later.
  Campfire on crack.

## Standing constraints

Single repo, no build step, chunky flat-shaded low poly + nearest-neighbor
grunge + vertex color lighting. Unity/Synty port stays a separate decision;
nothing here should block it.
