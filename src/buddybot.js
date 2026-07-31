// buddybot.js : Descent 2 style guidebot companion. A cute little green scout drone
// that LEADS the player toward the current mission objective (key/door/reactor/exit),
// staying close on a leash so it never strands the pilot. ON BY DEFAULT (Trent wants it
// active out of the box; `active` starts true, G toggles it in main/input).
//
// CONTRACT (implement exactly):
//
// class BuddyBot {
//   constructor(scene, config)
//   spawnAt(pos)                          // called on level load near the ship
//   active: boolean                       // G toggles; default true
//   setObjective(pos: Vector3 | null)     // current mission target, integrator feeds it
//   update(dt, ctx)                       // ctx: { shipPos, field, graph }
//   clear()                               // level teardown (dispose its own geometry/materials)
// }
//
// Behavior:
//   - Body is built inline (~10 parts): saucer dome + rim band + belly cap + recessed
//     nose socket + single bright emissive eye (nose, +Z) + antenna mast/tip + twin side
//     thruster nubs with glow discs. Flat-shaded MeshLambertMaterial, shared grunge map,
//     friendly green/white palette (distinct from the enemy robot palettes in robots.js).
//     Forward is local +Z, matching the aimAlong convention used by enemies.js.
//   - One SpotLight on the nose (the only light this module adds), aimed +Z via a child
//     target object so it always lights wherever the drone is pointed.
//   - LEADING: when an objective is set and ctx.graph is available, the path is computed
//     from the SHIP's node to the objective's node (findPath(..., allowLocked=true)) every
//     ~1s, i.e. the bot shares the pilot's route rather than solving its own; it flies to
//     the next unvisited node on that path, then falls through to the raw objective
//     position once the path is exhausted.
//   - LEASH: whatever the state, the bot is clamped to <= config.buddy.leash (~18m,
//     overridable) from the ship every frame; getting leash-clamped while chasing an
//     objective counts as "waiting" (chirp).
//   - IDLE (no objective): gentle bob + hovers just behind/above the ship, lagging.
//   - INACTIVE (active=false): parks ~3m off the ship's left shoulder and just hovers
//     along; no pathing, no chirps.
//   - Facing is roll-stabilized along the travel direction (same lookAt-based aimAlong
//     technique as enemies.js, duplicated locally since enemies.js doesn't export it).
//   - Wall avoidance is the same SDF push-out every other bot uses: field.sample() +
//     field.collisionNormal().
//
// ctx shape note: only ctx.shipPos (Vector3), ctx.field, ctx.graph are read, matching the
// documented contract. ctx.onChirp, if present, is called as onChirp('found' | 'waiting'),
// throttled to at most once every 6s per kind. Ship orientation is NOT part of the
// contracted ctx, so "left shoulder" / "behind the ship" directions are derived from the
// ship's recent world-space movement delta (falls back to +Z the first frame / while the
// ship is stationary) rather than from an unavailable quaternion.
//
// Config: reads an optional config.buddy block (not required to exist; main.js/config.js
// need not be touched for this to work) for tuning overrides; sane defaults built in.
import * as THREE from 'three';
import { findPath, nearestNodeId } from './procgen/graph.js';
import { grungeTexture } from './util/grungetex.js';

const UP = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Vector3(0, 0, 0);
const ALT_UP = new THREE.Vector3(1, 0, 0);

// module-scope scratch (no per-frame allocation)
const _shipDelta = new THREE.Vector3();
const _target = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _toBot = new THREE.Vector3();
const _left = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _faceDir = new THREE.Vector3();
const _aimQuat = new THREE.Quaternion();
const _lookM = new THREE.Matrix4();

// same technique as enemies.js aimAlong: Matrix4.lookAt(eye, target, up) points -Z from
// eye to target, so eye=dir target=origin puts local +Z on dir, roll-stabilized to world up.
function aimAlong(dir, out) {
  const up = Math.abs(dir.y) > 0.95 ? ALT_UP : UP;
  _lookM.lookAt(dir, ZERO, up);
  out.setFromRotationMatrix(_lookM);
  return out;
}

function part(parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  if (typeof s === 'number') m.scale.setScalar(s); else m.scale.copy(s);
  parent.add(m);
  return m;
}

// friendly palette, deliberately distinct from the enemy PALETTES in robots.js
function buildMaterials() {
  const map = grungeTexture();
  return {
    hull: new THREE.MeshLambertMaterial({ color: 0x5fd487, flatShading: true, map }),
    trim: new THREE.MeshLambertMaterial({ color: 0xeef3ea, flatShading: true, map }),
    dark: new THREE.MeshLambertMaterial({ color: 0x1c2a20, flatShading: true, map }),
    eye: new THREE.MeshLambertMaterial({ color: 0xe8fff2, emissive: 0xbdffe0, emissiveIntensity: 2.8 }),
    thruster: new THREE.MeshLambertMaterial({ color: 0x6de8ff, emissive: 0x6de8ff, emissiveIntensity: 2.2 }),
  };
}

