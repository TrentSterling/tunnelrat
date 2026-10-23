// CPU construction and submitted geometry budget, not a frame-time benchmark.
// Optional argument points to a baseline src/procgen/levelbuilder.js checkout.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONFIG } from '../src/config.js';
globalThis.document = { createElement: () => ({ getContext: () => ({ fillRect() {} }) }) };
const moduleURL = process.argv[2] ? pathToFileURL(resolve(process.argv[2])).href : new URL('../src/procgen/levelbuilder.js', import.meta.url).href;
const { buildLevel } = await import(moduleURL);
const results = [];
for (const seed of [1337, 1338, 1339]) {
  const start = performance.now(), level = buildLevel(seed, CONFIG, 1), buildMs = performance.now() - start;
  let draws = 0, triangles = 0, geometryBytes = 0; const geometries = new Set();
  level.caveGroup.traverse(o => {
    if (!o.geometry) return;
    draws++; triangles += (o.geometry.index?.count || o.geometry.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1);
    geometries.add(o.geometry);
  });
  for (const g of geometries) {
    for (const a of Object.values(g.attributes)) geometryBytes += a.array.byteLength;
    geometryBytes += g.index?.array.byteLength || 0; g.dispose();
  }
  results.push({ seed, buildMs, draws, triangles, geometryBytes, entries: level.field.architecture?.filter(s => s.kind === 'entry').length || 0 });
}
console.log(JSON.stringify({ moduleURL, scope: 'Cave, decor and props, before GameState objective props. Unculled submitted triangles; no FPS claim.', results }, null, 2));
