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
import { buildRobot, scorch } from './robots.js';
import { DeathSite } from './deathsite.js';
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
let xp = 0;

// death cinematic: third-person wreck tumble, explosion, then the corpse run
let deathsite = null; // created after scene systems exist
let wreck = null;
const wreckVel = new THREE.Vector3();
const wreckSpin = new THREE.Vector3();
let deathTimer = 0;
let exploded = false;
let flashT = -1;

// death cam: pull back from the wreck, then orbit once it has blown
const _deathCamStart = new THREE.Vector3();
const _deathRetreatDir = new THREE.Vector3(); // fixed at death, wreck-to-camera, +Y raised
const _deathOffsetDir = new THREE.Vector3();  // _deathRetreatDir rotated by the orbit angle
const _deathCamCandidate = new THREE.Vector3();
let deathCamStartRadius = 0;
let deathCamRadius = 0;   // grows toward 14, frozen early if it would clip a wall
let deathOrbitAngle = 0;  // advances only after the explosion
const flashMesh = new THREE.Mesh(
  new THREE.SphereGeometry(1, 8, 6),
  new THREE.MeshBasicMaterial({ color: 0xffa030, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
);
flashMesh.visible = false;
scene.add(flashMesh);

// third-person chase cam (Freespace-style): V toggles, ship model shows in third.
// Damped follow (exponential smoothing) + a small velocity-lean so thrust drifts
// the ship toward the screen edges instead of it staying pinned dead-center.
let thirdPerson = false;
let playerShipModel = null;
const CHASE_OFFSET = new THREE.Vector3(0, 1.9, 6.2); // local to ship: up + behind
const _chaseWorld = new THREE.Vector3();
const _chaseLocal = new THREE.Vector3();
const _chaseOffsetTarget = new THREE.Vector3();
const _chaseLocalVel = new THREE.Vector3();
const _chaseInvQuat = new THREE.Quaternion();

function ensurePlayerShipModel() {
  if (playerShipModel) return;
  playerShipModel = buildRobot('ship', makeRng(CONFIG.seed ^ 0x5451)).group;
  playerShipModel.rotation.y = Math.PI; // model faces +Z, ship flies -Z
  playerShipModel.visible = false;
  ship.object3d.add(playerShipModel);
}

// flatten the ship's forward vector to a level horizontal yaw (zero pitch/roll),
// keeping whichever way it was already facing. Debug-only: used by showcase() so
// the robot lineup and camera don't inherit a steep spawn pitch.
const _levelDir = new THREE.Vector3();
const _levelOrigin = new THREE.Vector3();
const _levelMat = new THREE.Matrix4();
const _levelUp = new THREE.Vector3(0, 1, 0);
function levelShipOrientation() {
  ship.forward(_levelDir);
  _levelDir.y = 0;
  if (_levelDir.lengthSq() < 1e-6) _levelDir.set(0, 0, -1);
  _levelDir.normalize();
  _levelMat.lookAt(_levelOrigin, _levelDir, _levelUp);
  ship.object3d.quaternion.setFromRotationMatrix(_levelMat);
}

function applyCameraMode() {
  ensurePlayerShipModel();
  playerShipModel.visible = thirdPerson;
  camRig.quaternion.identity();
  camRig.position.copy(thirdPerson ? CHASE_OFFSET : _chaseLocal.set(0, 0, 0));
}

function updateChaseCam(dt) {
  // pull the camera in when the chase offset would sit inside rock
  let t = 1;
  for (const tryT of [1, 0.75, 0.5, 0.32]) {
    t = tryT;
    _chaseLocal.copy(CHASE_OFFSET).multiplyScalar(tryT);
    _chaseWorld.copy(_chaseLocal).applyQuaternion(ship.object3d.quaternion).add(ship.object3d.position);
    if (level.field.sample(_chaseWorld.x, _chaseWorld.y, _chaseWorld.z) < -0.8) break;
  }
  _chaseOffsetTarget.copy(CHASE_OFFSET).multiplyScalar(t);

  // velocity lean: world velocity -> ship-local space, shift the offset opposite it
  // (clamped 0.6m) so the ship drifts toward the screen edges under thrust
  _chaseInvQuat.copy(ship.object3d.quaternion).invert();
  _chaseLocalVel.copy(ship.velocity).applyQuaternion(_chaseInvQuat).multiplyScalar(-1);
  if (_chaseLocalVel.length() > 0.6) _chaseLocalVel.setLength(0.6);
  _chaseOffsetTarget.add(_chaseLocalVel);

  // damped follow: exponential smoothing, not an instant snap
  camRig.position.lerp(_chaseOffsetTarget, 1 - Math.exp(-dt * 8));
}

function startDeathCinematic() {
  if (playerShipModel) playerShipModel.visible = false; // the wreck takes over
  wreck = buildRobot('ship', makeRng(seed ^ 0xD00D)).group;
  wreck.position.copy(ship.object3d.position);
  wreck.quaternion.copy(ship.object3d.quaternion);
  scene.add(wreck);
  scene.attach(camRig); // detach into world space so it can retreat/orbit on its own

  // retreat direction: wreck-to-camera at the moment of death, raised a bit, renormalized.
  // FP mode has the camera sitting right on the wreck (zero-length), so fall back to
  // "behind where the ship was facing", flattened to yaw only -- using the ship's full
  // pitch here can point the fallback almost straight down/up and drive the retreat
  // into the floor or ceiling.
  _deathRetreatDir.copy(camRig.position).sub(wreck.position);
  if (_deathRetreatDir.lengthSq() < 1e-4) {
    ship.forward(_deathRetreatDir).multiplyScalar(-1);
    _deathRetreatDir.y = 0;
    if (_deathRetreatDir.lengthSq() < 1e-4) _deathRetreatDir.set(0, 0, 1); // ship pointed straight up/down
  }
  _deathRetreatDir.normalize();
  _deathRetreatDir.y += 0.25;
  _deathRetreatDir.normalize();
  // floor of 2m: a literal 0-distance start (FP death) makes lookAt() degenerate
  // (eye === target) and glues the camera inside the wreck mesh
  deathCamStartRadius = Math.max(2, camRig.position.distanceTo(wreck.position));
  deathCamRadius = deathCamStartRadius;
  deathOrbitAngle = 0;

  wreckVel.copy(ship.velocity).multiplyScalar(0.6);
  wreckSpin.set(
    (Math.random() < 0.5 ? -1 : 1) * (2 + Math.random() * 2.5),
    (Math.random() < 0.5 ? -1 : 1) * (1 + Math.random() * 2),
    (Math.random() < 0.5 ? -1 : 1) * (2 + Math.random() * 2.5)
  );
  deathTimer = 0;
  exploded = false;
}

function clearWreck() {
  if (!wreck) return;
  scene.remove(wreck);
  wreck.traverse((o) => { if (o.isMesh) { o.geometry?.dispose(); o.material?.dispose(); } });
  wreck = null;
}

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
  clearWreck();
  deathsite?.clearProps();
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
    ship.object3d.add(camRig); // re-dock the death cam
    applyCameraMode();

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

    if (!deathsite) deathsite = new DeathSite(scene);
    deathsite.buildProps(seed, depth);
    hud.setXP(xp);

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
    else if (ev === 'died') { sfx.play('die'); startDeathCinematic(); }
  }
}

