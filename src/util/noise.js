// noise.js : seeded 3d simplex noise. CONTRACT (implement exactly):
//
// makeNoise3D(seed:number) -> (x,y,z) => number in [-1,1]
//   Deterministic for a given seed. Standard simplex 3d (Gustavson-style), perm table
//   shuffled with makeRng(seed) from ./rng.js.
//
// fbm3(noise, x, y, z, octaves=3, lacunarity=2.0, gain=0.5) -> number roughly in [-1,1]
//   Standard fractal sum, normalized by total amplitude.
//
// Pure functions, no THREE dependency, hot path: must allocate nothing per call.
import { makeRng } from './rng.js';

export function makeNoise3D(seed) {
  throw new Error('NOT IMPLEMENTED: makeNoise3D');
}

export function fbm3(noise, x, y, z, octaves = 3, lacunarity = 2.0, gain = 0.5) {
  throw new Error('NOT IMPLEMENTED: fbm3');
}
