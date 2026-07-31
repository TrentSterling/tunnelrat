// enemies.js : class-driven robot AI. Mobile classes (grunt, claw, hulk, sniper) share
// one movement machine with per-class parameters from config.enemies; wall turrets and
// the reactor boss are stationary. Bodies come from robots.js (procgen low-poly).
//
// CONTRACT:
// class EnemyManager {
//   constructor(scene, config)
//   populate(graph, field, projectiles, seed, depth)   // spawn table config.enemies.spawns
//   update(dt, ship, field, graph)
//   list() -> [{ pos, radius, alive, takeDamage(n), isReactor? }]
//   reactorAlive: boolean
//   onReactorDestroyed / onEnemyKilled / onShipMelee(damage) callbacks (main wires)
//   clear()
// }
//
// Class behaviors:
//   grunt : patrol -> chase, holds 12-20m band, strafes, single half-lead bolts
//   hulk  : slow bruiser, 3-bolt bursts with slight spread, faces the ship while firing
//   sniper: hangs back 28-44m, backs off if pressed, fast full-lead sniperBolt
//   claw  : no gun; sprints straight in and shreds on contact (melee + knockback)
//   turret: wall-planted, slerp aim + cooldown fire
//   reactor: fires reactorBolt, flashes on damage, death triggers escape
// Enemy pathfinding uses findPath(..., true): the locked door only blocks the ship.
import * as THREE from 'three';
import { makeRng, randRange, pick } from './util/rng.js';
import { findPath, nearestNodeId } from './procgen/graph.js';
import { buildRobot } from './robots.js';

const UP = new THREE.Vector3(0, 1, 0);
const UNIT_Z = new THREE.Vector3(0, 0, 1);
const SHIP_RADIUS_PAD = 1.5; // approx ship collision radius for melee contact checks

const _toShip = new THREE.Vector3();
const _dirToShip = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _perp = new THREE.Vector3();
const _target = new THREE.Vector3();
const _leadPos = new THREE.Vector3();
const _fireDir = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _faceDir = new THREE.Vector3();
const _rand3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _aimQuat = new THREE.Quaternion();
const _box = new THREE.Box3();
const _boxSize = new THREE.Vector3();
const _lookM = new THREE.Matrix4();
const _zero = new THREE.Vector3(0, 0, 0);
const _altUp = new THREE.Vector3(1, 0, 0);

// robots face local +Z along dir, roll-stabilized to world up (setFromUnitVectors
// gave the minimal arc, which left bodies banked at random angles: Trent's
// "orientation is off" bug). Matrix4.lookAt(eye, target, up) points -Z from eye
// to target, so eye=dir target=origin puts +Z on dir.
function aimAlong(dir, out) {
  const up = Math.abs(dir.y) > 0.95 ? _altUp : UP;
  _lookM.lookAt(dir, _zero, up);
  out.setFromRotationMatrix(_lookM);
  return out;
}

function randomUnitVector(rng, out) {
  const z = randRange(rng, -1, 1);
  const t = randRange(rng, 0, Math.PI * 2);
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  out.set(r * Math.cos(t), r * Math.sin(t), z);
  return out;
}

// scale a robot body so its largest extent matches the class collision diameter
// (a touch bigger reads better; Descent robots always looked chunkier than their hitbox)
function fitToRadius(group, radius) {
  _box.setFromObject(group);
  _box.getSize(_boxSize);
  const maxDim = Math.max(_boxSize.x, _boxSize.y, _boxSize.z, 0.001);
  group.scale.setScalar((radius * 2.4) / maxDim);
}

export class EnemyManager {
  constructor(scene, config) {
    this.scene = scene;
    this.config = config;

    this.root = new THREE.Group();
    this.root.name = 'enemies';
    scene.add(this.root);

    this.bots = [];
    this.turrets = [];
    this.reactor = null;
    this.reactorAlive = false;

    this.graph = null;
    this.field = null;
    this.projectiles = null;
    this.nodeMap = new Map();
    this.rng = null;

    this.onReactorDestroyed = null;
    this.onEnemyKilled = null;
    this.onShipMelee = null;
  }

