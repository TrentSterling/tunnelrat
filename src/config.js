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
    reactorBolt: { speed: 34, damage: 16, color: 0xffb13b, radius: 0.7, life: 5.0 },
  },

  enemies: {
    dronesBase: 8,        // + 2 per depth
    turretsBase: 3,       // + 1 per depth
    drone: { hp: 30, speed: 14, accel: 26, fireRange: 42, fireCooldown: 1.4, sightRange: 55, radius: 1.2, strafe: 8 },
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
    rockDeep: 0x2a2433, rockShallow: 0x4a4438,   // vertex color gradient by depth
    fog: 0x05070a, fogDensity: 0.016,
    headlamp: 0xfff4d6,
    key: 0xffd23b, door: 0xff3b3b, doorOpen: 0x5cff8a, exit: 0x39d0ff, reactor: 0xff7a2f,
  },
};
