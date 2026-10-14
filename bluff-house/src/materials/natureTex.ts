import { clamp, hash2, pfbm, pnoise, rng } from '../util/noise';
import { build, lerp3, type TexSet } from './texcore';

/**
 * Procedural textures for the landscape: the forest canopy seen from afar, bark, rock, leaf cards
 * for the fall trees (alpha-tested), the mid-distance tree impostor, and the lake's ripple normals.
 */

/** Forest canopy from a distance: a field of rounded crowns (tinted by the terrain's vertex colors). */
function canopy() {
  const W = 512, H = 512, N = 26;
  const r = rng(301), px = new Float32Array(N * N), py = new Float32Array(N * N), rad = new Float32Array(N * N), tone = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) { px[i] = r(); py[i] = r(); rad[i] = 0.5 + r() * 0.5; tone[i] = r(); }
  return build(W, H, 180, 180, 1.6, (x, y, o) => {
    const u = (x / W) * N, v = (y / H) * N, ci = Math.floor(u), cj = Math.floor(v);
    let best = 0, bt = 0.5;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const i = (((ci + di) % N) + N) % N, j = (((cj + dj) % N) + N) % N, k = j * N + i;
      const dx = ci + di + px[k] - u, dy = cj + dj + py[k] - v, d = Math.sqrt(dx * dx + dy * dy) / (0.75 * rad[k]);
      const h = Math.max(0, 1 - d * d);
      if (h > best) { best = h; bt = tone[k]; }
    }
    const leaf = pnoise((x / W) * 160, (y / H) * 160, 160, 160, 7);
    // soft crowns: lit tops, darker gaps; per-crown tone shifts the hue a little (warmer / cooler)
    const k = (0.62 + best * 0.45) * (0.9 + leaf * 0.15);
    o.r = 200 * k * (0.92 + bt * 0.16); o.g = 200 * k; o.b = 200 * k * (1.06 - bt * 0.16);
    o.h = best * 0.9 + leaf * 0.1; o.rough = 0.95; o.ao = 0.45 + best * 0.55;
  });
}

function bark() {
  const W = 128, H = 256;
  return build(W, H, 2, 4, 2.4, (x, y, o) => {
    const u = x / W, v = y / H;
    const ridge = Math.abs(Math.sin((u * 7 + pfbm(u * 4, v * 2, 4, 2, 4, 5) * 1.6) * Math.PI));
    const n = pfbm(u * 8, v * 16, 8, 16, 4, 6);
    const val = 70 + ridge * 40 + (n - 0.5) * 40;
    o.r = val; o.g = val * 0.9; o.b = val * 0.78; o.h = ridge * 0.7 + n * 0.3; o.rough = 0.95; o.ao = 0.6 + ridge * 0.4;
  });
}

function rock() {
  const W = 256, H = 256;
  return build(W, H, 6, 6, 2.0, (x, y, o) => {
    const u = x / W, v = y / H;
    const n = pfbm(u * 5, v * 5, 5, 5, 6, 81), c = pfbm(u * 18, v * 18, 18, 18, 3, 82);
    const crack = clamp(1 - Math.abs(pfbm(u * 3, v * 3, 3, 3, 4, 83) - 0.5) * 30, 0, 1);
    const lich = clamp((pfbm(u * 9, v * 9, 9, 9, 3, 84) - 0.62) * 5, 0, 1);
    lerp3([96, 92, 86], [150, 146, 138], n, o);
    if (lich > 0) { o.r = o.r * (1 - lich) + 150 * lich; o.g = o.g * (1 - lich) + 150 * lich; o.b = o.b * (1 - lich) + 104 * lich; }
    o.r *= 1 - crack * 0.5; o.g *= 1 - crack * 0.5; o.b *= 1 - crack * 0.5;
    o.h = n * 0.7 + c * 0.3 - crack * 0.3; o.rough = 0.88;
  });
}

/**
 * A card of broadleaf foliage in fall color: a cluster of small ovate leaves, transparent around
 * them. `pal` is a list of leaf colors picked per leaf.
 */