  populate(graph, field, projectiles, seed, depth) {
    this.clear();
    this.graph = graph;
    this.field = field;
    this.projectiles = projectiles;
    this.nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

    const rng = makeRng(seed ^ 0xBEEF);
    this.rng = rng;
    const cfgE = this.config.enemies;

    const hops = new Map();
    hops.set(graph.spawnId, 0);
    const q = [graph.spawnId];
    while (q.length) {
      const cur = q.shift();
      const h = hops.get(cur);
      for (const nb of graph.neighbors.get(cur) || []) {
        if (!hops.has(nb)) { hops.set(nb, h + 1); q.push(nb); }
      }
    }

    let botNodes = graph.nodes.filter((n) =>
      n.id !== graph.spawnId && n.id !== graph.exitId && (hops.get(n.id) ?? 99) > 2);
    if (botNodes.length === 0) {
      botNodes = graph.nodes.filter((n) => n.id !== graph.spawnId && n.id !== graph.exitId);
    }
    if (botNodes.length === 0) botNodes = graph.nodes.slice();

    const extra = Math.max(0, depth - 1);
    let spawnIndex = 0;
    let totalMobile = 0;
    for (const cls of ['grunt', 'claw', 'hulk', 'sniper']) {
      totalMobile += cfgE.spawns[cls][0] + Math.floor(cfgE.spawns[cls][1] * extra);
    }
    for (const cls of ['grunt', 'claw', 'hulk', 'sniper']) {
      const count = cfgE.spawns[cls][0] + Math.floor(cfgE.spawns[cls][1] * extra);
      for (let i = 0; i < count; i++) {
        const node = pick(rng, botNodes);
        this.bots.push(this._spawnBot(cls, node, spawnIndex++, totalMobile, rng));
      }
    }

    let turretNodes = graph.nodes.filter((n) => n.id !== graph.spawnId && n.id !== graph.exitId);
    if (turretNodes.length === 0) turretNodes = graph.nodes.slice();
    const turretCount = cfgE.spawns.turret[0] + Math.floor(cfgE.spawns.turret[1] * extra);
    for (let i = 0; i < turretCount; i++) {
      const node = pick(rng, turretNodes);
      this.turrets.push(this._spawnTurret(node, field, rng));
    }

    const reactorNode = this.nodeMap.get(graph.reactorId);
    this.reactor = this._spawnReactor(reactorNode, rng);
    this.reactorAlive = true;
  }

  _spawnBot(classKey, node, index, totalCount, rng) {
    const cfg = this.config.enemies[classKey];
    const pos = new THREE.Vector3();
    let placed = false;
    for (let tries = 0; tries < 20; tries++) {
      randomUnitVector(rng, _rand3);
      const r = randRange(rng, 0, Math.max(0.1, node.radius * 0.6));
      pos.copy(node.pos).addScaledVector(_rand3, r);
      if (this.field.sample(pos.x, pos.y, pos.z) < -cfg.radius) { placed = true; break; }
    }
    if (!placed) pos.copy(node.pos);

    const { group } = buildRobot(classKey, rng);
    fitToRadius(group, cfg.radius);
    group.position.copy(pos);
    this.root.add(group);

    const neighbors = this.graph.neighbors.get(node.id) || [];
    const patrolTargetId = neighbors.length ? pick(rng, neighbors) : node.id;

    const entry = {
      kind: 'bot',
      classKey,
      pos,
      radius: cfg.radius,
      hp: cfg.hp,
      alive: true,
      mesh: group,
      velocity: new THREE.Vector3(),
      state: 'patrol',
      patrolTargetId,
      currentPath: null,
      pathIndex: 1,
      repathTimer: (index / Math.max(1, totalCount)) * 1.0 + randRange(rng, 0, 0.3),
      fireTimer: randRange(rng, 0, Math.max(0.5, cfg.fireCooldown || 1)),
      burstLeft: 0,
      burstTimer: 0,
      meleeTimer: 0,
      strafePhase: randRange(rng, 0, Math.PI * 2),
      strafeSign: rng() < 0.5 ? -1 : 1,
    };
    entry.takeDamage = (n) => this._damageEnemy(entry, n, false);
    return entry;
  }