// ---------- loop ----------
const clock = new THREE.Clock();
const _wreckNormal = new THREE.Vector3();

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!level || !window.TR.ready) return;

  input.pollGamepad(dt);
  const phase = gamestate.phase;

  if (phase === 'playing' || phase === 'escape') {
    ship.update(dt, input);

    // engine thrum follows thrust input + current speed
    const thrustInputMag = Math.hypot(input.axis.x, input.axis.y, input.axis.z);
    const speedRatio = ship.velocity.length() / CONFIG.ship.maxSpeed;
    sfx.setEngine(Math.min(1, Math.max(0, thrustInputMag * 0.6 + speedRatio * 0.6)));

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

    // corpse run: hoover up the orbs you paid for
    const gained = deathsite.update(dt, ship.object3d.position);
    if (gained > 0) {
      xp += gained;
      hud.setXP(xp);
      sfx.play('pickup');
    }

    hud.setShields(ship.shields, CONFIG.ship.shields);
    hud.setEnergy(ship.energy, CONFIG.ship.energy);
  } else {
    sfx.setEngine(0);
  }

  // death cinematic: watch the ship tumble, pop, and become a landmark
  if (gamestate.phase === 'dead' && wreck) {
    deathTimer += dt;
    wreck.position.addScaledVector(wreckVel, dt);
    wreck.rotation.x += wreckSpin.x * dt;
    wreck.rotation.y += wreckSpin.y * dt;
    wreck.rotation.z += wreckSpin.z * dt;
    const s = level.field.sample(wreck.position.x, wreck.position.y, wreck.position.z);
    if (s > -1.2) { // clang off the cave walls while tumbling
      level.field.collisionNormal(wreck.position.x, wreck.position.y, wreck.position.z, _wreckNormal);
      wreck.position.addScaledVector(_wreckNormal, s + 1.2);
      const into = wreckVel.dot(_wreckNormal);
      if (into < 0) { wreckVel.addScaledVector(_wreckNormal, -into * 1.5); sfx.play('hitWall'); }
    }
    if (!exploded && deathTimer > 1.6) {
      exploded = true;
      scorch(wreck);
      wreckVel.multiplyScalar(0.15);
      wreckSpin.multiplyScalar(0.2);
      sfx.play('bigExplode');
      shake = 1.2;
      flashMesh.position.copy(wreck.position);
      flashMesh.visible = true;
      flashT = 0;
      deathsite.recordDeath(seed, depth, wreck.position, wreck.quaternion);
      hud.showDeath(true);
    }

    // camera: ease back from the wreck over ~1.5s, then slowly orbit once it's exploded
    const pullT = Math.min(1, deathTimer / 1.5);
    const eased = pullT * pullT * (3 - 2 * pullT); // smoothstep
    // pulled back to 14 originally, but the HULL BREACH overlay's centered text sits
    // right on top of a wreck that far away; 9m keeps it bigger in frame post-explosion
    const desiredRadius = THREE.MathUtils.lerp(deathCamStartRadius, 9, eased);
    if (exploded) deathOrbitAngle += dt * 0.35;
    const cosA = Math.cos(deathOrbitAngle), sinA = Math.sin(deathOrbitAngle);
    _deathOffsetDir.set(
      _deathRetreatDir.x * cosA + _deathRetreatDir.z * sinA,
      _deathRetreatDir.y,
      -_deathRetreatDir.x * sinA + _deathRetreatDir.z * cosA
    );
    // ladder search toward desiredRadius so a blocked far candidate doesn't freeze the
    // retreat at its current (possibly tiny) radius forever; frac=0 always falls back
    // to the last known-safe radius, so this never retreats backward
    let chosenRadius = deathCamRadius;
    for (const frac of [1, 0.66, 0.33, 0]) {
      const r = THREE.MathUtils.lerp(deathCamRadius, desiredRadius, frac);
      _deathCamCandidate.copy(wreck.position).addScaledVector(_deathOffsetDir, r);
      if (level.field.sample(_deathCamCandidate.x, _deathCamCandidate.y, _deathCamCandidate.z) <= -1.0) { chosenRadius = r; break; }
    }
    deathCamRadius = chosenRadius;
    camRig.position.copy(wreck.position).addScaledVector(_deathOffsetDir, deathCamRadius);
    // camRig is a plain Group, not a Camera: Object3D.lookAt() swaps eye/target for
    // non-camera/non-light objects, so it points local -Z AWAY from the wreck. Flip it.
    camRig.lookAt(wreck.position);
    camRig.rotateY(Math.PI);
    // once exploded, the centered HULL BREACH text sits directly over a dead-center
    // wreck; nudge the yaw so the wreck reads beside the text instead of behind it
    if (exploded) camRig.rotateY(0.34);
  }

  // explosion flash bloom
  if (flashT >= 0) {
    flashT += dt;
    const k = flashT / 0.5;
    if (k >= 1) { flashT = -1; flashMesh.visible = false; }
    else { flashMesh.scale.setScalar(1 + k * 9); flashMesh.material.opacity = 0.9 * (1 - k); }
  }

  // restart / next depth
  if (input.justPressed('Enter')) {
    if (gamestate.phase === 'dead') loadLevel(seed, depth);
    else if (gamestate.phase === 'won') loadLevel(seed + 1, depth + 1);
  }
  if (input.justPressed('Tab')) automap.toggle();
  if (input.justPressed('KeyM')) sfx.setMuted(!sfx.muted);
  if (input.justPressed('KeyV') && gamestate.phase !== 'dead') {
    thirdPerson = !thirdPerson;
    applyCameraMode();
  }
  if (thirdPerson && (gamestate.phase === 'playing' || gamestate.phase === 'escape')) updateChaseCam(dt);

  // camera shake: applied to the camera INSIDE the rig, so it also works while the
  // rig is detached in world space during the death cinematic
  shake = Math.max(0, shake - dt * 2.2);
  camera.position.set((Math.random() - 0.5) * shake * 0.4, (Math.random() - 0.5) * shake * 0.4, 0);

  renderer.render(scene, camera);
  if (automap.visible) automap.render(renderer, ship.object3d.position, ship.object3d.quaternion, enemies.list());
  input.endFrame();
}

