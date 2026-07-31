// main.js : bootstrap + game loop + all cross-module wiring. Modules never import each
// other's instances; everything meets here.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { buildLevel } from './procgen/levelbuilder.js';
import { nearestNodeId } from './procgen/graph.js';
import { Input } from './input.js';
import { Ship } from './ship.js';
import { ProjectileSystem } from './weapons.js';
import { EnemyManager } from './enemies.js';
import { HUD } from './hud.js';
import { Automap } from './automap.js';
import { GameState } from './gamestate.js';
import { sfx } from './sfx.js';
import { buildRobot } from './robots.js';
import { makeRng } from './util/rng.js';

const app = document.getElementById('app');
const loadingEl = document.getElementById('loading');
const loadStatusEl = document.getElementById('loadStatus');

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping; // tames headlamp blowout on near walls
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(CONFIG.colors.fog);
scene.fog = new THREE.FogExp2(CONFIG.colors.fog, CONFIG.colors.fogDensity);
scene.add(new THREE.AmbientLight(0x404060, 0.35));
scene.add(new THREE.HemisphereLight(0x3a4a66, 0x33241a, 0.5)); // subtle shape fill so walls read as 3d

const camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.1, 400);
const camRig = new THREE.Group(); // shake offsets go here, camera stays at rig origin
camRig.add(camera);

const headlamp = new THREE.SpotLight(CONFIG.colors.headlamp, 320, 95, Math.PI / 4.2, 0.55, 1.55);
headlamp.position.set(0, 0, 0.5);
headlamp.target.position.set(0, 0, -10);
camera.add(headlamp, headlamp.target);

const strobe = new THREE.PointLight(0xff2020, 0, 120); // escape-phase red strobe
scene.add(strobe);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- systems ----------
const input = new Input(app);
const hud = new HUD(document.getElementById('hud'));
let ship = null;
let level = null;       // { graph, field, caveGroup, spawnPos, spawnQuat }
let projectiles = null;
let enemies = null;
let gamestate = null;
let automap = null;

let seed = CONFIG.seed;
let depth = 1;
let fireCooldown = 0;
let shake = 0;
let alarmTimer = 0;
let mapPollTimer = 0;

function disposeLevel() {
  if (!level) return;
  scene.remove(level.caveGroup);
  level.caveGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  projectiles?.clear();
  enemies?.clear();
  gamestate?.clearProps();
}

function loadLevel(newSeed, newDepth) {
  disposeLevel();
  seed = newSeed; depth = newDepth;
  loadingEl.style.display = 'flex';
  loadStatusEl.textContent = 'DESCENDING TO DEPTH ' + depth + '...';

  setTimeout(() => { // let the loading screen paint before the synchronous build
    level = buildLevel(seed, CONFIG, (f) => {
      loadStatusEl.textContent = 'CARVING ' + Math.round(f * 100) + '%';
    });
    scene.add(level.caveGroup);

    if (!ship) {
      ship = new Ship(CONFIG, level.field);
      ship.object3d.add(camRig);
      scene.add(ship.object3d);
    } else {
      ship.field = level.field;
    }
    ship.reset(level.spawnPos.clone(), level.spawnQuat.clone());

    projectiles = new ProjectileSystem(scene, level.field, CONFIG);
    if (!enemies) enemies = new EnemyManager(scene, CONFIG);
    enemies.populate(level.graph, level.field, projectiles, seed, depth);
    enemies.onReactorDestroyed = onReactorDestroyed;
    enemies.onEnemyKilled = () => sfx.play('explode');
    enemies.onShipMelee = (dmg) => {
      ship.takeDamage(dmg);
      hud.flashDamage();
      sfx.play('hitWall');
      shake = Math.min(1.2, shake + CONFIG.game.hitShake * 1.5);
    };

    if (!gamestate) gamestate = new GameState(scene, CONFIG);
    gamestate.startLevel(level.graph, level.field, depth);

    if (!automap) automap = new Automap(level.graph);
    else automap.rebuild(level.graph);
    automap.setCaveMesh(level.caveGroup);
    automap.visit(level.graph.spawnId);

    ship.onImpact = (speed) => { sfx.play('hitWall'); shake = Math.min(1, shake + speed * 0.03); };

    hud.setDepth(depth);
    hud.setKey(false);
    hud.setObjective('FIND THE KEYCARD');
    hud.setTimer(null);
    hud.showDeath(false);
    hud.showWin(false, depth);
    strobe.intensity = 0;
    alarmTimer = 0;

    loadingEl.style.display = 'none';
    window.TR.ready = true;
  }, 60);
}

function onReactorDestroyed() {
  gamestate.reactorDestroyed();
  sfx.play('bigExplode');
  shake = 1.5;
}

