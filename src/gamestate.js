// gamestate.js : mission logic + objective props (key, door, exit beacon). Owns the
// phase machine; main.js reads phase and wires transitions to hud/sfx.
//
// CONTRACT (implement exactly):
//
// class GameState {
//   constructor(scene, config)
//   phase: 'playing' | 'escape' | 'dead' | 'won'
//   hasKey: boolean
//   escapeRemaining: number    // seconds, only meaningful in 'escape'
//   depth: number
//
//   startLevel(graph, field, depth)  // builds objective props into scene:
//     // KEY: spinning gold octahedron + point light at key node center (bob slowly)
//     // DOOR: glowing red disc/hex barrier mesh centered on the locked edge's tunnel:
//     //   position = midpoint of lockedEdge node positions projected: use the point on
//     //   the edge polyline nearest the reactor-side node minus 6m... SIMPLE RULE:
//     //   place at the locked edge midpoint, oriented so its plane normal = edge
//     //   direction (a.pos - b.pos normalized). Radius config.game.doorRadius. Double
//     //   sided, pulsing emissive, slow spin.
//     // EXIT: cyan beacon (cone + light) at exit node, dim until 'escape' phase then bright + strobe.
//   update(dt, ship) -> events: array of strings emitted THIS frame, any of:
//     'keyPickup' | 'doorOpen' | 'doorBlocked' | 'escapeStart' | 'escaped' | 'died' | 'timeUp'
//     // keyPickup: dist(ship, key) < keyPickupDist -> hasKey=true, hide key mesh
//     // door: while locked, if ship sphere intersects door disc plane within
//     //   doorRadius: push ship out along the disc normal (matching side), zero the
//     //   into-plane velocity; emit 'doorBlocked' at most once per second while shoving.
//     //   If hasKey and dist(ship, door) < doorRadius + 4: unlock (emit 'doorOpen',
//     //   fade the barrier out over 1s, stop blocking, tell automap via main).
//     // NOTE: while locked the door must ALSO block enemy/player bolts? NO: keep it
//     //   simple, bolts pass, only the ship is blocked.
//     // 'died': ship.alive false (watch it here so main has one place to poll)
//   reactorDestroyed()   // called by main when EnemyManager fires onReactorDestroyed:
//     // phase='escape', escapeRemaining = min(escapeTime + 5*(depth-1), 70), emits
//     // 'escapeStart' from next update; in escape, timer counts down: 0 -> kill ship
//     // (emit 'timeUp' + 'died'); reaching exit (dist < exitDist) -> phase='won', 'escaped'.
//   clearProps()         // remove key/door/exit meshes (level transition)
// }
//
// Keep all THREE objects internal; expose doorMesh position readonly if trivially easy
// (automap does not need it). Deterministic prop placement (no rng needed).
import * as THREE from 'three';

// module-scope scratch (no per-frame allocation in update()'s hot path)
const _toShip = new THREE.Vector3();
const _radial = new THREE.Vector3();

export class GameState {
  constructor(scene, config) {
    this.scene = scene;
    this.config = config;

    this.phase = 'playing';
    this.hasKey = false;
    this.escapeRemaining = 0;
    this.depth = 1;

    this.time = 0;

    // key
    this.keyMesh = null;
    this.keyLight = null;
    this.keyBasePos = new THREE.Vector3();

    // door
    this.doorMesh = null;
    this.doorLocked = true;
    this.doorPos = new THREE.Vector3();
    this.doorNormal = new THREE.Vector3(0, 0, 1);
    this.doorBlockTimer = 0;
    this.doorFadeTimer = 0;

    // exit
    this.exitMesh = null;
    this.exitLight = null;
    this.exitPos = new THREE.Vector3();

    this._pendingEscapeStart = false;
  }