  _spawnTurret(node, field, rng) {
    const cfg = this.config.enemies.turret;
    const maxDist = Math.max(this.config.world.size * 0.5, 40);
    const dir = new THREE.Vector3();
    let hitDist = -1;
    for (let tries = 0; tries < 16 && hitDist < 0; tries++) {
      randomUnitVector(rng, dir);
      hitDist = field.raycast(node.pos, dir, maxDist);
    }

    const pos = new THREE.Vector3();
    const normal = new THREE.Vector3();
    if (hitDist >= 0) {
      pos.copy(node.pos).addScaledVector(dir, hitDist);
      field.collisionNormal(pos.x, pos.y, pos.z, normal);
    } else {
      pos.copy(node.pos).addScaledVector(dir, node.radius * 0.9);
      normal.copy(dir).negate();
    }

    const { group, refs } = buildRobot('turret', rng);
    fitToRadius(group, cfg.radius);
    group.position.copy(pos);
    group.quaternion.setFromUnitVectors(UP, normal);
    this.root.add(group);

    const entry = {
      kind: 'turret',
      pos,
      radius: cfg.radius,
      hp: cfg.hp,
      alive: true,
      mesh: group,
      head: refs.head,
      normal: normal.clone(),
      fireTimer: randRange(rng, 0, cfg.fireCooldown),
    };
    entry.takeDamage = (n) => this._damageEnemy(entry, n, false);
    return entry;
  }

  _spawnReactor(node, rng) {
    const cfg = this.config.enemies.reactor;
    const { group, refs } = buildRobot('reactor', rng);
    fitToRadius(group, cfg.radius);
    group.position.copy(node.pos);
    const glow = new THREE.PointLight(0xff7a2f, 140, 50); // the reactor room runs hot
    group.add(glow);
    this.root.add(group);

    const entry = {
      kind: 'reactor',
      isReactor: true,
      pos: node.pos.clone(),
      radius: cfg.radius,
      hp: cfg.hp,
      alive: true,
      mesh: group,
      material: refs.coreMat,
      glow,
      fireTimer: cfg.fireCooldown * 0.5,
      flash: 0,
    };
    entry.takeDamage = (n) => this._damageEnemy(entry, n, true);
    return entry;
  }

  _damageEnemy(entry, n, isReactor) {
    if (!entry.alive) return;
    entry.hp -= n;
    if (isReactor) entry.flash = 1.0;
    if (entry.hp <= 0) {
      entry.alive = false;
      if (isReactor) {
        this.reactorAlive = false;
        if (this.onReactorDestroyed) this.onReactorDestroyed();
      } else {
        this.root.remove(entry.mesh);
        entry.mesh.traverse((o) => { if (o.isMesh) { o.geometry?.dispose(); o.material?.dispose(); } });
        if (this.onEnemyKilled) this.onEnemyKilled(entry);
      }
    }
  }

  update(dt, ship, field, graph) {
    this.field = field;
    this.graph = graph;
    const shipPos = ship.object3d.position;
    const shipAlive = ship.alive;

    for (let i = 0; i < this.bots.length; i++) {
      const b = this.bots[i];
      if (b.alive) this._updateBot(b, dt, ship, shipPos, shipAlive, field, graph);
    }
    for (let i = 0; i < this.turrets.length; i++) {
      const t = this.turrets[i];
      if (t.alive) this._updateTurret(t, dt, shipPos, shipAlive, field);
    }
    if (this.reactor) this._updateReactor(this.reactor, dt, shipPos, shipAlive, field);
  }

  _fireBolt(b, cfg, ship, shipPos, dist) {
    const wcfg = this.config.weapons[cfg.bolt];
    const leadT = (dist / wcfg.speed) * cfg.lead;
    _leadPos.copy(shipPos).addScaledVector(ship.velocity, leadT);
    _fireDir.copy(_leadPos).sub(b.pos).normalize();
    if (b.classKey === 'hulk') { // slight burst spread so the wall of bolts is dodgeable
      _fireDir.x += (this.rng() - 0.5) * 0.08;
      _fireDir.y += (this.rng() - 0.5) * 0.08;
      _fireDir.z += (this.rng() - 0.5) * 0.08;
      _fireDir.normalize();
    }
    this.projectiles.spawn('enemy', b.pos, _fireDir, cfg.bolt);
  }

