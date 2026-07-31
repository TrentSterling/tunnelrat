// graph.js : level layout graph + mission assignment. The graph is the mission DAG,
// the AI pathfinding network, and the automap, all at once.
//
// CONTRACT (implement exactly):
//
// generateLevelGraph(seed:number, config:CONFIG) -> graph object:
// {
//   nodes: [{ id:number, pos:THREE.Vector3, radius:number, kind:string }],
//     kind is one of 'spawn' | 'key' | 'reactor' | 'exit' | 'room'
//   edges: [{ a:number, b:number, locked:boolean }],   // exactly ONE edge has locked=true (the door)
//   spawnId, keyId, reactorId, exitId : number,
//   neighbors: Map<number, number[]>,  // adjacency incl. locked edges
//   lockedEdge: { a, b },              // convenience ref to the door edge
// }
//
// Layout algorithm:
//  1. rng = makeRng(seed). Scatter config.world.roomCount points inside a cube of
//     config.world.size, rejection-sample so pairwise dist >= config.world.roomMinDist.
//     (Give up rejection after ~400 tries per point and accept; never infinite-loop.)
//  2. Edges: connect k=3 nearest neighbors per node, dedupe, then take MST (union-find),
//     then add config.world.extraLoopEdges shortest unused edges back.
//  3. Mission (graph ops only, before geometry):
//     - spawnId = node nearest a cube corner.
//     - reactorId = BFS-farthest node from spawn. Force its radius to max roomRadius.
//     - door: the LAST edge on the BFS path spawn->reactor (the edge touching reactor's
//       room, or one hop earlier if reactor has degree 1 and that edge is a dead-end
//       chain; simple rule: last edge of the path). Set locked=true.
//     - keyId: a node reachable from spawn WITHOUT crossing the locked edge, at least
//       2 hops from spawn, not the reactor, prefer a leaf/branch node (max BFS dist).
//     - exitId: a neighbor-of-neighbor of reactor on the spawn side of the door if
//       possible, else any node within 3 hops of reactor that is not spawn. kind='exit'.
//     - remaining nodes kind='room'.
//  4. Room radii: randRange(rng, ...config.world.roomRadius); spawn + reactor forced
//     to the top of the range.
//
// findPath(graph, fromId, toId, allowLocked=false) -> number[] | null (BFS, node id list incl. both ends)
// nearestNodeId(graph, pos:Vector3) -> number
//
// Deterministic for a given seed. No THREE scene objects here, pure data + Vector3.
import * as THREE from 'three';
import { makeRng, randRange, randInt, pick } from '../util/rng.js';

export function generateLevelGraph(seed, config) {
  throw new Error('NOT IMPLEMENTED: generateLevelGraph');
}

export function findPath(graph, fromId, toId, allowLocked = false) {
  throw new Error('NOT IMPLEMENTED: findPath');
}

export function nearestNodeId(graph, pos) {
  throw new Error('NOT IMPLEMENTED: nearestNodeId');
}
