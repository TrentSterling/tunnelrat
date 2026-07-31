// config.js : every tunable in one place. Feel-tuning happens here, not in module code.
export const CONFIG = {
  seed: 1337,

  world: {
    size: 240,            // cubic world extent in meters, centered on origin
    roomCount: 14,        // graph nodes
    roomMinDist: 34,      // min spacing between room centers
    roomRadius: [8, 18],  // carve radius range for rooms (spawn/reactor forced large)
    tunnelRadius: [3.2, 5.0],
    extraLoopEdges: 3,    // edges added back after MST for flank routes
    noiseAmp: 2.6,        // wall displacement amplitude (m) applied to carve surface
    noiseFreq: 0.09,      // primary 3d noise frequency
    voxelSize: 1.6,       // marching cubes cell size (m)
    chunk: 32,            // voxels per chunk axis
  },

  ship: {
    thrust: 42,           // m/s^2 linear accel
    boostMult: 1.7,       // holding boost key
    damping: 1.6,         // velocity damping per second (descent-style drift)
    maxSpeed: 34,
    lookSpeed: 0.0022,    // rad per px mouse
    rollSpeed: 2.4,       // rad/s on Q/E
    radius: 1.4,          // collision sphere
    bounce: 0.25,         // velocity reflect factor on hard impact
    shields: 100,
    energy: 100,
    energyRegen: 6,       // per second
  },

  weapons: {
    laser: { speed: 90, damage: 12, cooldown: 0.16, energyCost: 1.6, color: 0x5cff8a, radius: 0.35, life: 2.2 },
    enemyBolt: { speed: 46, damage: 9, color: 0xff5a3b, radius: 0.4, life: 3.5 },
    sniperBolt: { speed: 74, damage: 14, color: 0x7dff9a, radius: 0.35, life: 3.0 },
    reactorBolt: { speed: 34, damage: 16, color: 0xffb13b, radius: 0.7, life: 5.0 },
  },

  enemies: {
    // spawn table: [base count, added per depth beyond 1] per mobile class + turrets
    spawns: { grunt: [5, 2], claw: [2, 1], hulk: [1, 1], sniper: [1, 1], turret: [3, 1] },
    // mobile classes share the movement machinery; rangeNear/rangeFar = preferred band,
    // burst = shots per trigger pull, lead = aim lead factor (0 none, 1 full)
    grunt:  { hp: 30, speed: 14, accel: 26, fireRange: 42, fireCooldown: 1.4, sightRange: 55, radius: 1.2, strafe: 8, bolt: 'enemyBolt', rangeNear: 12, rangeFar: 20, burst: 1, burstGap: 0, lead: 0.5 },
    hulk:   { hp: 95, speed: 8,  accel: 14, fireRange: 34, fireCooldown: 2.6, sightRange: 50, radius: 2.2, strafe: 4, bolt: 'enemyBolt', rangeNear: 9,  rangeFar: 24, burst: 3, burstGap: 0.15, lead: 0.4 },
    sniper: { hp: 20, speed: 12, accel: 22, fireRange: 58, fireCooldown: 2.8, sightRange: 70, radius: 1.2, strafe: 6, bolt: 'sniperBolt', rangeNear: 28, rangeFar: 44, burst: 1, burstGap: 0, lead: 1.0 },
    claw:   { hp: 26, speed: 22, accel: 40, fireRange: 0,  fireCooldown: 0,   sightRange: 60, radius: 1.3, strafe: 0, bolt: null, rangeNear: 0, rangeFar: 0, burst: 0, burstGap: 0, lead: 0,
              melee: 14, meleeCooldown: 1.0, meleeKnock: 14 },
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
  },
};
