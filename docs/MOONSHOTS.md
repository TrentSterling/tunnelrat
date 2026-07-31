# TUNNELRAT : moonshot ledger

Design targets beyond the vertical slice, roughly ordered by distance. The rule
stays the same: keep shipping the simple stuff, pull one of these down when a
night wants a bigger swing. Logged 2026-07-31 after the first real playtests.

## Near (next few sessions)

- **XP + upgrades.** XP orbs exist (corpse runs pay out). Spend XP between depths:
  shield cap, energy regen, laser damage, thruster accel. Simple picker screen at
  the DEPTH CLEARED overlay, three choices per depth, roguelite style.
- **Tech tree.** The upgrade picker grows branches: weapons (vulcan spread, homing
  missiles, fusion charge shot), hull (armor, ram damage for claw-style play),
  systems (headlamp range, automap range, orb magnet radius).
- **More robot variety.** 2-3 hull recipes per class in robots.js, mini-boss
  variants (elite palettes, double size, modified AI params), death debris chunks.
- **Bestiary.** OG-style green-terminal robot dossier screen, procgen flavor text,
  unlocked per first kill. The wiki screenshots are the art direction.
- **OG study pass.** Play/watch Descent 1 footage, steal: reactor room layouts,
  hostage rescue side objective, cloaked robots, matcen spawn rooms, red alert
  escape lighting.

## Mid

- **Map types.** Same graph+field pipeline, different carve params + palettes:
  ice caverns (blue, slick walls, low damping), lava tubes (orange glow pools,
  heat damage zones), built station interiors (WFC-ish box rooms, right angles).
- **Galaxy map.** Level select between depths: a starfield of mining sites, each
  node = seed + biome + modifiers, pick your route, roguelite branching.
- **Freespace mission type.** Open-space arenas in the same prototype: no cave,
  giant skybox, waypoint escort/assault missions, same ship, same weapons. The
  6DOF controller already does everything a Freespace fight needs.
- **Multiplayer.** Trystero P2P like campfire, co-op corpse runs first (2-4
  pilots, shared level seed, shared reactor objective), deathmatch later.
  Campfire on crack.

## Far

- **TTS voicelines.** The local GPU TTS stack (Kokoro, GLaDOS pipeline) batch
  generates mission control chatter: briefings, keycard confirms, reactor
  countdown, wingman barks. Full Freespace 1/2 energy, zero recording cost.
- **Nebula rendering.** Volumetric-ish layered billboards + fog tricks for
  Freespace 2 nebula missions, sensor ghosts, lightning.
- **Capital ships + stations.** Full-size destroyers and mining stations as
  procgen part-recipes (robots.js scaled up), subsystem targeting, turret farms,
  trench runs along hulls.
- **Planet tech.** Orbit-to-surface backdrop rendering for the galaxy map and
  mission intros, atmosphere shells, day/night terminator.

## Standing constraints

Keep it single-repo, no build step, prototype graphics (chunky low poly, light
grunge, vertex color + lighting). Unity + Synty port stays a separate future
decision; nothing here should block it.
