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

const F3 = 1 / 3;
const G3 = 1 / 6;

// 12 gradient directions (edge midpoints of a cube), standard Gustavson simplex set.
const GRAD3 = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];

function dot3(g, x, y, z) {
  return g[0] * x + g[1] * y + g[2] * z;
}

export function makeNoise3D(seed) {
  const rng = makeRng(seed);

  // Build a permutation of 0..255, shuffled deterministically via rng (Fisher-Yates).
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }

  // Duplicate to avoid wrapping/masking in the lookup, and precompute mod-12.
  const perm = new Uint8Array(512);
  const permMod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
    permMod12[i] = perm[i] % 12;
  }

  return function noise3D(x, y, z) {
    // Skew the input space to determine which simplex cell we're in.
    const s = (x + y + z) * F3;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const k = Math.floor(z + s);

    const t = (i + j + k) * G3;
    const X0 = i - t, Y0 = j - t, Z0 = k - t;
    const x0 = x - X0, y0 = y - Y0, z0 = z - Z0;

    // Determine which simplex (tetrahedron) we are in.
    let i1, j1, k1;
    let i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }

    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;

    const ii = i & 255, jj = j & 255, kk = k & 255;

    let n0 = 0, n1 = 0, n2 = 0, n3 = 0;

    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 > 0) {
      const gi0 = permMod12[ii + perm[jj + perm[kk]]];
      t0 *= t0;
      n0 = t0 * t0 * dot3(GRAD3[gi0], x0, y0, z0);
    }

    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 > 0) {
      const gi1 = permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]];
      t1 *= t1;
      n1 = t1 * t1 * dot3(GRAD3[gi1], x1, y1, z1);
    }

    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 > 0) {
      const gi2 = permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]];
      t2 *= t2;
      n2 = t2 * t2 * dot3(GRAD3[gi2], x2, y2, z2);
    }

    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 > 0) {
      const gi3 = permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]];
      t3 *= t3;
      n3 = t3 * t3 * dot3(GRAD3[gi3], x3, y3, z3);
    }

    // Sum contributions, scaled to fit roughly into [-1,1].
    return 32 * (n0 + n1 + n2 + n3);
  };
}

export function fbm3(noise, x, y, z, octaves = 3, lacunarity = 2.0, gain = 0.5) {
  let sum = 0;
  let amp = 1;
  let ampTotal = 0;
  let freq = 1;
  for (let o = 0; o < octaves; o++) {
    sum += noise(x * freq, y * freq, z * freq) * amp;
    ampTotal += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return ampTotal > 0 ? sum / ampTotal : 0;
}