// ~10-11 parts: saucer dome, rim band, belly cap, nose socket, eye, antenna mast + tip,
// twin thruster nubs + glow discs. Faces local +Z.
function buildBody() {
  const group = new THREE.Group();
  const mats = buildMaterials();

  const dome = part(group, new THREE.SphereGeometry(0.5, 8, 6), mats.hull, 0, 0.04, 0);
  dome.scale.set(0.8, 0.5, 0.85);
  part(group, new THREE.CylinderGeometry(0.6, 0.6, 0.12, 8), mats.trim, 0, -0.04, 0);
  part(group, new THREE.ConeGeometry(0.38, 0.32, 6), mats.dark, 0, -0.28, 0, Math.PI, 0, 0);

  part(group, new THREE.BoxGeometry(0.22, 0.2, 0.12), mats.dark, 0, 0.06, 0.54);
  part(group, new THREE.OctahedronGeometry(0.13, 0), mats.eye, 0, 0.06, 0.65);

  const mast = new THREE.Group();
  mast.position.set(0, 0.32, -0.12);
  mast.rotation.x = -0.25;
  part(mast, new THREE.CylinderGeometry(0.02, 0.02, 0.32, 5), mats.trim, 0, 0.16, 0);
  part(mast, new THREE.OctahedronGeometry(0.045, 0), mats.eye, 0, 0.32, 0);
  group.add(mast);

  for (const side of [-1, 1]) {
    part(group, new THREE.CylinderGeometry(0.09, 0.09, 0.24, 6), mats.dark,
      side * 0.56, -0.04, -0.05, 0, 0, Math.PI / 2);
    part(group, new THREE.CylinderGeometry(0.07, 0.07, 0.03, 6), mats.thruster,
      side * 0.56, -0.04, -0.17, 0, 0, Math.PI / 2);
  }

  return group;
}

const DEFAULTS = {
  radius: 0.55,
  speed: 16,
  accel: 34,
  damping: 2.4,
  leash: 18,
  parkOffset: 3,
  parkHeight: 0.35,
  bobAmp: 0.16,
  bobFreq: 1.8,
  waypointArriveDist: 4,
  repathInterval: 1.0,
  foundDist: 8,
  chirpCooldown: 6,
  idleHoverBack: 4,
  idleHoverUp: 1.1,
};

export class BuddyBot {
  constructor(scene, config) {
    this.scene = scene;
    this.cfg = { ...DEFAULTS, ...(config?.buddy || {}) };

    this.group = buildBody();
    this.group.name = 'buddybot';
    scene.add(this.group);

    this.light = new THREE.SpotLight(0xeafff5, 6, 24, 0.55, 0.45, 2);
    this.light.position.set(0, 0.06, 0.5);
    const lightTarget = new THREE.Object3D();
    lightTarget.position.set(0, 0.06, 9);
    this.group.add(this.light, lightTarget);
    this.light.target = lightTarget;

    this.pos = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this._active = true;
    this._objectivePos = null;
    this._path = null;
    this._pathIndex = 1;
    this._repathTimer = 0;
    this._foundCooldown = 0;
    this._waitCooldown = 0;
    this._heading = new THREE.Vector3(0, 0, 1);
    this._prevShipPos = new THREE.Vector3();
    this._havePrevShip = false;
    this._time = 0;
  }

  get active() { return this._active; }
  set active(v) {
    const was = this._active;
    this._active = !!v;
    if (!was && this._active) this._repathTimer = 0; // resume: force a fresh path
  }

  spawnAt(pos) {
    this.pos.copy(pos);
    this.velocity.set(0, 0, 0);
    this.group.position.copy(pos);
    this._path = null;
    this._pathIndex = 1;
    this._repathTimer = 0;
    this._foundCooldown = 1.5; // don't chirp instantly on spawn
    this._waitCooldown = 1.5;
    this._havePrevShip = false;
  }

  setObjective(pos) {
    this._objectivePos = pos ? pos.clone() : null;
    this._path = null;
    this._pathIndex = 1;
    this._repathTimer = 0; // repath next update
  }

  // find the next path waypoint's world position, advancing pathIndex as nodes are
  // reached; falls through to the raw objective once the path is exhausted / missing.
  _pathTarget(graph) {
    if (!this._path || this._path.length === 0) return this._objectivePos;
    while (this._pathIndex < this._path.length) {
      const nodeId = this._path[this._pathIndex];
      const node = graph.nodes.find((n) => n.id === nodeId);
      if (!node) { this._pathIndex++; continue; }
      const dNode = this.pos.distanceTo(node.pos);
      if (dNode < Math.max(this.cfg.waypointArriveDist, node.radius * 0.4)) {
        this._pathIndex++;
        continue;
      }
      return node.pos;
    }
    return this._objectivePos;
  }

