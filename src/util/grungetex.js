// grungetex.js : one shared procedural grunge texture, chunky nearest-neighbor
// pixel-art style. Grayscale mottling + speckles + scratches; multiplied under
// vertex colors and lighting on both the cave and the robots.
import * as THREE from 'three';
import { makeRng } from './rng.js';

let _shared = null;

export function grungeTexture() {
  if (_shared) return _shared;
  const size = 64;
  const rng = makeRng(0x6772);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  // base mottle: blocky 4px value noise so the pixels read as chunky texels
  for (let y = 0; y < size; y += 2) {
    for (let x = 0; x < size; x += 2) {
      const v = Math.floor(210 + rng() * 45);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(x, y, 2, 2);
    }
  }
  // dark speckle pits
  for (let i = 0; i < 90; i++) {
    const v = Math.floor(120 + rng() * 60);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(Math.floor(rng() * size), Math.floor(rng() * size), rng() < 0.3 ? 2 : 1, 1);
  }
  // scratch lines
  for (let i = 0; i < 7; i++) {
    const v = Math.floor(150 + rng() * 50);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    let x = Math.floor(rng() * size), y = Math.floor(rng() * size);
    const horiz = rng() < 0.5;
    const len = 6 + Math.floor(rng() * 14);
    for (let j = 0; j < len; j++) {
      ctx.fillRect(x % size, y % size, 1, 1);
      if (horiz) { x++; y += rng() < 0.2 ? 1 : 0; } else { y++; x += rng() < 0.2 ? 1 : 0; }
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;      // the whole point: crunchy texels
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  _shared = tex;
  return tex;
}