  _updateBot(b, dt, ship, shipPos, shipAlive, field, graph) {
    const cfg = this.config.enemies[b.classKey];
    const isMelee = !!cfg.melee;

    _toShip.copy(shipPos).sub(b.pos);
    const dist = _toShip.length();
    let los = false;
    if (shipAlive && dist > 0.001) {
      _dirToShip.copy(_toShip).multiplyScalar(1 / dist);
      los = field.raycast(b.pos, _dirToShip, dist) === -1;
    }

    if (b.state === 'patrol') {
      if (shipAlive && dist < cfg.sightRange && los) {
        b.state = 'chase';
        b.repathTimer = 0;
      }
    } else if (b.state === 'chase') {
      if (!shipAlive || dist > cfg.sightRange * 1.4) {
        b.state = 'patrol';
        b.currentPath = null;
      }
    }

    _desired.set(0, 0, 0);
    let targetSpeed = cfg.speed * 0.4;
    let combatFacing = false;

    if (b.state === 'patrol') {
      const targetNode = this.nodeMap.get(b.patrolTargetId);
      if (targetNode) {
        const dNode = b.pos.distanceTo(targetNode.pos);
        if (dNode < Math.max(3, targetNode.radius * 0.4)) {
          const neighbors = graph.neighbors.get(targetNode.id) || [];
          b.patrolTargetId = neighbors.length ? pick(this.rng, neighbors) : targetNode.id;
        } else {
          _desired.copy(targetNode.pos).sub(b.pos).normalize();
        }
      }
    } else {
      // CHASE
      b.repathTimer -= dt;
      if (b.repathTimer <= 0) {
        b.repathTimer = 1.0;
        const fromId = nearestNodeId(graph, b.pos);
        const toId = nearestNodeId(graph, shipPos);
        b.currentPath = findPath(graph, fromId, toId, true);
        b.pathIndex = 1;
      }
      b.strafePhase += dt;

      if (shipAlive && los && dist > 0.001) {
        if (isMelee) {
          // claw: no range band, no gun; run the target down
          _desired.copy(_dirToShip);
          targetSpeed = cfg.speed;
          b.meleeTimer -= dt;
          if (dist < b.radius + SHIP_RADIUS_PAD + 0.6 && b.meleeTimer <= 0) {
            b.meleeTimer = cfg.meleeCooldown;
            if (this.onShipMelee) this.onShipMelee(cfg.melee);
            ship.velocity.addScaledVector(_dirToShip, cfg.meleeKnock); // shove
            b.velocity.addScaledVector(_dirToShip, -cfg.meleeKnock * 0.5); // recoil
          }
        } else {
          if (dist > cfg.rangeFar) {
            _desired.copy(_dirToShip);
            targetSpeed = cfg.speed;
          } else if (dist < cfg.rangeNear) {
            _desired.copy(_dirToShip).negate();
            targetSpeed = cfg.speed;
          } else if (cfg.strafe > 0) {
            _perp.crossVectors(_dirToShip, UP);
            if (_perp.lengthSq() < 1e-6) _perp.set(1, 0, 0); else _perp.normalize();
            const sign = (Math.sin(b.strafePhase * 1.3) >= 0 ? 1 : -1) * b.strafeSign;
            _desired.copy(_perp).multiplyScalar(sign);
            targetSpeed = cfg.strafe;
          }
          combatFacing = b.classKey === 'hulk' || b.classKey === 'sniper';

          if (dist < cfg.fireRange && cfg.bolt) {
            b.fireTimer -= dt;
            if (b.fireTimer <= 0 && this.projectiles) {
              b.fireTimer = cfg.fireCooldown;
              this._fireBolt(b, cfg, ship, shipPos, dist);
              b.burstLeft = cfg.burst - 1;
              b.burstTimer = cfg.burstGap;
            }
          }
        }
      } else {
        let followed = false;
        if (b.currentPath && b.pathIndex < b.currentPath.length) {
          const node = this.nodeMap.get(b.currentPath[b.pathIndex]);
          if (node) {
            const dNode = b.pos.distanceTo(node.pos);
            if (dNode < Math.max(4, node.radius * 0.5)) {
              b.pathIndex++;
            } else {
              _desired.copy(node.pos).sub(b.pos).normalize();
              followed = true;
              targetSpeed = cfg.speed;
            }
          }
        }
        if (!followed) {
          if (dist > 0.001) _desired.copy(_toShip).normalize();
          targetSpeed = cfg.speed;
        }
      }
    }

    // finish an in-flight burst even if the band/LOS shifted a little this frame
    if (b.burstLeft > 0 && shipAlive && this.projectiles) {
      b.burstTimer -= dt;
      if (b.burstTimer <= 0) {
        b.burstLeft--;
        b.burstTimer = cfg.burstGap;
        if (los && dist > 0.001) this._fireBolt(b, cfg, ship, shipPos, dist);
      }
    }

    if (_desired.lengthSq() > 1e-8) {
      b.velocity.addScaledVector(_desired, cfg.accel * dt);
    }
    b.velocity.multiplyScalar(Math.max(0, 1 - 2.0 * dt));
    const speedNow = b.velocity.length();
    if (speedNow > targetSpeed) b.velocity.multiplyScalar(targetSpeed / speedNow);

    b.pos.addScaledVector(b.velocity, dt);

    const s = field.sample(b.pos.x, b.pos.y, b.pos.z);
    if (s > -b.radius) {
      field.collisionNormal(b.pos.x, b.pos.y, b.pos.z, _normal);
      b.pos.addScaledVector(_normal, s + b.radius);
      const into = b.velocity.dot(_normal);
      if (into < 0) b.velocity.addScaledVector(_normal, -into);
    }

    b.mesh.position.copy(b.pos);
    if (combatFacing && dist > 0.001) {
      aimAlong(_dirToShip, _aimQuat);
      b.mesh.quaternion.slerp(_aimQuat, Math.min(1, dt * 5));
    } else if (b.velocity.lengthSq() > 0.0025) {
      _faceDir.copy(b.velocity).normalize();
      aimAlong(_faceDir, _aimQuat);
      b.mesh.quaternion.slerp(_aimQuat, Math.min(1, dt * 6));
    }
  }

