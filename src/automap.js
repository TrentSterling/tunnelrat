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
//   rebuild(graph)             // new level
//   render(renderer, shipPos, shipQuat)  // call AFTER main scene render when visible:
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
};

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

    this.shipMesh = new THREE.Mesh(shipGeo, new THREE.MeshBasicMaterial({ color: COLOR.ship }));
    this.scene.add(this.shipMesh);

    this.nodeMeshes = new Map();
    this.edgeLines = [];
    this.lockedLine = null;
    this.visited = new Set();
    this.centroid = new THREE.Vector3();
    this.orbitRadius = 100;

    this._build(graph);
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

    const box = new THREE.Box3();
    for (const n of graph.nodes) box.expandByPoint(n.pos);
    box.getCenter(this.centroid);
    const size = box.getSize(new THREE.Vector3());
    this.orbitRadius = Math.max(size.x, size.y, size.z) * 0.85 + 26;
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

    this.visit(graph.spawnId);
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
    if (!this.lockedLine) return;
    this.lockedLine.material.color.set(open ? COLOR.doorOpen : COLOR.door);
  }

  render(renderer, shipPos, shipQuat) {
    if (!this.visible) return;

    this.shipMesh.position.copy(shipPos);
    this.shipMesh.quaternion.copy(shipQuat);

    renderer.getSize(_size);
    const aspect = _size.x / Math.max(1, _size.y);
    if (this.camera.aspect !== aspect) {
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
    }

    const t = performance.now() * 0.00015; // slow deterministic auto-rotate, not rng
    this.camera.position.set(
      this.centroid.x + Math.cos(t) * this.orbitRadius,
      this.centroid.y + this.orbitRadius * 0.4,
      this.centroid.z + Math.sin(t) * this.orbitRadius
    );
    this.camera.lookAt(this.centroid);

    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = prevAutoClear;
  }
}
