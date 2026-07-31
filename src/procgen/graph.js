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

const NEIGHBOR_K = 3;

// ---------- small internal helpers ----------

class UnionFind {
  constructor(n) {
    this.parent = new Array(n);
    for (let i = 0; i < n; i++) this.parent[i] = i;
  }
  find(x) {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  union(a, b) {
    const ra = this.find(a), rb = this.find(b);
    if (ra === rb) return false;
    this.parent[ra] = rb;
    return true;
  }
}

function edgeKey(a, b) {
  return a < b ? a + '_' + b : b + '_' + a;
}

function scatterRooms(rng, config) {
  const half = config.world.size / 2;
  const nodes = [];
  for (let i = 0; i < config.world.roomCount; i++) {
    let pos = null;
    for (let t = 0; t < 400; t++) {
      const cand = new THREE.Vector3(
        randRange(rng, -half, half),
        randRange(rng, -half, half),
        randRange(rng, -half, half)
      );
      let ok = true;
      for (const n of nodes) {
        if (cand.distanceTo(n.pos) < config.world.roomMinDist) { ok = false; break; }
      }
      pos = cand;
      if (ok) break;
      // else keep the last candidate as a fallback if all 400 tries fail
    }
    nodes.push({ id: i, pos, radius: 0, kind: 'room' });
  }
  return nodes;
}

function buildCandidateEdges(nodes, k) {
  const map = new Map();
  for (const n of nodes) {
    const dists = [];
    for (const m of nodes) {
      if (m.id === n.id) continue;
      dists.push({ id: m.id, d: n.pos.distanceTo(m.pos) });
    }
    dists.sort((a, b) => a.d - b.d);
    for (let i = 0; i < Math.min(k, dists.length); i++) {
      const { id, d } = dists[i];
      const key = edgeKey(n.id, id);
      if (!map.has(key)) {
        map.set(key, { a: Math.min(n.id, id), b: Math.max(n.id, id), w: d });
      }
    }
  }
  return Array.from(map.values());
}

// Kruskal MST over the candidate edge set, with a brute-force fallback pass that
// connects any leftover components (guards against a disconnected k-NN graph).
function buildSpanningTree(nodes, candidateEdges) {
  const sorted = [...candidateEdges].sort((a, b) => a.w - b.w);
  const uf = new UnionFind(nodes.length);
  const tree = [];
  const used = new Set();
  for (const e of sorted) {
    if (uf.union(e.a, e.b)) { tree.push(e); used.add(edgeKey(e.a, e.b)); }
  }
  let need = nodes.length - 1 - tree.length;
  if (need > 0) {
    const allPairs = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        allPairs.push({ a: nodes[i].id, b: nodes[j].id, w: nodes[i].pos.distanceTo(nodes[j].pos) });
      }
    }
    allPairs.sort((a, b) => a.w - b.w);
    for (const e of allPairs) {
      if (need <= 0) break;
      const key = edgeKey(e.a, e.b);
      if (used.has(key)) continue;
      if (uf.union(e.a, e.b)) { tree.push(e); used.add(key); need--; }
    }
  }
  return { tree, used };
}

function pickLoopEdges(candidateEdges, used, count) {
  const remaining = candidateEdges
    .filter((e) => !used.has(edgeKey(e.a, e.b)))
    .sort((a, b) => a.w - b.w);
  return remaining.slice(0, Math.max(0, count));
}

function buildNeighbors(nodes, edges) {
  const neighbors = new Map();
  for (const n of nodes) neighbors.set(n.id, []);
  for (const e of edges) {
    neighbors.get(e.a).push(e.b);
    neighbors.get(e.b).push(e.a);
  }
  return neighbors;
}

function findSpawnId(nodes, half) {
  const corners = [];
  for (const sx of [-half, half]) {
    for (const sy of [-half, half]) {
      for (const sz of [-half, half]) {
        corners.push(new THREE.Vector3(sx, sy, sz));
      }
    }
  }
  let bestId = nodes[0].id;
  let bestDist = Infinity;
  for (const n of nodes) {
    let d = Infinity;
    for (const c of corners) d = Math.min(d, n.pos.distanceTo(c));
    if (d < bestDist) { bestDist = d; bestId = n.id; }
  }
  return bestId;
}