  startLevel(graph, field, depth) {
    this.clearProps();

    this.phase = 'playing';
    this.hasKey = false;
    this.escapeRemaining = 0;
    this.depth = depth;
    this.time = 0;
    this.doorLocked = true;
    this.doorBlockTimer = 0;
    this.doorFadeTimer = 0;
    this._pendingEscapeStart = false;

    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const keyNode = byId.get(graph.keyId);
    const exitNode = byId.get(graph.exitId);
    const doorA = byId.get(graph.lockedEdge.a);
    const doorB = byId.get(graph.lockedEdge.b);

    // ---- KEY: spinning gold octahedron + point light, bobs slowly ----
    this.keyBasePos.copy(keyNode.pos);
    const keyGeo = new THREE.OctahedronGeometry(1.1, 0);
    const keyMat = new THREE.MeshStandardMaterial({
      color: this.config.colors.key, emissive: this.config.colors.key,
      emissiveIntensity: 0.8, metalness: 0.3, roughness: 0.4,
    });
    this.keyMesh = new THREE.Mesh(keyGeo, keyMat);
    this.keyMesh.position.copy(this.keyBasePos);
    this.scene.add(this.keyMesh);
    this.keyLight = new THREE.PointLight(this.config.colors.key, 6, 22);
    this.keyLight.position.copy(this.keyBasePos);
    this.scene.add(this.keyLight);

    // ---- DOOR: hex disc barrier centered on the locked edge, normal = edge direction ----
    this.doorPos.addVectors(doorA.pos, doorB.pos).multiplyScalar(0.5);
    this.doorNormal.subVectors(doorA.pos, doorB.pos).normalize();
    if (this.doorNormal.lengthSq() < 1e-6) this.doorNormal.set(0, 0, 1);

    const doorGeo = new THREE.CircleGeometry(this.config.game.doorRadius, 6);
    const doorMat = new THREE.MeshBasicMaterial({
      color: this.config.colors.door, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
    });
    this.doorMesh = new THREE.Mesh(doorGeo, doorMat);
    this.doorMesh.position.copy(this.doorPos);
    this.doorMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.doorNormal);
    this.scene.add(this.doorMesh);

