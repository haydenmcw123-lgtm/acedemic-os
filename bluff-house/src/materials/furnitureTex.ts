import { clamp, hash2, pfbm, pnoise, rng } from '../util/noise';
import { build, lerp3, type TexSet } from './texcore';

/**
 * Procedural textures for furniture and staging: upholstery (linen weave, bouclé, leather), stone
 * counters, rugs, art and screens. Tiled sets have real-world sizes in feet; "fit" sets (rugs, art,
 * screens) cover their surface once (tile 1 × 1 on 0..1 UVs).
 */

/** Plain-weave linen: warp and weft threads ~1/24 in, slubs, a tiny bit of color variation. Tints with the material color. */
function linenWeave() {
  const W = 256, H = 256;
  return build(W, H, 1, 1, 1.4, (x, y, o) => {
    const t = 4; // px per thread
    const wx = Math.floor(x / t), wy = Math.floor(y / t);
    const over = (wx + wy) & 1;
    const fx = (x % t) / t, fy = (y % t) / t;
    const thread = over ? Math.sin(fy * Math.PI) : Math.sin(fx * Math.PI);
    const slub = pnoise(x / W * 8, y / H * 64, 8, 64, 3 + over);
    const v = 222 + (thread - 0.5) * 26 + (slub - 0.5) * 22;
    o.r = v; o.g = v * 0.985; o.b = v * 0.96;
    o.h = thread * 0.7 + slub * 0.3; o.rough = 0.92; o.ao = 0.85 + thread * 0.15;
  });
}

/** Bouclé: dense little yarn loops, very matte and soft. */
function boucle() {
  const W = 256, H = 256, N = 22;
  const r = rng(91), px = new Float32Array(N * N), py = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) { px[i] = r(); py[i] = r(); }
  return build(W, H, 0.75, 0.75, 2.4, (x, y, o) => {
    const u = (x / W) * N, v = (y / H) * N, ci = Math.floor(u), cj = Math.floor(v);
    let d1 = 9;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const i = (((ci + di) % N) + N) % N, j = (((cj + dj) % N) + N) % N, k = j * N + i;
      const dx = ci + di + px[k] - u, dy = cj + dj + py[k] - v;
      d1 = Math.min(d1, dx * dx + dy * dy);
    }
    const loop = Math.abs(Math.sqrt(d1) - 0.32); // a ring of yarn around each seed
    const h = clamp(1 - loop * 4, 0, 1), f = pfbm(x / W * 6, y / H * 6, 6, 6, 3, 5);
    const val = 214 + h * 30 + (f - 0.5) * 20;
    o.r = val; o.g = val * 0.97; o.b = val * 0.92;
    o.h = h; o.rough = 0.97; o.ao = 0.6 + h * 0.4;
  });
}

/** Full-grain leather: pebbled grain and a few soft creases. Tints with the material color. */
function leather() {
  const W = 256, H = 256;
  return build(W, H, 1.5, 1.5, 1.6, (x, y, o) => {
    const u = x / W, v = y / H;
    const grain = pnoise(u * 90, v * 90, 90, 90, 7) * 0.6 + pnoise(u * 40, v * 40, 40, 40, 8) * 0.4;
    const crease = Math.abs(pfbm(u * 3, v * 3, 3, 3, 4, 9) - 0.5);
    const c = clamp(1 - crease * 18, 0, 1);
    const val = 208 + (grain - 0.5) * 36 - c * 30;
    o.r = val; o.g = val; o.b = val;
    o.h = grain * 0.8 - c * 0.4; o.rough = 0.48 + (grain - 0.5) * 0.12 + c * 0.1;
  });
}

/** Honed white quartzite counter: soft grey veining. */
function quartz() {
  const W = 512, H = 512;
  return build(W, H, 4, 4, 0.2, (x, y, o) => {
    const u = x / W, v = y / H;
    // a few long, soft, broken veins on a faintly clouded white ground
    const warp = pfbm(u * 2, v * 2, 2, 2, 5, 61);
    const vein = Math.abs(Math.sin((u * 1 + v * 2 + warp * 1.6) * Math.PI * 2));
    const fade = clamp(pfbm(u * 3, v * 3, 3, 3, 3, 64) * 2 - 0.6, 0, 1); // veins come and go along their length
    const t = clamp((1 - vein) * 10 - 9, 0, 1) * 0.35 * fade + clamp((1 - vein) * 3 - 2, 0, 1) * 0.08 * fade;
    const cloud = pfbm(u * 5, v * 5, 5, 5, 4, 63);
    lerp3([238, 236, 231], [168, 166, 164], t + (cloud - 0.5) * 0.08, o);
    o.h = 0.5; o.rough = 0.24 + t * 0.06;
  });
}

function felt() {
  const W = 256, H = 256;
  return build(W, H, 1, 1, 0.4, (x, y, o) => {
    const f = hash2(x, y, 3), g = pfbm(x / W * 8, y / H * 8, 8, 8, 4, 4);
    const v = 200 + (g - 0.5) * 30 + (f - 0.5) * 18;
    o.r = v; o.g = v; o.b = v; o.h = g; o.rough = 0.98;
  });
}