// Generic BFS over the graph's adjacency. When excludeLocked is true, edges whose
// locked flag is true are not traversed. Returns { dist, parent } maps keyed by node id.
function bfs(neighbors, edges, startId, excludeLocked) {
  const dist = new Map([[startId, 0]]);
  const parent = new Map();
  const queue = [startId];
  let qi = 0;
  while (qi < queue.length) {
    const cur = queue[qi++];
    for (const nxt of neighbors.get(cur) || []) {
      if (dist.has(nxt)) continue;
      if (excludeLocked && isEdgeLocked(edges, cur, nxt)) continue;
      dist.set(nxt, dist.get(cur) + 1);
      parent.set(nxt, cur);
      queue.push(nxt);
    }
  }
  return { dist, parent };
}

function isEdgeLocked(edges, a, b) {
  for (const e of edges) {
    if ((e.a === a && e.b === b) || (e.a === b && e.b === a)) return e.locked;
  }
  return false;
}

function reconstructPath(parent, startId, endId) {
  if (startId === endId) return [startId];
  const path = [endId];
  let cur = endId;
  while (cur !== startId) {
    cur = parent.get(cur);
    if (cur === undefined) return null;
    path.push(cur);
  }
  path.reverse();
  return path;
}

// Among candidates, prefer max BFS distance, then min degree (leaf-ish), then rng tie-break.
function selectPreferred(candidates, distMap, neighbors, rng) {
  let maxDist = -1;
  for (const c of candidates) maxDist = Math.max(maxDist, distMap.get(c.id) ?? 0);
  const tier1 = candidates.filter((c) => (distMap.get(c.id) ?? 0) === maxDist);
  let minDeg = Infinity;
  for (const c of tier1) minDeg = Math.min(minDeg, (neighbors.get(c.id) || []).length);
  const tier2 = tier1.filter((c) => (neighbors.get(c.id) || []).length === minDeg);
  return pick(rng, tier2);
}

// ---------- public API ----------