    // ---- EXIT: cyan beacon, dim until escape phase ----
    this.exitPos.copy(exitNode.pos);
    const exitGeo = new THREE.ConeGeometry(1.6, 4, 10);
    const exitMat = new THREE.MeshBasicMaterial({ color: this.config.colors.exit, transparent: true, opacity: 0.35 });
    this.exitMesh = new THREE.Mesh(exitGeo, exitMat);
    this.exitMesh.position.copy(this.exitPos);
    this.scene.add(this.exitMesh);
    this.exitLight = new THREE.PointLight(this.config.colors.exit, 1.5, 40);
    this.exitLight.position.copy(this.exitPos);
    this.scene.add(this.exitLight);
  }

  update(dt, ship) {
    this.time += dt;
    const events = [];

    if (this._pendingEscapeStart) {
      this._pendingEscapeStart = false;
      events.push('escapeStart');
    }

    // ---- prop animation ----
    if (this.keyMesh) {
      this.keyMesh.rotation.y += dt * 1.4;
      this.keyMesh.position.y = this.keyBasePos.y + Math.sin(this.time * 1.6) * 0.6;
    }
    if (this.doorMesh) {
      this.doorMesh.rotateZ(dt * 0.6);
      if (this.doorLocked) {
        this.doorMesh.material.opacity = 0.45 + Math.sin(this.time * 3) * 0.18;
      } else {
        this.doorFadeTimer -= dt;
        this.doorMesh.material.opacity = Math.max(0, this.doorFadeTimer) * 0.55;
        if (this.doorFadeTimer <= 0) {
          this.scene.remove(this.doorMesh);
          this.doorMesh.geometry.dispose();
          this.doorMesh.material.dispose();
          this.doorMesh = null;
        }
      }
    }
    if (this.exitMesh) {
      this.exitMesh.rotation.y += dt * 0.8;
      if (this.phase === 'escape') {
        const strobe = 0.6 + Math.abs(Math.sin(this.time * 8)) * 0.4;
        this.exitMesh.material.opacity = strobe;
        this.exitLight.intensity = 4 + strobe * 10;
      } else {
        this.exitMesh.material.opacity = 0.35;
        this.exitLight.intensity = 1.5;
      }
    }

    if (this.phase === 'playing' || this.phase === 'escape') {
      // ---- key pickup ----
      if (!this.hasKey && this.keyMesh) {
        const d = ship.object3d.position.distanceTo(this.keyBasePos);
        if (d < this.config.game.keyPickupDist) {
          this.hasKey = true;
          this.scene.remove(this.keyMesh);
          this.keyMesh.geometry.dispose();
          this.keyMesh.material.dispose();
          this.keyMesh = null;
          if (this.keyLight) { this.scene.remove(this.keyLight); this.keyLight = null; }
          events.push('keyPickup');
        }
      }

      // ---- door blocking / unlock ----
      if (this.doorLocked) {
        const shipPos = ship.object3d.position;
        const shipRadius = this.config.ship.radius;
        const doorDist = shipPos.distanceTo(this.doorPos);

        if (this.hasKey && doorDist < this.config.game.doorRadius + 4) {
          this.doorLocked = false;
          this.doorFadeTimer = 1.0;
          this.doorBlockTimer = 0;
          events.push('doorOpen');
        } else {
          _toShip.subVectors(shipPos, this.doorPos);
          const distAlongNormal = _toShip.dot(this.doorNormal);
          _radial.copy(_toShip).addScaledVector(this.doorNormal, -distAlongNormal);
          const radialDist = _radial.length();
          const blocking = radialDist < this.config.game.doorRadius && Math.abs(distAlongNormal) < shipRadius + 0.5;

          if (blocking) {
            const side = Math.sign(distAlongNormal) || 1;
            const penetration = (shipRadius + 0.5) - Math.abs(distAlongNormal);
            if (penetration > 0) shipPos.addScaledVector(this.doorNormal, side * penetration);

            const velAlong = ship.velocity.dot(this.doorNormal) * side;
            if (velAlong < 0) ship.velocity.addScaledVector(this.doorNormal, -velAlong * side);

            this.doorBlockTimer -= dt;
            if (this.doorBlockTimer <= 0) {
              this.doorBlockTimer = 1.0;
              events.push('doorBlocked');
            }
          } else {
            this.doorBlockTimer = 0;
          }
        }
      }

      // ---- death watch ----
      if (!ship.alive && this.phase !== 'dead') {
        this.phase = 'dead';
        events.push('died');
      }
    }

    if (this.phase === 'escape') {
      this.escapeRemaining -= dt;
      if (this.escapeRemaining <= 0) {
        this.escapeRemaining = 0;
        ship.alive = false;
        this.phase = 'dead';
        events.push('timeUp', 'died');
      } else {
        const d = ship.object3d.position.distanceTo(this.exitPos);
        if (d < this.config.game.exitDist) {
          this.phase = 'won';
          events.push('escaped');
        }
      }
    }

    return events;
  }

  reactorDestroyed() {
    if (this.phase !== 'playing') return;
    const bonus = 5 * (this.depth - 1);
    this.escapeRemaining = Math.min(this.config.game.escapeTime + bonus, 70);
    this.phase = 'escape';
    this._pendingEscapeStart = true;
  }

  clearProps() {
    if (this.keyMesh) {
      this.scene.remove(this.keyMesh);
      this.keyMesh.geometry.dispose();
      this.keyMesh.material.dispose();
      this.keyMesh = null;
    }
    if (this.keyLight) { this.scene.remove(this.keyLight); this.keyLight = null; }
    if (this.doorMesh) {
      this.scene.remove(this.doorMesh);
      this.doorMesh.geometry.dispose();
      this.doorMesh.material.dispose();
      this.doorMesh = null;
    }
    if (this.exitMesh) {
      this.scene.remove(this.exitMesh);
      this.exitMesh.geometry.dispose();
      this.exitMesh.material.dispose();
      this.exitMesh = null;
    }
    if (this.exitLight) { this.scene.remove(this.exitLight); this.exitLight = null; }
  }
}