/** Pale white oak for closets and kids' pieces. */
function lightwood() {
  const W = 256, H = 256;
  return build(W, H, 3, 3, 0.6, (x, y, o) => {
    const u = x / W, v = y / H;
    const s = pfbm(u * 4, v * 40, 4, 40, 4, 71), ring = Math.sin(v * 60 + s * 8) * 0.5 + 0.5;
    lerp3([200, 172, 132], [232, 210, 176], clamp(0.5 + (s - 0.5) * 1.2 + (ring - 0.5) * 0.2, 0, 1), o);
    o.h = s; o.rough = 0.55;
  });
}

/* ---------- rugs: three patterns, each covering the rug once ---------- */

/** Hand-knotted wool: heathered field, a 6-in border band and a fringe-less edge. */
function rugWool() {
  const W = 512, H = 512;
  return build(W, H, 1, 1, 0.9, (x, y, o) => {
    const u = x / W, v = y / H, e = Math.min(u, v, 1 - u, 1 - v);
    const heather = hash2(x, y, 11) * 0.5 + pfbm(u * 12, v * 12, 12, 12, 4, 12) * 0.5;
    const band = e > 0.04 && e < 0.065;
    const base = band ? [120, 104, 86] : [204, 190, 166];
    const k = 0.9 + (heather - 0.5) * 0.22;
    o.r = base[0] * k; o.g = base[1] * k; o.b = base[2] * k;
    o.h = heather; o.rough = 1;
  });
}

/** Flat-weave stripe: charcoal and oat bands of varying width. */
function rugStripe() {
  const W = 512, H = 512;
  const r = rng(5), stops: [number, number][] = []; let acc = 0;
  while (acc < 1) { const w = 0.02 + r() * 0.08; stops.push([acc, r() < 0.55 ? 0 : r() < 0.7 ? 1 : 2]); acc += w; }
  const pal = [[72, 70, 68], [198, 186, 164], [150, 92, 64]];
  return build(W, H, 1, 1, 1.1, (x, y, o) => {
    const u = x / W, v = y / H;
    let c = 0; for (const [s, k] of stops) if (v >= s) c = k;
    const weave = ((x >> 1) + (y >> 1)) & 1, n = hash2(x, y, 9);
    const k = 0.92 + weave * 0.06 + (n - 0.5) * 0.12;
    o.r = pal[c][0] * k; o.g = pal[c][1] * k; o.b = pal[c][2] * k;
    o.h = weave * 0.6 + n * 0.4; o.rough = 1;
    if (Math.min(u, 1 - u) < 0.012) { o.r *= 0.8; o.g *= 0.8; o.b *= 0.8; }
  });
}

/** Kilim-style diamonds in rust, indigo and cream. */
function rugKilim() {
  const W = 512, H = 512;
  return build(W, H, 1, 1, 1.0, (x, y, o) => {
    const u = x / W, v = y / H;
    const cu = (u * 6) % 1, cv = (v * 4) % 1;
    const d = Math.abs(cu - 0.5) + Math.abs(cv - 0.5);
    const ring = Math.floor(d * 8);
    const pal = [[164, 78, 52], [214, 198, 170], [48, 60, 86], [214, 198, 170], [164, 78, 52], [120, 54, 38], [214, 198, 170], [48, 60, 86]];
    const e = Math.min(u, v, 1 - u, 1 - v);
    const c = e < 0.05 ? [48, 60, 86] : pal[ring % pal.length];
    const n = hash2(x, y, 4), k = 0.9 + (n - 0.5) * 0.16;
    o.r = c[0] * k; o.g = c[1] * k; o.b = c[2] * k; o.h = n; o.rough = 1;
  });
}

/* ---------- art: four abstract canvases ---------- */

function art(seed: number, pal: number[][]) {
  const W = 512, H = 384;
  const r = rng(seed);
  const shapes = Array.from({ length: 7 }, () => ({ x: r(), y: r(), rx: 0.08 + r() * 0.35, ry: 0.05 + r() * 0.3, c: pal[1 + Math.floor(r() * (pal.length - 1))], soft: r() }));
  return build(W, H, 1, 1, 0.5, (x, y, o) => {
    const u = x / W, v = y / H;
    let col = pal[0].slice();
    for (const s of shapes) {
      const d = ((u - s.x) / s.rx) ** 2 + ((v - s.y) / s.ry) ** 2;
      const a = clamp((1 - d) * (2 + s.soft * 6), 0, 1) * 0.85;
      col = col.map((c, i) => c + (s.c[i] - c) * a);
    }
    const canvas = hash2(x, y, seed) * 0.5 + pnoise(u * 60, v * 45, 60, 45, seed) * 0.5;
    const k = 0.94 + (canvas - 0.5) * 0.1;
    o.r = col[0] * k; o.g = col[1] * k; o.b = col[2] * k; o.h = canvas; o.rough = 0.85;
  });
}