export function generateLevelGraph(seed, config) {
  const rng = makeRng(seed);
  const half = config.world.size / 2;

  // 1. layout
  const nodes = scatterRooms(rng, config);

  // 2. edges: k-NN candidates -> MST (+ connectivity guard) -> loop edges
  const candidateEdges = buildCandidateEdges(nodes, NEIGHBOR_K);
  const { tree, used } = buildSpanningTree(nodes, candidateEdges);
  const loopEdges = pickLoopEdges(candidateEdges, used, config.world.extraLoopEdges);
  const edges = [...tree, ...loopEdges].map((e) => ({ a: e.a, b: e.b, locked: false }));
  const neighbors = buildNeighbors(nodes, edges);

  // 3. mission
  const spawnId = findSpawnId(nodes, half);

  const { dist: distFromSpawnAll, parent: parentFromSpawnAll } = bfs(neighbors, edges, spawnId, false);
  let reactorId = spawnId;
  let maxDist = -1;
  for (const n of nodes) {
    const d = distFromSpawnAll.get(n.id) ?? -1;
    if (d > maxDist) { maxDist = d; reactorId = n.id; }
  }

  const path = reconstructPath(parentFromSpawnAll, spawnId, reactorId) || [spawnId];
  if (path.length >= 2) {
    const doorA = path[path.length - 2];
    const doorB = path[path.length - 1];
    const doorEdge = edges.find((e) => (e.a === doorA && e.b === doorB) || (e.a === doorB && e.b === doorA));
    if (doorEdge) doorEdge.locked = true;
  }
  let lockedEdgeObj = edges.find((e) => e.locked);
  if (!lockedEdgeObj && edges.length > 0) {
    // defensive: reactor unreachable somehow (shouldn't happen); lock the first edge.
    edges[0].locked = true;
    lockedEdgeObj = edges[0];
  }

  // key: reachable from spawn without crossing the locked edge, >=2 hops, not reactor
  const { dist: distFromSpawnUnlocked } = bfs(neighbors, edges, spawnId, true);
  let keyCandidates = nodes.filter((n) =>
    n.id !== spawnId && n.id !== reactorId &&
    distFromSpawnUnlocked.has(n.id) && distFromSpawnUnlocked.get(n.id) >= 2
  );
  if (keyCandidates.length === 0) {
    keyCandidates = nodes.filter((n) => n.id !== spawnId && n.id !== reactorId && distFromSpawnUnlocked.has(n.id));
  }
  if (keyCandidates.length === 0) {
    keyCandidates = nodes.filter((n) => n.id !== spawnId && n.id !== reactorId);
  }
  let keyId = selectPreferred(keyCandidates, distFromSpawnUnlocked, neighbors, rng).id;

  // exit: neighbor-of-neighbor of reactor on the spawn side of the door if possible,
  // else any node within 3 hops of reactor that is not spawn.
  const { dist: distFromReactor } = bfs(neighbors, edges, reactorId, false);
  const spawnSideIds = distFromSpawnUnlocked; // reachable-without-locked-edge set
  let exitCandidates = nodes.filter((n) =>
    distFromReactor.get(n.id) === 2 &&
    spawnSideIds.has(n.id) &&
    n.id !== spawnId && n.id !== reactorId && n.id !== keyId
  );
  if (exitCandidates.length === 0) {
    exitCandidates = nodes.filter((n) =>
      (distFromReactor.get(n.id) ?? Infinity) <= 3 &&
      n.id !== spawnId && n.id !== reactorId && n.id !== keyId
    );
  }
  if (exitCandidates.length === 0) {
    exitCandidates = nodes.filter((n) => n.id !== spawnId && n.id !== reactorId && n.id !== keyId);
  }
  let exitId = pick(rng, exitCandidates).id;

  // assign kinds
  for (const n of nodes) n.kind = 'room';
  nodes.find((n) => n.id === spawnId).kind = 'spawn';
  nodes.find((n) => n.id === reactorId).kind = 'reactor';
  nodes.find((n) => n.id === keyId).kind = 'key';
  nodes.find((n) => n.id === exitId).kind = 'exit';

  // 4. radii
  for (const n of nodes) {
    if (n.kind === 'spawn' || n.kind === 'reactor') n.radius = config.world.roomRadius[1];
    else n.radius = randRange(rng, config.world.roomRadius[0], config.world.roomRadius[1]);
  }

  // safety verification: the key MUST be reachable from spawn without crossing the
  // locked edge. Re-run BFS post-assignment (locked flags are now final) and reassign
  // if this ever fails.
  const { dist: verifyDist } = bfs(neighbors, edges, spawnId, true);
  if (!verifyDist.has(keyId)) {
    let fallback = nodes.filter((n) =>
      n.id !== spawnId && n.id !== reactorId && n.id !== exitId && verifyDist.has(n.id) && verifyDist.get(n.id) >= 2
    );
    if (fallback.length === 0) {
      fallback = nodes.filter((n) => n.id !== spawnId && n.id !== reactorId && n.id !== exitId && verifyDist.has(n.id));
    }
    if (fallback.length > 0) {
      const oldKeyNode = nodes.find((n) => n.id === keyId);
      oldKeyNode.kind = 'room';
      const newKeyNode = selectPreferred(fallback, verifyDist, neighbors, rng);
      newKeyNode.kind = 'key';
      newKeyNode.radius = randRange(rng, config.world.roomRadius[0], config.world.roomRadius[1]);
      keyId = newKeyNode.id;
    }
  }

  return {
    nodes,
    edges,
    spawnId,
    keyId,
    reactorId,
    exitId,
    neighbors,
    lockedEdge: { a: lockedEdgeObj.a, b: lockedEdgeObj.b },
  };
}

export function findPath(graph, fromId, toId, allowLocked = false) {
  const { dist, parent } = bfs(graph.neighbors, graph.edges, fromId, !allowLocked);
  if (!dist.has(toId)) return null;
  return reconstructPath(parent, fromId, toId);
}

export function nearestNodeId(graph, pos) {
  let bestId = graph.nodes[0].id;
  let bestDist = Infinity;
  for (const n of graph.nodes) {
    const d = pos.distanceToSquared(n.pos);
    if (d < bestDist) { bestDist = d; bestId = n.id; }
  }
  return bestId;
}
