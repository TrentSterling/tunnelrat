// matrix.js : the Matrix view. Everything the game computes, visualized in OG CRT
// wireframe (additive green/cyan, depth-test off so you see through the rock).
// Deliberately reads EnemyManager/ProjectileSystem internals; this is a debug lens,
// not a gameplay system. Toggle via F3 or TR.debug.matrix().
//
// Shows: collision spheres (ship green, bots state-colored, projectiles cyan),
// enemy sight cones (patrol dim, chase red), the room graph as living navmesh with
// active drone paths pulsing bright, the locked-door blocking disc, and expanding
// AoE ghost rings from weapons.recentExplosions.
import * as THREE from 'three';
import { CONFIG } from './config.js';

const SPHERE_POOL = 48;
const CONE_POOL = 32;
const PATH_POOL = 16;
const PATH_MAX_PTS = 16;
const BOOM_POOL = 8;

const sphereGeo = new THREE.IcosahedronGeometry(1, 1);
const coneGeo = new THREE.ConeGeometry(1, 1, 8, 1, true);
coneGeo.rotateX(-Math.PI / 2); // opens along +Z (bot facing)
coneGeo.translate(0, 0, 0.5);  // apex at origin, base ahead

function wireMat(color, opacity) {
  return new THREE.MeshBasicMaterial({
    color, wireframe: true, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
  });
}

const MAT = {
  ship: wireMat(0x5cff8a, 0.5),
  botPatrol: wireMat(0x2f8fb3, 0.28),
  botChase: wireMat(0xff3b3b, 0.5),
  projectile: wireMat(0x39d0ff, 0.4),
  conePatrol: wireMat(0x2f8fb3, 0.10),
  coneChase: wireMat(0xff3b3b, 0.18),
  boom: wireMat(0xffb13b, 0.35),
  door: wireMat(0xff3b3b, 0.45),
};
const edgeMat = new THREE.LineBasicMaterial({
  color: 0x2fbf6f, transparent: true, opacity: 0.3,
  blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
});
const pathMat = new THREE.LineBasicMaterial({
  color: 0x5cff8a, transparent: true, opacity: 0.9,
  blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
});

const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _zero = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _upAlt = new THREE.Vector3(1, 0, 0);
const _dir = new THREE.Vector3();

