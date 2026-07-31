// enemies.js : drones (patrol/chase/strafe), wall turrets, and the reactor boss.
//
// CONTRACT (implement exactly):
//
// class EnemyManager {
//   constructor(scene, config)
//   populate(graph, field, projectiles, seed, depth)
//     // clears previous, spawns dronesBase + 2*depth drones, turretsBase + depth
//     // turrets, 1 reactor in the reactor room. Uses makeRng(seed ^ 0xBEEF).
//     // Drones spawn at random non-spawn, non-exit nodes (jitter inside room, keep
//     //   field.sample < -drone.radius). Never within 2 hops of spawn node.
//     // Turrets: pick random room nodes (not spawn/exit), raycast from node center in a
//     //   random direction to a wall (field.raycast), plant on hit point, oriented
//     //   with +Y along the collision normal.
//     // Reactor: at reactor node center; big emissive octahedron + spin.
//   update(dt, ship, field, graph)   // all AI; fires via the ProjectileSystem given in populate
//   list() -> array of { pos:Vector3, radius, alive, takeDamage(n) }  // includes reactor
//     while alive; the reactor entry additionally has isReactor:true (main.js debug uses it)
//   reactorAlive: boolean
//   onReactorDestroyed: null | () => void
//   onEnemyKilled: null | (enemy) => void   // for sfx/explosion fx (main wires)
//   clear()
// }
//
// Drone AI (state machine per drone):
//   PATROL: drift between its node and random neighbors (findPath not needed: pick
//     random neighbor node, steer to its center, repeat). Speed 40% of max.
//   CHASE: trigger when dist(ship) < sightRange AND field.raycast(dronePos ->
//     dirToShip, dist) === -1 (clear LOS). A* / BFS via findPath(graph,
//     nearestNodeId(drone), nearestNodeId(ship)) every ~1s (stagger by drone index,
//     NOT all on the same frame); steer toward next path node center, or straight at
//     ship when LOS is clear. Maintain 12-20m preferred range, strafe perpendicular
//     (sin of per-drone phase) while in range.
//   FIRE: in CHASE with LOS and dist < fireRange, cooldown timer: spawn 'enemyBolt'
//     aimed at ship.pos + ship.velocity * (dist/boltSpeed) * 0.5 (half lead: dodgeable).
//   Movement is velocity-based with accel toward desired dir, damping 2.0/s; collide
//   vs field with same push-out trick as ship (1 iteration is fine).
//   Visuals: cheap geometric hulls, MeshLambertMaterial flat colors + small emissive;
//   e.g. octahedron body + ring. Face velocity direction.
//
// Turret AI: static; if LOS to ship and dist < fireRange: slerp aim, fire on cooldown.
//   Visual: short cylinder base + box barrel, barrel lookAt ship when active.
//
// Reactor: spins; if LOS and dist < fireRange fires 'reactorBolt' at ship (no lead)
//   on cooldown. takeDamage flashes its emissive. On death: alive=false, call
//   onReactorDestroyed(), leave a dimming husk mesh.
//
// AMBIGUITY RESOLUTION: findPath()'s allowLocked defaults false (used for mission
// solvability checks). The locked door only blocks the ship (see gamestate.js: "bolts
// pass, only the ship is blocked" -- and it isn't carved into the density field at
// all), so enemy pathfinding calls findPath(..., true): drones are physically free to
// route through the door tunnel exactly like the field already allows.
import * as THREE from 'three';
import { makeRng, randRange, pick } from './util/rng.js';
import { findPath, nearestNodeId } from './procgen/graph.js';

const UP = new THREE.Vector3(0, 1, 0);
const UNIT_Z = new THREE.Vector3(0, 0, 1);

// module-scope scratch: reused across every drone/turret/reactor update to avoid
// per-frame allocation churn (enemy counts are small but this is still cheap hygiene).
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

function randomUnitVector(rng, out) {
  const z = randRange(rng, -1, 1);
  const t = randRange(rng, 0, Math.PI * 2);
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  out.set(r * Math.cos(t), r * Math.sin(t), z);
  return out;
}

export class EnemyManager {
  constructor(scene, config) {
    this.scene = scene;
    this.config = config;

    this.root = new THREE.Group();
    this.root.name = 'enemies';
    scene.add(this.root);

    this.drones = [];
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

    this._buildAssets();
  }