/* ---------- screens ---------- */

/** Game-room TV: a moody racing-game frame (dark, with a bright horizon), used as an emissive map. */
function screenGame() {
  const W = 512, H = 288;
  return build(W, H, 1, 1, 0, (x, y, o) => {
    const u = x / W, v = y / H; // DataTexture row 0 is the bottom of the image
    const sky = v > 0.45, road = !sky && Math.abs(u - 0.5) < (0.45 - v) * 1.1;
    if (sky) lerp3([255, 150, 70], [40, 50, 110], clamp((v - 0.45) * 2.4, 0, 1), o);
    else if (road) { const stripe = Math.abs(u - 0.5) < 0.008 && ((v * 40) % 1) > 0.5; o.r = stripe ? 230 : 46; o.g = stripe ? 220 : 48; o.b = stripe ? 200 : 54; }
    else { const t = pfbm(u * 8, v * 8, 8, 8, 3, 2); o.r = 22 + t * 30; o.g = 40 + t * 40; o.b = 30 + t * 20; }
    if (v > 0.43 && v < 0.47) { const m = pfbm(u * 12, 0, 12, 1, 3, 4); if (v < 0.45 + m * 0.02) { o.r *= 0.35; o.g *= 0.35; o.b *= 0.5; } }
    o.rough = 0.2;
  });
}

/** Golf simulator screen: fairway, trees and sky. */
function screenGolf() {
  const W = 512, H = 420;
  return build(W, H, 1, 1, 0, (x, y, o) => {
    const u = x / W, v = y / H;
    const hor = 0.42 + pfbm(u * 4, 0, 4, 1, 3, 8) * 0.06;
    if (v > hor + 0.06) lerp3([170, 205, 235], [90, 140, 205], clamp((v - hor) * 1.6, 0, 1), o);
    else if (v > hor) { const t = pfbm(u * 30, v * 20, 30, 20, 3, 9); o.r = 40 + t * 40; o.g = 70 + t * 50; o.b = 40 + t * 20; }
    else {
      const fair = Math.abs(u - 0.5) < 0.12 + (hor - v) * 0.6;
      const t = pfbm(u * 20, v * 20, 20, 20, 3, 10), mow = ((v * 30) | 0) & 1;
      o.r = fair ? 92 + mow * 10 : 64; o.g = fair ? 150 + mow * 14 + t * 10 : 110 + t * 20; o.b = fair ? 64 : 48;
    }
    o.rough = 0.9;
  });
}

/* ---------- leaf cards ---------- */

/**
 * A cluster of broad leaves on a transparent card (alpha-tested), for potted fiddle-leaf figs
 * and olive trees. 4 leaves per card, each an ellipse with a midrib.
 */
function leafCard() {
  const W = 256, H = 256;
  const r = rng(17);
  const leaves = Array.from({ length: 5 }, () => ({ x: 0.25 + r() * 0.5, y: 0.25 + r() * 0.5, a: r() * Math.PI * 2, l: 0.2 + r() * 0.12, w: 0.09 + r() * 0.05, t: r() }));
  return build(W, H, 1, 1, 0.6, (x, y, o) => {
    const u = x / W, v = y / H;
    o.a = 0; o.r = 60; o.g = 84; o.b = 44;
    for (const L of leaves) {
      const dx = u - L.x, dy = v - L.y, c = Math.cos(L.a), s = Math.sin(L.a);
      const lx = dx * c + dy * s, ly = -dx * s + dy * c;
      const e = (lx / L.l) ** 2 + (ly / L.w) ** 2;
      if (e < 1) {
        const rib = Math.abs(ly) < 0.006, vein = Math.abs(Math.sin(lx * 90)) < 0.15 && Math.abs(ly) < L.w * 0.8;
        const k = 0.75 + L.t * 0.4 + (1 - e) * 0.15;
        o.r = (rib ? 120 : vein ? 70 : 52) * k; o.g = (rib ? 140 : vein ? 104 : 88) * k; o.b = (rib ? 80 : 46) * k;
        o.a = 255; o.h = 1 - e; o.rough = 0.55;
      }
    }
  });
}

export const FURNITURE_GENERATORS: Record<string, () => TexSet> = {
  fabric: linenWeave,
  boucle,
  leather,
  quartz,
  felt,
  lightwood,
  rug0: rugWool,
  rug1: rugStripe,
  rug2: rugKilim,
  art0: () => art(3, [[226, 220, 206], [176, 92, 58], [44, 58, 74], [210, 170, 96]]),
  art1: () => art(8, [[34, 40, 48], [196, 186, 160], [120, 140, 150], [180, 96, 60]]),
  art2: () => art(12, [[214, 206, 190], [96, 118, 90], [62, 70, 60], [230, 220, 196]]),
  art3: () => art(21, [[180, 120, 86], [236, 222, 196], [70, 46, 40], [140, 150, 160]]),
  screenGame,
  screenGolf,
  leafCard,
};