  update(dt, ctx) {
    const shipPos = ctx && ctx.shipPos;
    if (!shipPos) return;
    const field = ctx.field || null;
    const graph = ctx.graph || null;
    const onChirp = ctx.onChirp;

    this._time += dt;
    this._foundCooldown = Math.max(0, this._foundCooldown - dt);
    this._waitCooldown = Math.max(0, this._waitCooldown - dt);

    // world-space heading estimate from the ship's own movement (ctx carries no
    // orientation) : used for "behind the ship" / "left shoulder" directions.
    if (this._havePrevShip) {
      _shipDelta.copy(shipPos).sub(this._prevShipPos);
      if (_shipDelta.lengthSq() > 1e-6) this._heading.copy(_shipDelta).normalize();
    }
    this._prevShipPos.copy(shipPos);
    this._havePrevShip = true;

    let maxSpeed = this.cfg.speed;

    if (!this._active) {
      // parked off the left shoulder, just hovering; no pathing, no chirps
      _left.crossVectors(UP, this._heading).normalize();
      _target.copy(shipPos).addScaledVector(_left, this.cfg.parkOffset).addScaledVector(UP, this.cfg.parkHeight);
      maxSpeed = this.cfg.speed * 0.6;
      this._steerAndCollide(dt, _target, maxSpeed, field, null);
      this._applyVisuals(dt);
      return;
    }

    let wp = null;
    if (this._objectivePos && graph) {
      this._repathTimer -= dt;
      if (this._repathTimer <= 0 || !this._path) {
        this._repathTimer = this.cfg.repathInterval;
        const fromId = nearestNodeId(graph, shipPos);
        const toId = nearestNodeId(graph, this._objectivePos);
        this._path = findPath(graph, fromId, toId, true);
        this._pathIndex = 1;
      }
      wp = this._pathTarget(graph);
    } else if (this._objectivePos) {
      wp = this._objectivePos; // no graph yet: best-effort straight flight
    }

    if (wp) {
      _target.copy(wp);
    } else {
      // idle: gentle lag-behind hover
      _target.copy(shipPos).addScaledVector(this._heading, -this.cfg.idleHoverBack).addScaledVector(UP, this.cfg.idleHoverUp);
    }

    const waiting = this._steerAndCollide(dt, _target, maxSpeed, field, shipPos);

    if (waiting && this._objectivePos && this._waitCooldown <= 0) {
      onChirp?.('waiting');
      this._waitCooldown = this.cfg.chirpCooldown;
    }
    if (this._objectivePos) {
      const dObj = this.pos.distanceTo(this._objectivePos);
      if (dObj < this.cfg.foundDist && this._foundCooldown <= 0) {
        onChirp?.('found');
        this._foundCooldown = this.cfg.chirpCooldown;
      }
    }

    this._applyVisuals(dt);
  }

  // accelerate toward target, damp, cap speed, integrate, leash-clamp (if shipPos given),
  // SDF wall avoidance. Returns true if leash-clamped this frame ("waiting" for the pilot).
  _steerAndCollide(dt, target, maxSpeed, field, shipPos) {
    _desired.copy(target).sub(this.pos);
    const distToTarget = _desired.length();
    if (distToTarget > 1e-4) {
      _desired.multiplyScalar(1 / distToTarget);
      this.velocity.addScaledVector(_desired, this.cfg.accel * dt);
    }
    this.velocity.multiplyScalar(Math.max(0, 1 - this.cfg.damping * dt));
    const spd = this.velocity.length();
    if (spd > maxSpeed) this.velocity.multiplyScalar(maxSpeed / spd);

    this.pos.addScaledVector(this.velocity, dt);

    let waiting = false;
    if (shipPos) {
      _toBot.copy(this.pos).sub(shipPos);
      const d = _toBot.length();
      if (d > this.cfg.leash) {
        _toBot.multiplyScalar(1 / d);
        this.pos.copy(shipPos).addScaledVector(_toBot, this.cfg.leash);
        const into = this.velocity.dot(_toBot);
        if (into > 0) this.velocity.addScaledVector(_toBot, -into);
        waiting = true;
      }
    }

    if (field) {
      const s = field.sample(this.pos.x, this.pos.y, this.pos.z);
      if (s > -this.cfg.radius) {
        field.collisionNormal(this.pos.x, this.pos.y, this.pos.z, _normal);
        this.pos.addScaledVector(_normal, s + this.cfg.radius);
        const into = this.velocity.dot(_normal);
        if (into < 0) this.velocity.addScaledVector(_normal, -into);
      }
    }

    return waiting;
  }

  _applyVisuals(dt) {
    const bob = Math.sin(this._time * this.cfg.bobFreq) * this.cfg.bobAmp;
    this.group.position.copy(this.pos);
    this.group.position.y += bob;

    if (this.velocity.lengthSq() > 0.04) {
      _faceDir.copy(this.velocity).normalize();
      aimAlong(_faceDir, _aimQuat);
      this.group.quaternion.slerp(_aimQuat, Math.min(1, dt * 4));
    } else {
      aimAlong(this._heading, _aimQuat);
      this.group.quaternion.slerp(_aimQuat, Math.min(1, dt * 2));
    }
  }

  clear() {
    this.group.traverse((o) => {
      if (o.isMesh) {
        o.geometry?.dispose();
        o.material?.dispose();
      }
    });
    this.scene.remove(this.group);
    this._objectivePos = null;
    this._path = null;
  }
}
