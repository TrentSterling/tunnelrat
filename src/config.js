// config.js : every tunable in one place. Feel-tuning happens here, not in module code.
// Also exports getBiome(depth): biome palette + noise + prop mix, cycling by depth
// (1=mine, 2=ice, 3=magma, 4=mine, ...). A biome carries: rockDeep, rockShallow
// (vertex color ramp), fog + fogDensity (main.js applies to scene fog/background),
// noiseAmp + noiseFreq (density field wall displacement), stone/crystal/ember prop
// colors and weights (procgen/props.js cluster mix).
export const CONFIG = {
  seed: 1337,

  world: {
    size: 240,            // cubic world extent in meters, centered on origin
    roomCount: 14,        // graph nodes
    roomMinDist: 34,      // min spacing between room centers
    roomRadius: [8, 18],  // carve radius range for rooms (spawn/reactor forced large)
    tunnelRadius: [4.2, 6.2], // roomier: most tunnels were reading too tight in play
    mouthFlare: 1.5,          // tunnel radius multiplier at room mouths, tapering over
    mouthFlareSpan: 0.25,     // ...the first/last 25% of the spline
    extraLoopEdges: 3,    // edges added back after MST for flank routes
    noiseAmp: 2.6,        // wall displacement amplitude (m) applied to carve surface
    noiseFreq: 0.09,      // primary 3d noise frequency
    voxelSize: 1.6,       // marching cubes cell size (m)
    chunk: 32,            // voxels per chunk axis
    // room shape variety (plain CAVE rooms only; mission rooms stay regular spheres)
    shaftFraction: 0.2,   // share of plain cave rooms carved as vertical shaft capsules
    cavernFraction: 0.1,  // share of plain cave rooms promoted to grand caverns
    cavernScale: 1.4,     // grand cavern radius multiplier
    shaftRadiusScale: 0.55, // shaft capsule radius = roomRadius * this
    shaftHalfLen: 1.0,    // shaft capsule segment half-length = roomRadius * this
  },

  props: {                // cave junk coverage (procgen/props.js); the rest stays BARE
    roomClusterChance: 0.4,   // share of plain cave rooms that get a junk cluster
    tunnelFeatureChance: 0.3, // share of cave tunnels that get 1-2 features
    builtCrateChance: 0.6,    // share of built rooms that get a crate/barrel stash
    builtPipeChance: 0.55,    // share of built corridors that get a wall pipe run
    maxPointLights: 3,        // hard cap on REAL PointLights from props (lamps)
    maxDrills: 2,             // abandoned drill rig centerpieces per level
  },

  built: {                // constructed (industrial) sections vs organic cave
    roomFraction: 0.25,   // share of non-reactor/exit rooms that get style 'built'
    edgeFraction: 0.35,   // target share of edges with style 'built'
    tunnelRadius: 5.2,    // ONE constant carve radius for every built corridor
    jitterScale: 0.25,    // spline jitter multiplier for built edges (locked edge = 0, dead straight)
    floorDrop: 0.45,      // built room floor plane at center.y - radius*floorDrop
    ribSpacing: 4,        // meters between corridor rib rings
    ribTube: 0.42,        // rib ring tube thickness
    stripSize: 0.3,       // light-strip box cross-section
    panelCount: [4, 8],   // wall panels per built room
    maxLights: 5,         // hard cap on new PointLights from decor (one per built room max)
  },

  ship: {
    thrust: 42,           // m/s^2 linear accel
    boostMult: 1.7,       // holding boost key
    damping: 1.6,         // velocity damping per second (descent-style drift)
    maxSpeed: 34,
    lookSpeed: 0.0022,    // rad per px mouse
    rollSpeed: 2.6,       // rad/s cap on Q/E
    rollAccel: 7.5,       // rad/s^2 while held (roll winds up, newtonian feel)
    rollDamping: 4.5,     // roll velocity bleed per second when released
    radius: 1.4,          // collision sphere
    bounce: 0.25,         // velocity reflect factor on hard impact
    shields: 100,
    energy: 100,
    energyRegen: 6,       // per second
  },

  weapons: {
    // aoe: every impact detonates; radius (m), damage at center (linear falloff to 0
    // at radius, direct-hit target excluded, it already took full damage), impulse
    // (m/s velocity shove at center, applies to EVERYTHING with a velocity incl. you)
    laser: { speed: 90, damage: 12, cooldown: 0.16, energyCost: 1.6, color: 0x5cff8a, radius: 0.35, life: 2.2,
      aoe: { radius: 2.6, damage: 4, impulse: 7 } },
    enemyBolt: { speed: 46, damage: 8, color: 0xff5a3b, radius: 0.4, life: 3.5,
      aoe: { radius: 2.6, damage: 4, impulse: 7 } },
    sniperBolt: { speed: 74, damage: 14, color: 0x7dff9a, radius: 0.35, life: 3.0,
      aoe: { radius: 2.0, damage: 5, impulse: 10 } },
    reactorBolt: { speed: 34, damage: 16, color: 0xffb13b, radius: 0.7, life: 5.0,
      aoe: { radius: 5.5, damage: 10, impulse: 16 } },
  },

  enemies: {
    // spawn table: [base count, added per depth beyond 1] per mobile class + turrets
    spawns: { grunt: [4, 2], claw: [2, 1], hulk: [1, 1], sniper: [1, 1], turret: [3, 1] },
    // mobile classes share the movement machinery; rangeNear/rangeFar = preferred band,
    // burst = shots per trigger pull, lead = aim lead factor (0 none, 1 full)
    // jink = lateral dodge-impulse magnitude (m/s) applied by enemies.js jink timer (0 disables)
    // fleeHpFrac = hp fraction (of max hp) below which grunt/sniper enter 'flee' (sticky, no regen)
    grunt:  { hp: 30, speed: 14, accel: 26, fireRange: 42, fireCooldown: 1.6, sightRange: 50, radius: 1.2, strafe: 8, bolt: 'enemyBolt', rangeNear: 12, rangeFar: 20, burst: 1, burstGap: 0, lead: 0.5, jink: 6, fleeHpFrac: 0.3 },
    hulk:   { hp: 95, speed: 8,  accel: 14, fireRange: 34, fireCooldown: 2.6, sightRange: 50, radius: 2.2, strafe: 4, bolt: 'enemyBolt', rangeNear: 9,  rangeFar: 24, burst: 3, burstGap: 0.15, lead: 0.4, jink: 3 },
    sniper: { hp: 20, speed: 12, accel: 22, fireRange: 58, fireCooldown: 2.8, sightRange: 70, radius: 1.2, strafe: 6, bolt: 'sniperBolt', rangeNear: 28, rangeFar: 44, burst: 1, burstGap: 0, lead: 1.0, jink: 11, fleeHpFrac: 0.3 },
    claw:   { hp: 26, speed: 22, accel: 40, fireRange: 0,  fireCooldown: 0,   sightRange: 60, radius: 1.3, strafe: 0, bolt: null, rangeNear: 0, rangeFar: 0, burst: 0, burstGap: 0, lead: 0, jink: 4,
              melee: 14, meleeCooldown: 1.0, meleeKnock: 14, enrageHpFrac: 0.3, enrageSpeedMult: 1.25, enrageMeleeCooldownMult: 0.5 },
    turret: { hp: 45, fireRange: 50, fireCooldown: 2.0, radius: 1.5 },
    reactor: { hp: 260, fireCooldown: 1.1, fireRange: 60, radius: 4.5 },
  },

  game: {
    escapeTime: 45,       // seconds after reactor pops (+5 per depth, capped 70)
    keyPickupDist: 4.5,
    doorRadius: 6,        // blocking disc radius while locked
    exitDist: 7,
    hitShake: 0.5,
  },

  colors: {
    rockDeep: 0x241d38, rockShallow: 0x8a6a45,   // vertex color gradient by depth
    fog: 0x05070a, fogDensity: 0.016,
    headlamp: 0xfff4d6,
    key: 0xffd23b, door: 0xff3b3b, doorOpen: 0x5cff8a, exit: 0x39d0ff, reactor: 0xff7a2f,
    // built-section decor (see procgen/decor.js)
    stripAmber: 0xffb13b, stripCyan: 0x39d0ff, stripRed: 0xff3b3b,
    ribMetal: 0x8a94a8, panelMetal: 0x5a6a80, trimMetal: 0x39424f, roomLight: 0xfff4d6,
  },

  // Biomes cycle by depth (see getBiome below). Each is a complete look: rock ramp,
  // fog, wall-noise character, and the prop mix for props.js.
  //   weights keys: stal (stalactites/stalagmites; icicles in ice), crystal (emissive
  //   ore octahedra), crates (crate+barrel stash), lamp (standing mining lamp),
  //   drill (abandoned drill rig centerpiece), ember (glowing floor ember veins).
  biomes: {
    mine: {   // the original brown look, depth 1, 4, 7, ...
      name: 'mine',
      rockDeep: 0x241d38, rockShallow: 0x8a6a45,
      fog: 0x05070a, fogDensity: 0.016,
      noiseAmp: 2.6, noiseFreq: 0.09,
      stone: 0x7a6a52, crystal: 0xffd23b, ember: 0xff9a3b,
      weights: { stal: 3, crystal: 3, crates: 3, lamp: 2, drill: 1.2, ember: 0 },
    },
    ice: {    // pale blue-grey rock, crisper walls (lower amp, higher freq), icicle-heavy
      name: 'ice',
      rockDeep: 0x101c33, rockShallow: 0x9fb6c9,
      fog: 0x0a1626, fogDensity: 0.013,
      noiseAmp: 1.6, noiseFreq: 0.145,
      stone: 0xcfe4f5, crystal: 0x39d0ff, ember: 0x9fdcff,
      weights: { stal: 6, crystal: 3, crates: 1.5, lamp: 1.5, drill: 0.8, ember: 0 },
    },
    magma: {  // near-black rock, warm shallow ramp, chunkier walls, glowing ember veins
      name: 'magma',
      rockDeep: 0x0c0709, rockShallow: 0x77341c,
      fog: 0x180a04, fogDensity: 0.022,
      noiseAmp: 3.2, noiseFreq: 0.062,
      stone: 0x4a2a20, crystal: 0xff7a2f, ember: 0xff5a1e,
      weights: { stal: 2, crystal: 3, crates: 1, lamp: 1, drill: 0.8, ember: 5 },
    },
  },
};

const BIOME_ORDER = ['mine', 'ice', 'magma'];

// depth 1 = mine, 2 = ice, 3 = magma, then the cycle repeats. Always returns a biome
// (bad/missing depth falls back to depth 1).
export function getBiome(depth) {
  const d = Math.max(1, Math.floor(Number.isFinite(depth) ? depth : 1));
  return CONFIG.biomes[BIOME_ORDER[(d - 1) % BIOME_ORDER.length]];
}
