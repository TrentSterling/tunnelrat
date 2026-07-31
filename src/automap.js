// automap.js : the iconic Descent wireframe map, rendered from the level graph.
//
// CONTRACT (implement exactly):
//
// class Automap {
//   constructor(graph)         // build its own THREE.Scene: cyan wireframe
//   visible: boolean
//   toggle()
//   visit(nodeId)              // mark node discovered; nodes start hidden except spawn.
//                              // An edge shows when EITHER end is visited.
//   rebuild(graph)             // new level (then call setCaveMesh with the new group)
//   setCaveMesh(caveGroup)     // full cave mesh rendered as a scanner hologram
//   setKeyTaken()              // hide the key POI marker after pickup
//   render(renderer, shipPos, shipQuat, enemies)  // call AFTER main scene render when visible:
//     renderer.autoClear=false, clear depth only, render map scene fullscreen with its
//     own camera orbiting the graph centroid (slow auto-rotate), then restore state.
// }
//
// Visuals: edges as THREE.LineSegments (cyan, locked edge red until unlocked: expose
// setDoorOpen(bool) to flip it green); visited nodes as small wireframe icosahedra;
// special nodes tinted (key gold, reactor orange, exit cyan, spawn white); undiscovered
// = invisible. Ship = small bright triangle/cone at shipPos oriented by shipQuat.
// Background: transparent (do NOT clear color), a faint fullscreen dim quad is fine
// via a css class on document.body ('map-open') that hud.css already dims? NO: keep it
// self-contained, add a large black plane at far depth with opacity 0.75 in the map scene.
import * as THREE from 'three';
import { CONFIG } from './config.js';

const _size = new THREE.Vector2();

// shared, module-scope geometry (no per-frame / per-rebuild allocation of these)
const nodeGeo = new THREE.IcosahedronGeometry(1, 0);
const shipGeo = new THREE.ConeGeometry(0.9, 2.6, 8);
shipGeo.rotateX(-Math.PI / 2); // apex now points along local -Z (ship "forward")

const COLOR = {
  spawn: 0xffffff,
  key: CONFIG.colors.key,
  reactor: CONFIG.colors.reactor,
  exit: CONFIG.colors.exit,
  room: 0x2f8fb3,
  edge: 0x39d0ff,
  door: CONFIG.colors.door,
  doorOpen: CONFIG.colors.doorOpen,
  ship: 0xffffff,
  enemy: 0xff4a4a,
};

// hologram materials, shared across all cave chunks (rebuilds swap geometry only)
const holoFillMat = new THREE.MeshBasicMaterial({
  color: 0x1a7a9e, transparent: true, opacity: 0.07,
  blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
});
const holoWireMat = new THREE.MeshBasicMaterial({
  color: 0x39d0ff, wireframe: true, transparent: true, opacity: 0.05,
  blending: THREE.AdditiveBlending, depthWrite: false,
});
const enemyGeo = new THREE.OctahedronGeometry(1.6, 0);
const poiRingGeo = new THREE.TorusGeometry(5, 0.5, 6, 24);

export class Automap {
  constructor(graph) {
    this.visible = false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 1, 3000);
    this.scene.add(this.camera);