  _updateTurret(t, dt, shipPos, shipAlive, field) {
    const cfg = this.config.enemies.turret;
    if (!shipAlive) return;

    // LOS must start OFF the wall: the turret body sits at sample≈0, so a raycast
    // from t.pos hits rock at distance 0 and the turret never sees anything.
    _muzzle.copy(t.pos).addScaledVector(t.normal, t.radius * 0.9);
    _toShip.copy(shipPos).sub(_muzzle);
    const dist = _toShip.length();
    if (dist < 0.001) return;
    _dirToShip.copy(_toShip).multiplyScalar(1 / dist);

    const inRange = dist < cfg.fireRange;
    const los = inRange && field.raycast(_muzzle, _dirToShip, dist) === -1;
    if (!los) return;

    _q.copy(t.mesh.quaternion).invert();
    _target.copy(_dirToShip).applyQuaternion(_q);
    _aimQuat.setFromUnitVectors(UNIT_Z, _target);
    t.head.quaternion.slerp(_aimQuat, Math.min(1, dt * 4));

    t.fireTimer -= dt;
    if (t.fireTimer <= 0 && this.projectiles) {
      t.fireTimer = cfg.fireCooldown;
      this.projectiles.spawn('enemy', _muzzle, _dirToShip, 'enemyBolt');
    }
  }

  _updateReactor(r, dt, shipPos, shipAlive, field) {
    const cfg = this.config.enemies.reactor;

    r.mesh.rotation.y += (r.alive ? 0.6 : 0.15) * dt;

    if (r.flash > 0) r.flash = Math.max(0, r.flash - dt * 2.5);
    if (r.alive) {
      r.material.emissiveIntensity = 1.1 + r.flash * 2.5;
      r.glow.intensity = 140 + r.flash * 180;
    } else {
      r.material.emissiveIntensity = Math.max(0, r.material.emissiveIntensity - dt * 0.6);
      r.glow.intensity = Math.max(0, r.glow.intensity - dt * 70);
    }

    if (!r.alive || !shipAlive) return;

    _toShip.copy(shipPos).sub(r.pos);
    const dist = _toShip.length();
    if (dist < 0.001 || dist >= cfg.fireRange) return;
    _dirToShip.copy(_toShip).multiplyScalar(1 / dist);
    const los = field.raycast(r.pos, _dirToShip, dist) === -1;
    if (!los) return;

    r.fireTimer -= dt;
    if (r.fireTimer <= 0 && this.projectiles) {
      r.fireTimer = cfg.fireCooldown;
      this.projectiles.spawn('enemy', r.pos, _dirToShip, 'reactorBolt');
    }
  }

  list() {
    const out = [];
    for (let i = 0; i < this.bots.length; i++) if (this.bots[i].alive) out.push(this.bots[i]);
    for (let i = 0; i < this.turrets.length; i++) if (this.turrets[i].alive) out.push(this.turrets[i]);
    if (this.reactor) out.push(this.reactor);
    return out;
  }

  clear() {
    // robot bodies are per-instance geometry: dispose everything under root
    this.root.traverse((o) => {
      if (o.isMesh) {
        o.geometry?.dispose();
        o.material?.dispose();
      }
    });
    while (this.root.children.length) this.root.remove(this.root.children[0]);

    this.bots = [];
    this.turrets = [];
    this.reactor = null;
    this.reactorAlive = false;
    this.graph = null;
    this.field = null;
    this.projectiles = null;
    this.nodeMap = new Map();
  }
}
