import * as THREE from 'three';
import { clamp, mix, rng } from '../util/noise';

/** Shared core of the procedural texture generators: per-pixel generator → albedo + normal + roughness/AO maps. */
export interface TexSet { map: THREE.Texture; normalMap: THREE.Texture; ormMap: THREE.Texture; tileU: number; tileV: number }

/** Per-pixel output of a generator: color 0..255, height 0..1, roughness 0..1, ao 0..1. */
export interface Px { r: number; g: number; b: number; h: number; rough: number; ao: number; /** alpha 0..255 (leaf cards) */ a: number }
export type Gen = (x: number, y: number, o: Px) => void;

export function tex(data: Uint8Array, W: number, H: number, srgb: boolean) {
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** Runs a generator over a W×H tile and builds the three maps. `bump` scales height → normal strength. */
export function build(W: number, H: number, tileU: number, tileV: number, bump: number, gen: Gen): TexSet {
  const col = new Uint8Array(W * H * 4), orm = new Uint8Array(W * H * 4), nrm = new Uint8Array(W * H * 4);
  const hgt = new Float32Array(W * H);
  const o: Px = { r: 0, g: 0, b: 0, h: 0.5, rough: 0.8, ao: 1, a: 255 };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    o.h = 0.5; o.rough = 0.8; o.ao = 1; o.a = 255;
    gen(x, y, o);
    const i = (y * W + x) * 4;
    col[i] = clamp(o.r, 0, 255); col[i + 1] = clamp(o.g, 0, 255); col[i + 2] = clamp(o.b, 0, 255); col[i + 3] = clamp(o.a, 0, 255);
    orm[i] = clamp(o.ao * 255, 0, 255); orm[i + 1] = clamp(o.rough * 255, 0, 255); orm[i + 2] = 0; orm[i + 3] = 255;
    hgt[y * W + x] = o.h;
  }
  // height → tangent-space normal (wrapping, central differences); slope is per texel in "texel units"
  const k = bump * (W / 256);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const l = hgt[y * W + ((x - 1 + W) % W)], r = hgt[y * W + ((x + 1) % W)];
    const u = hgt[((y - 1 + H) % H) * W + x], d = hgt[((y + 1) % H) * W + x];
    let nx = (l - r) * k, ny = (d - u) * k, nz = 1;
    const L = Math.hypot(nx, ny, nz); nx /= L; ny /= L; nz /= L;
    const i = (y * W + x) * 4;
    nrm[i] = (nx * 0.5 + 0.5) * 255; nrm[i + 1] = (ny * 0.5 + 0.5) * 255; nrm[i + 2] = (nz * 0.5 + 0.5) * 255; nrm[i + 3] = 255;
  }
  return { map: tex(col, W, H, true), normalMap: tex(nrm, W, H, false), ormMap: tex(orm, W, H, false), tileU, tileV };
}

/** Rows of boards: for each row, which board each column belongs to, plus a tone per board. */
export function boardRows(W: number, rowsPx: number[], minLen: number, maxLen: number, seed: number) {
  const r = rng(seed);
  return rowsPx.map(() => {
    const id = new Int16Array(W), tone: number[] = [], start = Math.floor(r() * W);
    let acc = 0, n = 0;
    while (acc < W) {
      let len = Math.round(minLen + r() * (maxLen - minLen));
      if (W - acc - len < minLen * 0.6) len = W - acc;
      for (let i = 0; i < len; i++) id[(start + acc + i) % W] = n;
      tone.push(r()); acc += len; n++;
    }
    return { id, tone };
  });
}
/** Splits `total` px into rows whose widths are picked from `choices` (px), summing exactly. */
export function rowWidths(total: number, choices: number[], seed: number) {
  const r = rng(seed), out: number[] = [];
  let acc = 0;
  while (acc < total) {
    let w = choices[Math.floor(r() * choices.length)];
    if (total - acc - w < Math.min(...choices)) w = total - acc;
    out.push(w); acc += w;
  }
  return out;
}
export const lerp3 = (a: number[], b: number[], t: number, o: Px) => { o.r = mix(a[0], b[0], t); o.g = mix(a[1], b[1], t); o.b = mix(a[2], b[2], t); };