    // fullscreen dim backdrop, parented to the camera so it always covers the view;
    // renderOrder -1 + no depth test/write = painter's-algorithm background, no color clear needed
    this.dimPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(6000, 6000),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.75, depthWrite: false, depthTest: false })
    );
    this.dimPlane.renderOrder = -1;
    this.dimPlane.position.set(0, 0, -500);
    this.camera.add(this.dimPlane);

    // player beacon: bright additive cone + pulsing halo ring, unmissable by design
    this.shipMesh = new THREE.Mesh(shipGeo, new THREE.MeshBasicMaterial({
      color: 0xffffff, blending: THREE.AdditiveBlending, depthTest: false, transparent: true,
    }));
    this.shipMesh.scale.setScalar(3.2);
    this.shipMesh.renderOrder = 10;
    this.scene.add(this.shipMesh);
    this.shipHalo = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.09, 6, 24),
      new THREE.MeshBasicMaterial({
        color: 0x5cff8a, blending: THREE.AdditiveBlending, depthTest: false,
        transparent: true, opacity: 0.9,
      })
    );
    this.shipHalo.renderOrder = 10;
    this.scene.add(this.shipHalo);

    this.nodeMeshes = new Map();
    this.edgeLines = [];
    this.lockedLine = null;
    this.visited = new Set();
    this.centroid = new THREE.Vector3();
    this.orbitRadius = 100;

    // hologram cave shell + entity/POI markers
    this.holoGroup = new THREE.Group();
    this.scene.add(this.holoGroup);
    this.enemyMarkers = []; // pooled octahedra, grown on demand
    this.poi = {};          // key / door / exit / reactor marker meshes

    this._build(graph);
  }

  // Full cave mesh as a scanner hologram: reuses the live chunk geometries (no copies).
  // Call after every rebuild(); main.js owns geometry disposal on level change.
  setCaveMesh(caveGroup) {
    this.holoGroup.clear();
    caveGroup.traverse((o) => {
      if (!o.isMesh) return;
      const fill = new THREE.Mesh(o.geometry, holoFillMat);
      const wire = new THREE.Mesh(o.geometry, holoWireMat);
      this.holoGroup.add(fill, wire);
    });
  }

  _makePoi(kind, pos, geo, scale) {
    const mat = new THREE.MeshBasicMaterial({
      color: COLOR[kind], transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.scale.setScalar(scale);
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.poi[kind] = mesh;
    return mesh;
  }

  _build(graph) {
    for (const rec of this.nodeMeshes.values()) {
      this.scene.remove(rec.mesh);
      rec.mesh.material.dispose();
    }
    for (const e of this.edgeLines) {
      this.scene.remove(e.line);
      e.line.geometry.dispose();
      e.line.material.dispose();
    }
    this.nodeMeshes.clear();
    this.edgeLines.length = 0;
    this.lockedLine = null;
    this.visited.clear();

    this.holoGroup.clear(); // stale level shell; setCaveMesh() brings the new one
    for (const m of Object.values(this.poi)) { this.scene.remove(m); m.material.dispose(); }
    this.poi = {};
    for (const m of this.enemyMarkers) m.visible = false;

    const box = new THREE.Box3();
    for (const n of graph.nodes) box.expandByPoint(n.pos);
    box.getCenter(this.centroid);
    const size = box.getSize(new THREE.Vector3());
    this.orbitRadius = Math.max(size.x, size.y, size.z) * 1.2 + 30; // fit the full hologram shell, not just graph nodes
    this.camera.far = this.orbitRadius * 6 + 200;
    this.camera.updateProjectionMatrix();

    for (const n of graph.nodes) {
      const color = COLOR[n.kind] ?? COLOR.room;
      const mat = new THREE.MeshBasicMaterial({ color, wireframe: true });
      const mesh = new THREE.Mesh(nodeGeo, mat);
      const scale = Math.max(1.4, Math.min(4, n.radius * 0.35));
      mesh.scale.setScalar(scale);
      mesh.position.copy(n.pos);
      mesh.visible = false;
      this.scene.add(mesh);
      this.nodeMeshes.set(n.id, { mesh });
    }

    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    for (const e of graph.edges) {
      const na = byId.get(e.a);
      const nb = byId.get(e.b);
      if (!na || !nb) continue;
      const geo = new THREE.BufferGeometry().setFromPoints([na.pos, nb.pos]);
      const color = e.locked ? COLOR.door : COLOR.edge;
      const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 });
      const line = new THREE.LineSegments(geo, mat);
      line.visible = false;
      this.scene.add(line);
      const rec = { a: e.a, b: e.b, line };
      this.edgeLines.push(rec);
      if (e.locked) this.lockedLine = line;
    }

    // POI markers: always visible on the hologram (the scanner sees the whole mine)
    const byIdPoi = new Map(graph.nodes.map((n) => [n.id, n]));
    this._makePoi('key', byIdPoi.get(graph.keyId).pos, nodeGeo, 3.2);
    this._makePoi('reactor', byIdPoi.get(graph.reactorId).pos, nodeGeo, 4.5);
    this._makePoi('exit', byIdPoi.get(graph.exitId).pos, shipGeo, 2.6);
    const da = byIdPoi.get(graph.lockedEdge.a).pos;
    const db = byIdPoi.get(graph.lockedEdge.b).pos;
    const doorMesh = this._makePoi('door', da.clone().lerp(db, 0.5), poiRingGeo, 1);
    doorMesh.lookAt(db); // ring plane faces along the locked tunnel

    this.visit(graph.spawnId);
  }

  setKeyTaken() {
    if (this.poi.key) this.poi.key.visible = false;
  }

  rebuild(graph) {
    this._build(graph);
  }

  toggle() {
    this.visible = !this.visible;
  }

  visit(nodeId) {
    if (this.visited.has(nodeId)) return;
    this.visited.add(nodeId);
    const rec = this.nodeMeshes.get(nodeId);
    if (rec) rec.mesh.visible = true;
    for (const e of this.edgeLines) {
      if (e.a === nodeId || e.b === nodeId) {
        e.line.visible = this.visited.has(e.a) || this.visited.has(e.b);
      }
    }
  }

  setDoorOpen(open) {
    if (this.lockedLine) this.lockedLine.material.color.set(open ? COLOR.doorOpen : COLOR.door);
    if (this.poi.door) this.poi.door.material.color.set(open ? COLOR.doorOpen : COLOR.door);
  }

  // enemies: live list from EnemyManager.list(); markers pooled and repositioned
  _updateEnemyMarkers(enemies, time) {
    let i = 0;
    if (enemies) {
      for (const e of enemies) {
        if (!e.alive) continue;
        if (i >= this.enemyMarkers.length) {
          const m = new THREE.Mesh(enemyGeo, new THREE.MeshBasicMaterial({
            color: COLOR.enemy, transparent: true, opacity: 0.95,
            blending: THREE.AdditiveBlending, depthWrite: false,
          }));
          this.scene.add(m);
          this.enemyMarkers.push(m);
        }
        const m = this.enemyMarkers[i++];
        m.position.copy(e.pos);
        m.visible = true;
        if (e.isReactor) {
          m.material.color.set(COLOR.reactor);
          m.scale.setScalar(2.2 + Math.sin(time * 6) * 0.3);
        } else {
          m.material.color.set(COLOR.enemy);
          m.scale.setScalar(1);
        }
      }
    }
    for (; i < this.enemyMarkers.length; i++) this.enemyMarkers[i].visible = false;
  }

  render(renderer, shipPos, shipQuat, enemies) {
    if (!this.visible) return;

    this.shipMesh.position.copy(shipPos);
    this.shipMesh.quaternion.copy(shipQuat);

    const time = performance.now() * 0.001;
    this._updateEnemyMarkers(enemies, time);
    if (this.poi.key) this.poi.key.rotation.y = time * 1.5;
    if (this.poi.reactor) this.poi.reactor.rotation.y = time;

    renderer.getSize(_size);
    const aspect = _size.x / Math.max(1, _size.y);
    if (this.camera.aspect !== aspect) {
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
    }

    const now = performance.now();
    const t = now * 0.00015; // slow smooth auto-rotate (kept), but FOCUSED ON THE PLAYER
    const focusRadius = Math.min(this.orbitRadius, 85); // close enough that you always spot yourself
    this.camera.position.set(
      shipPos.x + Math.cos(t) * focusRadius,
      shipPos.y + focusRadius * 0.45,
      shipPos.z + Math.sin(t) * focusRadius
    );
    this.camera.lookAt(shipPos);

    // pulsing halo ring billboarded to the map camera: the "YOU ARE HERE"
    const pulse = 4.5 + Math.sin(now * 0.006) * 1.4;
    this.shipHalo.position.copy(shipPos);
    this.shipHalo.scale.setScalar(pulse);
    this.shipHalo.quaternion.copy(this.camera.quaternion);

    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = prevAutoClear;
  }
}
