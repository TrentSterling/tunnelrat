// weapons.js : pooled projectiles for player + enemies, wall hits via density field.
//
// CONTRACT (implement exactly):
//
// class ProjectileSystem {
//   constructor(scene, field, config)
//   spawn(owner, pos:Vector3, dir:Vector3 unit, kind)
//     owner: 'player' | 'enemy'
//     kind:  'laser' | 'enemyBolt' | 'reactorBolt' (keys into config.weapons)
//   update(dt, ctx) where ctx = {
//     enemies,        // EnemyManager: iterate ctx.enemies.list() -> { pos, radius, takeDamage(n), alive }
//     ship,           // Ship (pos = ship.object3d.position, radius config.ship.radius)
//     onShipHit: (damage) => void,     // main wires: sfx + hud flash + shake
//     onEnemyHit: (enemy, damage) => void,
//     onWallHit: (pos) => void,
//   }
//   clear()          // despawn all (level transition)
// }
//
// Behavior per projectile per frame: move pos += dir*speed*dt; life -= dt.
//   Wall: field.sample(pos) >= 0 -> onWallHit, despawn.
//   Player bolts test vs enemies (sphere dist < radius+enemy.radius): enemy.takeDamage,
//   onEnemyHit, despawn. Enemy bolts test vs ship: onShipHit(damage), despawn.
//   life <= 0 -> despawn.
// Visuals: pool of ~128 reusable meshes (small elongated box or capsule-ish, oriented
//   along dir, MeshBasicMaterial with the kind's color, plus an additive-blended
//   slightly larger transparent shell for glow). NO per-shot allocations after pool
//   warmup; hide despawned via .visible=false.
// One shared PointLight (color per last player shot) is OPTIONAL; skip if simpler.
import * as THREE from 'three';

const POOL_SIZE = 128;
const UNIT_Z = new THREE.Vector3(0, 0, 1);

export class ProjectileSystem {
  constructor(scene, field, config) {
    this.scene = scene;
    this.field = field;
    this.config = config;

    // Per-kind cached geometry + material: spawn() only ever swaps references,
    // never allocates. Sized off each weapon's collision radius for a little variety.
    this._visuals = {};
    for (const kind of Object.keys(config.weapons)) {
      const w = config.weapons[kind];
      const len = Math.max(0.9, w.radius * 3.0);
      const thick = Math.max(0.12, w.radius * 0.55);
      const coreGeo = new THREE.BoxGeometry(thick, thick, len);
      const glowGeo = new THREE.BoxGeometry(thick * 2.1, thick * 2.1, len * 1.15);
      const coreMat = new THREE.MeshBasicMaterial({ color: w.color });
      const glowMat = new THREE.MeshBasicMaterial({
        color: w.color,
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      this._visuals[kind] = { coreGeo, glowGeo, coreMat, glowMat };
    }

    // Fixed pool, warmed up once: every projectile record + its mesh graph exists
    // for the lifetime of the system, added to the scene hidden, reused forever.
    this.pool = new Array(POOL_SIZE);
    this._free = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const group = new THREE.Group();
      const core = new THREE.Mesh();
      const glow = new THREE.Mesh();
      group.add(core, glow);
      group.visible = false;
      scene.add(group);
      this.pool[i] = {
        active: false,
        owner: null,
        kind: null,
        pos: new THREE.Vector3(),
        dir: new THREE.Vector3(1, 0, 0),
        speed: 0,
        damage: 0,
        life: 0,
        radius: 0.3,
        mesh: group,
        core,
        glow,
      };
      this._free.push(i);
    }
  }

  spawn(owner, pos, dir, kind) {
    const wcfg = this.config.weapons[kind];
    if (!wcfg) return;

    let idx;
    if (this._free.length > 0) {
      idx = this._free.pop();
    } else {
      // Pool exhausted (shouldn't normally happen at 128): steal the projectile
      // with the least life remaining rather than allocating a new one.
      idx = -1;
      let minLife = Infinity;
      for (let i = 0; i < POOL_SIZE; i++) {
        const p = this.pool[i];
        if (p.active && p.life < minLife) { minLife = p.life; idx = i; }
      }
      if (idx === -1) return;
    }

    const p = this.pool[idx];
    const vis = this._visuals[kind];
    p.active = true;
    p.owner = owner;
    p.kind = kind;
    p.pos.copy(pos);
    p.dir.copy(dir).normalize();
    p.speed = wcfg.speed;
    p.damage = wcfg.damage;
    p.life = wcfg.life;
    p.radius = wcfg.radius;

    p.core.geometry = vis.coreGeo;
    p.core.material = vis.coreMat;
    p.glow.geometry = vis.glowGeo;
    p.glow.material = vis.glowMat;

    p.mesh.position.copy(p.pos);
    p.mesh.quaternion.setFromUnitVectors(UNIT_Z, p.dir);
    p.mesh.visible = true;
  }

  _despawn(idx) {
    const p = this.pool[idx];
    p.active = false;
    p.mesh.visible = false;
    this._free.push(idx);
  }

  update(dt, ctx) {
    const field = this.field;
    const ship = ctx.ship;
    const shipRadius = this.config.ship.radius;
    // Fetch the enemy list once per frame, not once per projectile.
    const enemyList = ctx.enemies ? ctx.enemies.list() : null;

    for (let i = 0; i < POOL_SIZE; i++) {
      const p = this.pool[i];
      if (!p.active) continue;

      p.pos.addScaledVector(p.dir, p.speed * dt);
      p.mesh.position.copy(p.pos);
      p.life -= dt;

      if (p.life <= 0) { this._despawn(i); continue; }

      if (field.sample(p.pos.x, p.pos.y, p.pos.z) >= 0) {
        if (ctx.onWallHit) ctx.onWallHit(p.pos);
        this._despawn(i);
        continue;
      }

      if (p.owner === 'player' && enemyList) {
        let hit = false;
        for (let j = 0; j < enemyList.length; j++) {
          const enemy = enemyList[j];
          if (!enemy.alive) continue;
          const rr = p.radius + enemy.radius;
          if (p.pos.distanceToSquared(enemy.pos) < rr * rr) {
            enemy.takeDamage(p.damage);
            if (ctx.onEnemyHit) ctx.onEnemyHit(enemy, p.damage);
            hit = true;
            break;
          }
        }
        if (hit) { this._despawn(i); continue; }
      } else if (p.owner === 'enemy' && ship && ship.alive) {
        const rr = p.radius + shipRadius;
        if (p.pos.distanceToSquared(ship.object3d.position) < rr * rr) {
          if (ctx.onShipHit) ctx.onShipHit(p.damage);
          this._despawn(i);
          continue;
        }
      }
    }
  }

  clear() {
    this._free.length = 0;
    for (let i = 0; i < POOL_SIZE; i++) {
      const p = this.pool[i];
      p.active = false;
      p.mesh.visible = false;
      this._free.push(i);
    }
  }
}
