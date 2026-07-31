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

export class Automap {
  constructor(graph) {
    throw new Error('NOT IMPLEMENTED: Automap');
  }
}