  _buildAssets() {
    const c = this.config;

    const dr = c.enemies.drone.radius;
    this.droneGeo = new THREE.OctahedronGeometry(dr, 0);
    this.droneRingGeo = new THREE.TorusGeometry(dr * 1.35, dr * 0.14, 6, 14);
    this.droneMat = new THREE.MeshLambertMaterial({ color: 0x8fa0ff, emissive: 0x1c2050 });
    this.droneRingMat = new THREE.MeshLambertMaterial({ color: 0xff5a3b, emissive: 0x401208 });

    const tr = c.enemies.turret.radius;
    this.turretBaseGeo = new THREE.CylinderGeometry(tr * 0.95, tr * 1.15, tr * 0.55, 8);
    this.turretBarrelGeo = new THREE.BoxGeometry(tr * 0.32, tr * 0.32, tr * 1.5);
    this.turretBaseMat = new THREE.MeshLambertMaterial({ color: 0x555a66, emissive: 0x0a0a10 });
    this.turretBarrelMat = new THREE.MeshLambertMaterial({ color: 0xff5a3b, emissive: 0x401208 });

    const rr = c.enemies.reactor.radius;
    this.reactorGeo = new THREE.OctahedronGeometry(rr, 0);
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

    // BFS hop count from spawn (graph.neighbors already includes locked edges).
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

    let droneNodes = graph.nodes.filter((n) =>
      n.id !== graph.spawnId && n.id !== graph.exitId && (hops.get(n.id) ?? 99) > 2);
    if (droneNodes.length === 0) {
      droneNodes = graph.nodes.filter((n) => n.id !== graph.spawnId && n.id !== graph.exitId);
    }
    if (droneNodes.length === 0) droneNodes = graph.nodes.slice();

    const droneCount = cfgE.dronesBase + 2 * depth;
    for (let i = 0; i < droneCount; i++) {
      const node = pick(rng, droneNodes);
      this.drones.push(this._spawnDrone(node, i, droneCount, rng));
    }

    let turretNodes = graph.nodes.filter((n) => n.id !== graph.spawnId && n.id !== graph.exitId);
    if (turretNodes.length === 0) turretNodes = graph.nodes.slice();
    const turretCount = cfgE.turretsBase + depth;
    for (let i = 0; i < turretCount; i++) {
      const node = pick(rng, turretNodes);
      this.turrets.push(this._spawnTurret(node, field, rng));
    }

    const reactorNode = this.nodeMap.get(graph.reactorId);
    this.reactor = this._spawnReactor(reactorNode);
    this.reactorAlive = true;
  }

  _spawnDrone(node, index, totalCount, rng) {
    const cfg = this.config.enemies.drone;
    const pos = new THREE.Vector3();
    let placed = false;
    for (let tries = 0; tries < 20; tries++) {
      randomUnitVector(rng, _rand3);
      const r = randRange(rng, 0, Math.max(0.1, node.radius * 0.6));
      pos.copy(node.pos).addScaledVector(_rand3, r);
      if (this.field.sample(pos.x, pos.y, pos.z) < -cfg.radius) { placed = true; break; }
    }
    if (!placed) pos.copy(node.pos);

    const mesh = new THREE.Group();
    const body = new THREE.Mesh(this.droneGeo, this.droneMat);
    const ring = new THREE.Mesh(this.droneRingGeo, this.droneRingMat);
    ring.rotation.x = Math.PI / 2;
    mesh.add(body, ring);
    mesh.position.copy(pos);
    this.root.add(mesh);

    const neighbors = this.graph.neighbors.get(node.id) || [];
    const patrolTargetId = neighbors.length ? pick(rng, neighbors) : node.id;

    const entry = {
      kind: 'drone',
      pos,
      radius: cfg.radius,
      hp: cfg.hp,
      alive: true,
      mesh,
      ring,
      velocity: new THREE.Vector3(),
      state: 'patrol',
      patrolTargetId,
      currentPath: null,
      pathIndex: 1,
      repathTimer: (index / Math.max(1, totalCount)) * 1.0 + randRange(rng, 0, 0.3),
      fireTimer: randRange(rng, 0, cfg.fireCooldown),
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
      // No wall found after all tries (degenerate room): plant near the room edge
      // along the last tried direction so the level never ends up with a missing turret.
      pos.copy(node.pos).addScaledVector(dir, node.radius * 0.9);
      normal.copy(dir).negate();
    }

    const mesh = new THREE.Group();
    const base = new THREE.Mesh(this.turretBaseGeo, this.turretBaseMat);
    const head = new THREE.Group();
    const barrel = new THREE.Mesh(this.turretBarrelGeo, this.turretBarrelMat);
    barrel.position.z = cfg.radius * 0.7;
    head.add(barrel);
    head.position.y = cfg.radius * 0.35;
    mesh.add(base, head);
    mesh.position.copy(pos);
    mesh.quaternion.setFromUnitVectors(UP, normal);
    this.root.add(mesh);

    const entry = {
      kind: 'turret',
      pos,
      radius: cfg.radius,
      hp: cfg.hp,
      alive: true,
      mesh,
      head,
      normal: normal.clone(),
      fireTimer: randRange(rng, 0, cfg.fireCooldown),
    };
    entry.takeDamage = (n) => this._damageEnemy(entry, n, false);
    return entry;
  }