// ---------- boot ----------
app.addEventListener('click', () => { sfx.init(); sfx.startAmbient(); }, { once: true });

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
      ship.velocity.set(0, 0, 0);
      // n.pos is the exact room center -- for the reactor that's ALSO the boss mesh's
      // own position (see enemies.js _spawnReactor: group.position.copy(node.pos)), so
      // landing straight on it embeds the camera inside the reactor geometry. And even
      // where nothing occupies the center, the spawn-inherited quaternion can point
      // steeply up/down a shaft, aiming the shot at a nearby wall/ceiling instead of the
      // room. Back off along a level horizontal direction and look back at the center so
      // debug teleport-and-screenshot lands with the room's built content in frame.
      const dir = ship.forward(new THREE.Vector3());
      dir.y = 0;
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
      dir.normalize();
      // teleport('exit') doubles as "put the ship at the exit" for win-condition checks
      // (gamestate.js fires 'escaped' at distance < config.game.exitDist == 7); keep the
      // pullback well inside that radius there so the exit teleport still wins the level.
      const pullback = kind === 'exit'
        ? Math.min(Math.max(3, (n.radius || 6) * 0.75), CONFIG.game.exitDist - 2)
        : Math.max(3, (n.radius || 6) * 0.75);
      ship.object3d.position.copy(n.pos).addScaledVector(dir, pullback);
      dir.multiplyScalar(-1); // face back toward the room center
      const lookMat = new THREE.Matrix4().lookAt(new THREE.Vector3(), dir, new THREE.Vector3(0, 1, 0));
      ship.object3d.quaternion.setFromRotationMatrix(lookMat);
    },
    god() { ship.takeDamage = () => false; ship.spendEnergy = () => true; },
    toggleMap() { automap.toggle(); },
    showcase(seed = 42) { // one of each robot class lined up ahead of the ship, for eyeballing
      // a showcase you can't see the player ship in isn't much of a showcase: force
      // third-person and a level orientation so both the ship and the lineup are framed
      thirdPerson = true;
      applyCameraMode();
      levelShipOrientation();
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
