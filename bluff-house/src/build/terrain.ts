import * as THREE from 'three';
import type { BuildContext } from './context';

/* Deterministic value noise (ported from the prototype so the lot matches the approved plans). */
function hash2(i: number, j: number, s: number) {
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(s + 1, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function pnoise(x: number, y: number, px: number, py: number, s: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const x0 = ((xi % px) + px) % px, x1 = (x0 + 1) % px, y0 = ((yi % py) + py) % py, y1 = (y0 + 1) % py;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(x0, y0, s), b = hash2(x1, y0, s), c = hash2(x0, y1, s), d = hash2(x1, y1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const BIG = 1 << 20;
export const noise2 = (x: number, y: number, s = 0) => pnoise(x + 5000, y + 5000, BIG, BIG, s);
export function fbm2(x: number, y: number, oct = 4, s = 0) {
  let t = 0, a = 0.5, n = 0;
  for (let o = 0; o < oct; o++) { t += a * noise2(x, y, s + o * 31); n += a; x *= 2.03; y *= 2.03; a *= 0.5; }
  return t / n;
}
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const sstep = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** Bluff crest line (x) and the lot's grading. */
export const BLUFF_X = -34;
export const LAKE_Y = -50;
const shoreOff = (z: number) => (noise2(z * 0.012, 3.3, 61) - 0.5) * 26 * sstep(25, 75, Math.abs(z - 84));
export function bluffY(x: number, z: number) {
  const d = BLUFF_X - x + shoreOff(z) * 0.4;
  const k = 1 + shoreOff(z) * -0.012;
  const y = -1.22 * k * d - noise2(x * 0.09, z * 0.09, 4) * 3 * Math.min(1, Math.max(0, d) / 6);
  return Math.max(-56, Math.min(0, y));
}
/** Grade at the lower-level floor on the west (0) rising to the main level on the east (11). */
export function baseGround(x: number, z: number) {
  let y = x <= 4 ? 0 : x < 50 ? 11 * sstep(4, 50, x) : 11;
  const dx = Math.max(0, -40 - x, x - 230), dz = Math.max(0, -30 - z, z - 120);
  const far = clamp(Math.hypot(dx, dz) / 80, 0, 1);
  y += far * (fbm2(x * 0.01, z * 0.01, 4, 2) - 0.45) * 14;
  return y;
}

export interface TerrainFn { height(x: number, z: number): number }

/** Builds the ground heightfield around the house. Inside the house footprint the grade drops under the slabs. */
export function buildTerrain(ctx: BuildContext, cuts: { rect: [number, number, number, number]; y: number }[]): TerrainFn {
  const { plan } = ctx;
  const under = (L: number, x: number, z: number) => {
    for (const dx of [-0.6, 0, 0.6]) for (const dz of [-0.6, 0, 0.6]) if (plan.ownerAt(L, Math.floor(x + dx), Math.floor(z + dz)) >= 0) return true;
    return false;
  };
  const height = (x: number, z: number) => {
    if (x < BLUFF_X) return bluffY(x, z);
    if (under(0, x, z)) return -1;
    let y = baseGround(x, z);
    for (const c of cuts) {
      const [x0, z0, x1, z1] = c.rect;
      if (x > x0 - 0.6 && x < x1 + 0.6 && z > z0 - 0.6 && z < z1 + 0.6) y = Math.min(y, c.y);
    }
    if (under(1, x, z)) return Math.min(y, 10);
    return y;
  };
  const X0 = -140, X1 = 270, Z0 = -150, Z1 = 280, STEP = 2;
  const NX = (X1 - X0) / STEP, NZ = (Z1 - Z0) / STEP;
  const geo = new THREE.PlaneGeometry(X1 - X0, Z1 - Z0, NX, NZ);
  geo.rotateX(-Math.PI / 2); geo.translate((X0 + X1) / 2, 0, (Z0 + Z1) / 2);
  const p = geo.attributes.position as THREE.BufferAttribute;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    p.setY(i, height(x, z)); uv[i * 2] = x; uv[i * 2 + 1] = -z;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  ctx.terrainGeometry = geo;
  return { height };
}