  _spawnReactor(node) {
    const cfg = this.config.enemies.reactor;
    const material = new THREE.MeshLambertMaterial({
      color: this.config.colors.reactor,
      emissive: this.config.colors.reactor,
      emissiveIntensity: 1.1,
    });
    const mesh = new THREE.Mesh(this.reactorGeo, material);
    mesh.position.copy(node.pos);
    this.root.add(mesh);

    const entry = {
      kind: 'reactor',
      isReactor: true,
      pos: node.pos.clone(),
      radius: cfg.radius,
      hp: cfg.hp,
      alive: true,
      mesh,
      material,
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
        if (this.onEnemyKilled) this.onEnemyKilled(entry);
      }
    }
  }

  update(dt, ship, field, graph) {
    this.field = field;
    this.graph = graph;
    const shipPos = ship.object3d.position;
    const shipAlive = ship.alive;

    for (let i = 0; i < this.drones.length; i++) {
      const d = this.drones[i];
      if (d.alive) this._updateDrone(d, dt, ship, shipPos, shipAlive, field, graph);
    }
    for (let i = 0; i < this.turrets.length; i++) {
      const t = this.turrets[i];
      if (t.alive) this._updateTurret(t, dt, shipPos, shipAlive, field);
    }
    if (this.reactor) this._updateReactor(this.reactor, dt, shipPos, shipAlive, field);
  }

  _updateDrone(d, dt, ship, shipPos, shipAlive, field, graph) {
    const cfg = this.config.enemies.drone;

    _toShip.copy(shipPos).sub(d.pos);
    const dist = _toShip.length();
    let los = false;
    if (shipAlive && dist > 0.001) {
      _dirToShip.copy(_toShip).multiplyScalar(1 / dist);
      los = field.raycast(d.pos, _dirToShip, dist) === -1;
    }

    if (d.state === 'patrol') {
      if (shipAlive && dist < cfg.sightRange && los) {
        d.state = 'chase';
        d.repathTimer = 0;
      }
    } else if (d.state === 'chase') {
      if (!shipAlive || dist > cfg.sightRange * 1.4) {
        d.state = 'patrol';
        d.currentPath = null;
      }
    }

    _desired.set(0, 0, 0);
    let targetSpeed = cfg.speed * 0.4;

    if (d.state === 'patrol') {
      const targetNode = this.nodeMap.get(d.patrolTargetId);
      if (targetNode) {
        const dNode = d.pos.distanceTo(targetNode.pos);
        if (dNode < Math.max(3, targetNode.radius * 0.4)) {
          const neighbors = graph.neighbors.get(targetNode.id) || [];
          d.patrolTargetId = neighbors.length ? pick(this.rng, neighbors) : targetNode.id;
        } else {
          _desired.copy(targetNode.pos).sub(d.pos).normalize();
        }
      }
    } else {
      // CHASE
      d.repathTimer -= dt;
      if (d.repathTimer <= 0) {
        d.repathTimer = 1.0;
        const fromId = nearestNodeId(graph, d.pos);
        const toId = nearestNodeId(graph, shipPos);
        d.currentPath = findPath(graph, fromId, toId, true);
        d.pathIndex = 1;
      }
      d.strafePhase += dt;

      if (shipAlive && los && dist > 0.001) {
        if (dist > 20) {
          _desired.copy(_dirToShip);
          targetSpeed = cfg.speed;
        } else if (dist < 12) {
          _desired.copy(_dirToShip).negate();
          targetSpeed = cfg.speed;
        } else {
          _perp.crossVectors(_dirToShip, UP);
          if (_perp.lengthSq() < 1e-6) _perp.set(1, 0, 0); else _perp.normalize();
          const sign = (Math.sin(d.strafePhase * 1.3) >= 0 ? 1 : -1) * d.strafeSign;
          _desired.copy(_perp).multiplyScalar(sign);
          targetSpeed = cfg.strafe;
        }

        if (dist < cfg.fireRange) {
          d.fireTimer -= dt;
          if (d.fireTimer <= 0 && this.projectiles) {
            d.fireTimer = cfg.fireCooldown;
            const boltSpeed = this.config.weapons.enemyBolt.speed;
            const leadT = (dist / boltSpeed) * 0.5;
            _leadPos.copy(shipPos).addScaledVector(ship.velocity, leadT);
            _fireDir.copy(_leadPos).sub(d.pos).normalize();
            this.projectiles.spawn('enemy', d.pos, _fireDir, 'enemyBolt');
          }
        }
      } else {
        let followed = false;
        if (d.currentPath && d.pathIndex < d.currentPath.length) {
          const node = this.nodeMap.get(d.currentPath[d.pathIndex]);
          if (node) {
            const dNode = d.pos.distanceTo(node.pos);
            if (dNode < Math.max(4, node.radius * 0.5)) {
              d.pathIndex++;
            } else {
              _desired.copy(node.pos).sub(d.pos).normalize();
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

    if (_desired.lengthSq() > 1e-8) {
      d.velocity.addScaledVector(_desired, cfg.accel * dt);
    }
    d.velocity.multiplyScalar(Math.max(0, 1 - 2.0 * dt));
    const speedNow = d.velocity.length();
    if (speedNow > targetSpeed) d.velocity.multiplyScalar(targetSpeed / speedNow);

    d.pos.addScaledVector(d.velocity, dt);

    const s = field.sample(d.pos.x, d.pos.y, d.pos.z);
    if (s > -d.radius) {
      field.collisionNormal(d.pos.x, d.pos.y, d.pos.z, _normal);
      d.pos.addScaledVector(_normal, s + d.radius);
      const into = d.velocity.dot(_normal);
      if (into < 0) d.velocity.addScaledVector(_normal, -into);
    }

    d.mesh.position.copy(d.pos);
    if (d.velocity.lengthSq() > 0.0025) {
      _faceDir.copy(d.velocity).normalize();
      d.mesh.quaternion.setFromUnitVectors(UNIT_Z, _faceDir);
    }
    d.ring.rotation.z += dt * 1.4;
  }

  _updateTurret(t, dt, shipPos, shipAlive, field) {
    const cfg = this.config.enemies.turret;
    if (!shipAlive) return;

    _toShip.copy(shipPos).sub(t.pos);
    const dist = _toShip.length();
    if (dist < 0.001) return;
    _dirToShip.copy(_toShip).multiplyScalar(1 / dist);

    const inRange = dist < cfg.fireRange;
    const los = inRange && field.raycast(t.pos, _dirToShip, dist) === -1;
    if (!los) return;

    // Aim: rotate the barrel head toward the ship. The head's local space is
    // parented to the wall-mount rotation, so express the world aim dir locally first.
    _q.copy(t.mesh.quaternion).invert();
    _target.copy(_dirToShip).applyQuaternion(_q);
    _aimQuat.setFromUnitVectors(UNIT_Z, _target);
    t.head.quaternion.slerp(_aimQuat, Math.min(1, dt * 4));

    t.fireTimer -= dt;
    if (t.fireTimer <= 0 && this.projectiles) {
      t.fireTimer = cfg.fireCooldown;
      _muzzle.copy(t.pos).addScaledVector(t.normal, t.radius * 0.6);
      this.projectiles.spawn('enemy', _muzzle, _dirToShip, 'enemyBolt');
    }
  }

  _updateReactor(r, dt, shipPos, shipAlive, field) {
    const cfg = this.config.enemies.reactor;

    r.mesh.rotation.y += (r.alive ? 0.6 : 0.15) * dt;
    r.mesh.rotation.x += (r.alive ? 0.25 : 0.05) * dt;

    if (r.flash > 0) r.flash = Math.max(0, r.flash - dt * 2.5);
    if (r.alive) {
      r.material.emissiveIntensity = 1.1 + r.flash * 2.5;
    } else {
      r.material.emissiveIntensity = Math.max(0, r.material.emissiveIntensity - dt * 0.6);
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
    for (let i = 0; i < this.drones.length; i++) if (this.drones[i].alive) out.push(this.drones[i]);
    for (let i = 0; i < this.turrets.length; i++) if (this.turrets[i].alive) out.push(this.turrets[i]);
    if (this.reactor) out.push(this.reactor);
    return out;
  }

  clear() {
    for (let i = 0; i < this.drones.length; i++) this.root.remove(this.drones[i].mesh);
    for (let i = 0; i < this.turrets.length; i++) this.root.remove(this.turrets[i].mesh);
    if (this.reactor) {
      this.root.remove(this.reactor.mesh);
      this.reactor.material.dispose();
    }
    while (this.root.children.length) this.root.remove(this.root.children[0]);

    this.drones = [];
    this.turrets = [];
    this.reactor = null;
    this.reactorAlive = false;
    this.graph = null;
    this.field = null;
    this.projectiles = null;
    this.nodeMap = new Map();
  }
}