// ---------- gameplay event routing ----------
function handleEvents(events) {
  for (const ev of events) {
    if (ev === 'keyPickup') { sfx.play('pickup'); hud.setKey(true); hud.message('KEYCARD ACQUIRED'); hud.setObjective('UNLOCK THE SECURITY DOOR'); automap.setKeyTaken(); }
    else if (ev === 'doorBlocked') { sfx.play('thrum'); hud.message('LOCKED: KEYCARD REQUIRED', 1200); }
    else if (ev === 'doorOpen') { sfx.play('unlock'); hud.message('SECURITY DOOR OPEN'); hud.setObjective('DESTROY THE REACTOR'); automap.setDoorOpen(true); }
    else if (ev === 'escapeStart') { hud.message('REACTOR CRITICAL: GET OUT', 3200); hud.setObjective('REACH THE EXIT BEACON'); }
    else if (ev === 'escaped') { sfx.play('win'); hud.setTimer(null); hud.showWin(true, depth); strobe.intensity = 0; }
    else if (ev === 'died') { sfx.play('die'); hud.showDeath(true); }
  }
}

// ---------- loop ----------
const clock = new THREE.Clock();

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!level || !window.TR.ready) return;

  const phase = gamestate.phase;

  if (phase === 'playing' || phase === 'escape') {
    ship.update(dt, input);

    // firing
    fireCooldown -= dt;
    const W = CONFIG.weapons.laser;
    if (input.fire && fireCooldown <= 0 && ship.alive && ship.spendEnergy(W.energyCost)) {
      fireCooldown = W.cooldown;
      const pos = ship.muzzlePos(new THREE.Vector3());
      const dir = ship.forward(new THREE.Vector3());
      projectiles.spawn('player', pos, dir, 'laser');
      sfx.play('laser');
    }

    projectiles.update(dt, {
      enemies, ship,
      onShipHit: (dmg) => { ship.takeDamage(dmg); hud.flashDamage(); sfx.play('hitWall'); shake = Math.min(1, shake + CONFIG.game.hitShake); },
      onEnemyHit: () => sfx.play('hitEnemy'),
      onWallHit: () => {},
    });
    enemies.update(dt, ship, level.field, level.graph);
    handleEvents(gamestate.update(dt, ship));

    // automap discovery poll
    mapPollTimer -= dt;
    if (mapPollTimer <= 0) {
      mapPollTimer = 0.25;
      automap.visit(nearestNodeId(level.graph, ship.object3d.position));
    }

    // escape phase fx
    if (gamestate.phase === 'escape') {
      hud.setTimer(gamestate.escapeRemaining);
      strobe.position.copy(ship.object3d.position);
      strobe.intensity = (Math.sin(clock.elapsedTime * 9) > 0 ? 1 : 0) * 180;
      alarmTimer -= dt;
      if (alarmTimer <= 0) { alarmTimer = 0.95; sfx.play('alarm'); }
    }

    hud.setShields(ship.shields, CONFIG.ship.shields);
    hud.setEnergy(ship.energy, CONFIG.ship.energy);
  }

  // restart / next depth
  if (input.justPressed('Enter')) {
    if (gamestate.phase === 'dead') loadLevel(seed, depth);
    else if (gamestate.phase === 'won') loadLevel(seed + 1, depth + 1);
  }
  if (input.justPressed('Tab')) automap.toggle();
  if (input.justPressed('KeyM')) sfx.setMuted(!sfx.muted);

  // camera shake
  shake = Math.max(0, shake - dt * 2.2);
  camRig.position.set((Math.random() - 0.5) * shake * 0.4, (Math.random() - 0.5) * shake * 0.4, 0);

  renderer.render(scene, camera);
  if (automap.visible) automap.render(renderer, ship.object3d.position, ship.object3d.quaternion, enemies.list());
  input.endFrame();
}

// ---------- boot ----------
app.addEventListener('click', () => sfx.init(), { once: true });

window.TR = {
  ready: false,
  get ship() { return ship; },
  get gamestate() { return gamestate; },
  get enemies() { return enemies; },
  get graph() { return level?.graph; },
  get field() { return level?.field; },
  debug: {
    giveKey() { gamestate.hasKey = true; hud.setKey(true); },
    killReactor() { const r = enemies.list().find((e) => e.isReactor); if (r) r.takeDamage(99999); },
    teleport(kind) { // 'spawn' | 'key' | 'reactor' | 'exit'
      const id = level.graph[kind + 'Id'];
      const n = level.graph.nodes.find((x) => x.id === id);
      ship.object3d.position.copy(n.pos); ship.velocity.set(0, 0, 0);
    },
    god() { ship.takeDamage = () => false; ship.spendEnergy = () => true; },
    toggleMap() { automap.toggle(); },
    showcase(seed = 42) { // one of each robot class lined up ahead of the ship, for eyeballing
      const rng = makeRng(seed);
      const kinds = ['grunt', 'claw', 'hulk', 'sniper', 'turret', 'reactor'];
      const group = new THREE.Group();
      group.name = 'showcase';
      const fwd = ship.forward(new THREE.Vector3());
      const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
      kinds.forEach((k, i) => {
        const { group: bot } = buildRobot(k, rng);
        bot.position.copy(ship.object3d.position)
          .addScaledVector(fwd, 10)
          .addScaledVector(right, (i - (kinds.length - 1) / 2) * 4.5);
        bot.lookAt(ship.object3d.position);
        group.add(bot);
      });
      scene.remove(scene.getObjectByName('showcase') ?? group);
      scene.add(group);
    },
  },
};

loadLevel(seed, depth);
frame();