export class MatrixView {
  constructor(scene) {
    this.visible = false;
    this.group = new THREE.Group();
    this.group.name = 'matrix';
    this.group.visible = false;
    this.group.renderOrder = 999;
    scene.add(this.group);

    this.spheres = this._pool(SPHERE_POOL, () => new THREE.Mesh(sphereGeo, MAT.ship));
    this.cones = this._pool(CONE_POOL, () => new THREE.Mesh(coneGeo, MAT.conePatrol));
    this.booms = this._pool(BOOM_POOL, () => new THREE.Mesh(sphereGeo, MAT.boom.clone())); // cloned: opacity fades per ring

    this.paths = [];
    for (let i = 0; i < PATH_POOL; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PATH_MAX_PTS * 3), 3));
      const line = new THREE.Line(geo, pathMat);
      line.visible = false;
      line.frustumCulled = false;
      this.group.add(line);
      this.paths.push(line);
    }

    this.graphLines = null;
    this.doorRing = null;
  }

  _pool(n, make) {
    const arr = [];
    for (let i = 0; i < n; i++) {
      const mesh = make();
      mesh.visible = false;
      this.group.add(mesh);
      arr.push(mesh);
    }
    return arr;
  }

  toggle() {
    this.visible = !this.visible;
    this.group.visible = this.visible;
  }

  setLevel(graph) {
    if (this.graphLines) { this.group.remove(this.graphLines); this.graphLines.geometry.dispose(); }
    if (this.doorRing) { this.group.remove(this.doorRing); this.doorRing.geometry.dispose(); }

    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const pts = [];
    for (const e of graph.edges) {
      const a = byId.get(e.a), b = byId.get(e.b);
      if (a && b) pts.push(a.pos, b.pos);
    }
    this.graphLines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), edgeMat);
    this.graphLines.frustumCulled = false;
    this.group.add(this.graphLines);

    const da = byId.get(graph.lockedEdge.a).pos, db = byId.get(graph.lockedEdge.b).pos;
    this.doorRing = new THREE.Mesh(new THREE.TorusGeometry(CONFIG.game.doorRadius, 0.15, 6, 20), MAT.door);
    this.doorRing.position.copy(da).lerp(db, 0.5);
    this.doorRing.lookAt(db);
    this.group.add(this.doorRing);
  }

  // ctx: { ship, enemies (EnemyManager), projectiles (ProjectileSystem), graph }
  update(ctx) {
    if (!this.visible) return;
    let si = 0, ci = 0, pi = 0;

    // ship collision sphere
    const s = this.spheres[si++];
    s.material = MAT.ship;
    s.position.copy(ctx.ship.object3d.position);
    s.scale.setScalar(CONFIG.ship.radius);
    s.visible = true;

    const nodeMap = ctx.enemies.nodeMap;
    const showCone = (entity, range, chase) => {
      if (ci >= CONE_POOL) return;
      const cone = this.cones[ci++];
      cone.material = chase ? MAT.coneChase : MAT.conePatrol;
      cone.position.copy(entity.pos);
      cone.quaternion.copy(entity.mesh.quaternion);
      const len = range * 0.35;
      cone.scale.set(len * 0.45, len * 0.45, len);
      cone.visible = true;
    };

    for (const b of ctx.enemies.bots) {
      if (!b.alive || si >= SPHERE_POOL) continue;
      const chase = b.state === 'chase';
      const sp = this.spheres[si++];
      sp.material = chase ? MAT.botChase : MAT.botPatrol;
      sp.position.copy(b.pos);
      sp.scale.setScalar(b.radius);
      sp.visible = true;
      showCone(b, CONFIG.enemies[b.classKey].sightRange, chase);

      // live path: the bot's current A* route through the room graph
      if (chase && b.currentPath && b.pathIndex < b.currentPath.length && pi < PATH_POOL) {
        const line = this.paths[pi++];
        const attr = line.geometry.getAttribute('position');
        let n = 0;
        attr.setXYZ(n++, b.pos.x, b.pos.y, b.pos.z);
        for (let k = b.pathIndex; k < b.currentPath.length && n < PATH_MAX_PTS; k++) {
          const node = nodeMap.get(b.currentPath[k]);
          if (node) attr.setXYZ(n++, node.pos.x, node.pos.y, node.pos.z);
        }
        line.geometry.setDrawRange(0, n);
        attr.needsUpdate = true;
        line.visible = true;
      }
    }
    for (const t of ctx.enemies.turrets) {
      if (!t.alive || si >= SPHERE_POOL) continue;
      const sp = this.spheres[si++];
      sp.material = MAT.botPatrol;
      sp.position.copy(t.pos);
      sp.scale.setScalar(t.radius);
      sp.visible = true;
    }
    if (ctx.enemies.reactor && ctx.enemies.reactor.alive && si < SPHERE_POOL) {
      const sp = this.spheres[si++];
      sp.material = MAT.botChase;
      sp.position.copy(ctx.enemies.reactor.pos);
      sp.scale.setScalar(ctx.enemies.reactor.radius);
      sp.visible = true;
    }

    // live projectiles
    for (const p of ctx.projectiles.pool) {
      if (!p.active || si >= SPHERE_POOL) continue;
      const sp = this.spheres[si++];
      sp.material = MAT.projectile;
      sp.position.copy(p.pos);
      sp.scale.setScalar(Math.max(0.25, p.radius));
      sp.visible = true;
    }

    // AoE ghost rings: recent detonations at true splash radius, fading over 1.2s
    let bi = 0;
    for (const ex of ctx.projectiles.recentExplosions) {
      if (ex.t > 1.2 || bi >= BOOM_POOL) continue;
      const bm = this.booms[bi++];
      bm.position.copy(ex.pos);
      bm.scale.setScalar(ex.radius);
      bm.material.opacity = 0.35 * (1 - ex.t / 1.2);
      bm.visible = true;
    }

    // park unused pool slots
    for (; si < SPHERE_POOL; si++) this.spheres[si].visible = false;
    for (; ci < CONE_POOL; ci++) this.cones[ci].visible = false;
    for (; pi < PATH_POOL; pi++) this.paths[pi].visible = false;
    for (; bi < BOOM_POOL; bi++) this.booms[bi].visible = false;
  }
}
