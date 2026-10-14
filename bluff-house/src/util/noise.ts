/** Deterministic hashing, value noise and fBm, shared by terrain and procedural textures. */

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(i: number, j: number, s: number) {
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(s + 1, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Periodic value noise: tiles every (px, py) cells, so textures wrap seamlessly. */
export function pnoise(x: number, y: number, px: number, py: number, s: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const x0 = ((xi % px) + px) % px, x1 = (x0 + 1) % px, y0 = ((yi % py) + py) % py, y1 = (y0 + 1) % py;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(x0, y0, s), b = hash2(x1, y0, s), c = hash2(x0, y1, s), d = hash2(x1, y1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Periodic fBm in [0, 1]. */
export function pfbm(x: number, y: number, px: number, py: number, oct: number, s: number) {
  let t = 0, a = 0.5, n = 0;
  for (let o = 0; o < oct; o++) { t += a * pnoise(x, y, px, py, s + o * 17); n += a; x *= 2; y *= 2; px *= 2; py *= 2; a *= 0.5; }
  return t / n;
}

const BIG = 1 << 20;
export const noise2 = (x: number, y: number, s = 0) => pnoise(x + 5000, y + 5000, BIG, BIG, s);
export function fbm2(x: number, y: number, oct = 4, s = 0) {
  let t = 0, a = 0.5, n = 0;
  for (let o = 0; o < oct; o++) { t += a * noise2(x, y, s + o * 31); n += a; x *= 2.03; y *= 2.03; a *= 0.5; }
  return t / n;
}

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const sstep = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** √(x² + y²) without Math.hypot, which V8 implements by allocating an array for its arguments. */
export const len2 = (x: number, y: number) => Math.sqrt(x * x + y * y);