function leafCluster(seed: number, pal: number[][], count = 70, size = 0.06) {
  const W = 256, H = 256, r = rng(seed);
  const leaves = Array.from({ length: count }, () => {
    const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * 0.42;
    return { x: 0.5 + Math.cos(a) * rr, y: 0.5 + Math.sin(a) * rr, a: r() * Math.PI * 2, l: size * (0.8 + r() * 0.5), c: pal[Math.floor(r() * pal.length)], t: r() };
  });
  return build(W, H, 1, 1, 0.8, (x, y, o) => {
    const u = x / W, v = y / H;
    o.a = 0; o.r = pal[0][0]; o.g = pal[0][1]; o.b = pal[0][2];
    for (const L of leaves) {
      const dx = u - L.x, dy = v - L.y;
      if (Math.abs(dx) > L.l || Math.abs(dy) > L.l) continue;
      const c = Math.cos(L.a), s = Math.sin(L.a), lx = dx * c + dy * s, ly = -dx * s + dy * c;
      const e = (lx / L.l) ** 2 + (ly / (L.l * 0.55)) ** 2;
      if (e < 1) { const k = 0.75 + L.t * 0.4 + (1 - e) * 0.2; o.r = L.c[0] * k; o.g = L.c[1] * k; o.b = L.c[2] * k; o.a = 255; o.h = 1 - e; o.rough = 0.6; }
    }
  });
}

/** Pine needles: dense radiating strokes on a transparent card. */
function needles() {
  const W = 256, H = 256, r = rng(55);
  const strokes = Array.from({ length: 260 }, () => { const a = r() * Math.PI * 2, d = r() * 0.4; return { x: 0.5 + Math.cos(a) * d * 0.5, y: 0.5 + Math.sin(a) * d * 0.5, a, l: 0.08 + r() * 0.1, t: r() }; });
  return build(W, H, 1, 1, 0.6, (x, y, o) => {
    const u = x / W, v = y / H;
    o.a = 0; o.r = 30; o.g = 52; o.b = 30;
    for (const S of strokes) {
      const dx = u - S.x, dy = v - S.y, c = Math.cos(S.a), s = Math.sin(S.a), lx = dx * c + dy * s, ly = -dx * s + dy * c;
      if (lx > 0 && lx < S.l && Math.abs(ly) < 0.004) { const k = 0.7 + S.t * 0.5; o.r = 34 * k; o.g = 62 * k; o.b = 36 * k; o.a = 255; o.h = 0.8; o.rough = 0.7; }
    }
  });
}

/**
 * Mid-distance impostor: a whole fall tree as a soft silhouette (crown + trunk) for camera-facing
 * billboards beyond ~300 ft. White crown (tinted per instance), dark trunk.
 */
function treeImpostor() {
  const W = 128, H = 256;
  return build(W, H, 1, 1, 0.8, (x, y, o) => {
    const u = x / W, v = y / H; // v = 0 at the bottom
    o.a = 0; o.r = 255; o.g = 255; o.b = 255;
    const trunk = Math.abs(u - 0.5) < 0.035 && v < 0.35;
    const cy = 0.58, rx = 0.42 * (1 - Math.max(0, v - cy) * 0.9), ry = 0.4;
    const n = pfbm(u * 8, v * 8, 8, 8, 4, 91);
    const e = ((u - 0.5) / rx) ** 2 + ((v - cy) / ry) ** 2 + (n - 0.5) * 0.9;
    if (e < 1) { const k = 0.6 + (1 - e) * 0.3 + (v - 0.3) * 0.25 + (hash2(x, y, 3) - 0.5) * 0.15; o.r = 255 * k; o.g = 255 * k; o.b = 255 * k; o.a = 255; o.h = 1 - e; }
    else if (trunk) { o.r = 40; o.g = 32; o.b = 26; o.a = 255; }
    o.rough = 0.95;
  });
}

/** Wind ripples on the lake (normal map only matters): two scales of soft waves. */
function waterRipples() {
  const W = 256, H = 256;
  return build(W, H, 1, 1, 3.0, (x, y, o) => {
    const u = x / W, v = y / H;
    o.h = pfbm(u * 6, v * 6, 6, 6, 5, 121) * 0.7 + pfbm(u * 24, v * 18, 24, 18, 3, 122) * 0.3;
    o.r = o.g = o.b = 128;
  });
}

const FALL_ORANGE = [[214, 110, 32], [190, 82, 26], [230, 140, 50], [168, 70, 30]];
const FALL_RED = [[170, 40, 28], [196, 58, 34], [140, 30, 30], [210, 90, 40]];
const FALL_GOLD = [[220, 170, 40], [200, 150, 30], [236, 196, 70], [180, 140, 40]];

export const NATURE_GENERATORS: Record<string, () => TexSet> = {
  canopy,
  bark,
  rock,
  leafOrange: () => leafCluster(201, FALL_ORANGE),
  leafRed: () => leafCluster(202, FALL_RED),
  leafGold: () => leafCluster(203, FALL_GOLD),
  needles,
  treeImpostor,
  waterRipples,
};
