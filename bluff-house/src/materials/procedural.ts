import { clamp, hash2, pfbm, pnoise, rng } from '../util/noise';
import { FURNITURE_GENERATORS } from './furnitureTex';
import { NATURE_GENERATORS } from './natureTex';
import { boardRows, build, lerp3, rowWidths, type TexSet } from './texcore';

export type { TexSet } from './texcore';

/**
 * Procedural PBR texture sets (albedo + normal + roughness/AO), generated once at load.
 * They stand in for the ambientCG / Poly Haven 2K scans until those hosts are reachable;
 * each set has a real-world tile size in feet, so a 7-in plank is 7 in everywhere.
 */

/* ------------------------------------------------------------------ generators */

/** Wide-plank hickory, satin: 7–10 in boards with hickory's strong light/dark variation. Planks run along u. */
function hickory() {
  const W = 1024, H = 1024, ft = 8, pxPerFt = W / ft;
  const rows = rowWidths(H, [7, 8, 9, 10].map((i) => Math.round((i / 12) * pxPerFt)), 11);
  const rowStart: number[] = []; let acc = 0; for (const w of rows) { rowStart.push(acc); acc += w; }
  const rowOf = new Int16Array(H); rows.forEach((w, k) => { for (let i = 0; i < w; i++) rowOf[rowStart[k] + i] = k; });
  const boards = boardRows(W, rows, 3 * pxPerFt, 8 * pxPerFt, 12);
  const dark = [98, 70, 46], light = [198, 162, 120], sap = [218, 192, 156];
  return build(W, H, ft, ft, 1.6, (x, y, o) => {
    const k = rowOf[y], ry = y - rowStart[k], rw = rows[k];
    const bd = boards[k], id = bd.id[x], tone = bd.tone[id];
    const edgeY = Math.min(ry, rw - 1 - ry), nextDiff = bd.id[(x + 1) % W] !== id || bd.id[(x - 1 + W) % W] !== id;
    const gap = edgeY < 1.2 || nextDiff;
    // long grain streaks + cathedral arcs inside each board
    const u = x / W, v = y / H;
    const streak = pfbm(u * 6, v * 90, 6, 90, 4, 40 + k);
    const arc = Math.sin((ry / rw) * 9 + pfbm(u * 3, v * 6, 3, 6, 3, 7 + id) * 9 + u * 40) * 0.5 + 0.5;
    const fleck = pnoise(u * 300, v * 60, 300, 60, 3);
    // hickory: some boards dark heartwood, some pale sapwood, most in between
    let t = clamp(0.15 + tone * 0.75 + (streak - 0.5) * 0.9 + (arc - 0.5) * 0.18 + (fleck - 0.5) * 0.08, 0, 1);
    if (tone > 0.82) { lerp3(light, sap, (t - 0.5) * 2, o); } else lerp3(dark, light, t, o);
    const sh = 1 - 0.12 * pnoise(u * 2, v * 40, 2, 40, 5 + k); // slight board-to-board sheen variation
    o.r *= sh; o.g *= sh; o.b *= sh;
    o.h = gap ? 0.15 : 0.55 + (streak - 0.5) * 0.08;
    o.rough = gap ? 0.9 : 0.36 + (fleck - 0.5) * 0.12 + (1 - sh) * 0.4;
    o.ao = gap ? 0.55 : 1;
    if (gap) { o.r *= 0.45; o.g *= 0.42; o.b *= 0.4; }
  });
}

/** Warm white hand-troweled plaster. */
function plaster(base: number[], amp: number, seed: number, rough = 0.9) {
  const W = 512, H = 512;
  return build(W, H, 8, 8, 0.35, (x, y, o) => {
    const u = x / W, v = y / H;
    const m = pfbm(u * 5, v * 5, 5, 5, 5, seed);
    const trowel = pfbm(u * 2 + v * 0.6, v * 14, 2, 14, 3, seed + 9);
    const t = (m - 0.5) * amp + (trowel - 0.5) * amp * 0.5;
    o.r = base[0] + t; o.g = base[1] + t * 0.95; o.b = base[2] + t * 0.9;
    o.h = m * 0.6 + trowel * 0.4; o.rough = rough - trowel * 0.06;
  });
}

/**
 * Stacked fieldstone: irregular, horizontally elongated stones (an anisotropic Voronoi on a jittered
 * grid, wrapping so it tiles), warm tan/grey/rust tones, domed faces and deep raked mortar joints.
 */
function fieldstone(seed: number, tile = 5) {
  const W = 512, H = 512;
  const NX = 6, NY = 15, ASPECT = 3.4; // ~10 in × 4 in average at 5 ft per tile: long, flat ledge stones
  const r = rng(seed);
  const jx = new Float32Array(NX * NY), jy = new Float32Array(NX * NY), tone = new Float32Array(NX * NY * 3);
  for (let i = 0; i < NX * NY; i++) { jx[i] = 0.12 + r() * 0.76; jy[i] = 0.18 + r() * 0.64; tone[i * 3] = r(); tone[i * 3 + 1] = r(); tone[i * 3 + 2] = r(); }
  const pal = [[164, 150, 130], [178, 162, 138], [146, 138, 126], [170, 144, 112], [152, 140, 122], [188, 174, 150], [156, 130, 100], [138, 132, 122], [174, 152, 124], [150, 120, 94]];
  return build(W, H, tile, tile, 3.0, (x, y, o) => {
    const fx = (x / W) * NX, fy = (y / H) * NY;
    const cx = Math.floor(fx), cy = Math.floor(fy);
    let d1 = 1e9, d2 = 1e9, best = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -2; dx <= 2; dx++) {
      const gx = cx + dx, gy = cy + dy;
      const wx = ((gx % NX) + NX) % NX, wy = ((gy % NY) + NY) % NY, k = wy * NX + wx;
      // rows are offset by half a stone, like laid courses
      const px = gx + jx[k] + (wy % 2) * 0.5, py = gy + jy[k];
      const ddx = (fx - px) / ASPECT * NX / NY * 1.6, ddy = fy - py;
      const d = ddx * ddx + ddy * ddy;
      if (d < d1) { d2 = d1; d1 = d; best = k; } else if (d < d2) d2 = d;
    }
    const edge = Math.sqrt(d2) - Math.sqrt(d1); // 0 on the joint
    const g = pfbm(x / W * 16, y / H * 16, 16, 16, 4, 77), f = pnoise(x / W * 110, y / H * 110, 110, 110, 5);
    if (edge < 0.042) {
      const m = 0.8 + g * 0.2;
      o.r = 128 * m; o.g = 120 * m; o.b = 108 * m; o.h = 0.06; o.rough = 0.96; o.ao = 0.6;
      return;
    }
    const c = pal[Math.floor(tone[best * 3] * pal.length)];
    const s = 0.9 + tone[best * 3 + 1] * 0.16 + (g - 0.5) * 0.22 + (f - 0.5) * 0.1;
    o.r = c[0] * s; o.g = c[1] * s; o.b = c[2] * s * (0.96 + tone[best * 3 + 2] * 0.06);
    const dome = Math.min(1, (edge - 0.042) / 0.18);
    o.h = 0.25 + Math.min(1, dome * 1.6) * 0.45 + (g - 0.5) * 0.3 + tone[best * 3 + 2] * 0.15;
    o.rough = 0.78 + (f - 0.5) * 0.16;
    o.ao = 0.55 + dome * 0.45;
  });
}

/** Board-and-batten: 10-in boards with 2.5-in raised battens on the joints, stained cedar. Vertical (u across, v up). */
function boardAndBatten() {
  const W = 512, H = 512, ft = 6, pxPerFt = W / ft;
  const pitch = Math.round((12.5 / 12) * pxPerFt), batten = Math.round((2.5 / 12) * pxPerFt);
  const stain = [[92, 74, 58], [132, 106, 82]];
  return build(W, H, ft, ft, 2.2, (x, y, o) => {
    const p = x % pitch, board = Math.floor(x / pitch);
    const u = x / W, v = y / H;
    const grain = pfbm(u * 40, v * 3, 40, 3, 4, 60 + board), fine = pnoise(u * 200, v * 8, 200, 8, 3);
    const onB = p < batten;
    const t = clamp(0.4 + (grain - 0.5) * 1.0 + (hash2(board, onB ? 1 : 0, 3) - 0.5) * 0.3 + (fine - 0.5) * 0.15, 0, 1);
    lerp3(stain[0], stain[1], t, o);
    const edge = onB && (p < 2 || p > batten - 3);
    o.h = onB ? (edge ? 0.6 : 0.9) : 0.3 + (grain - 0.5) * 0.06;
    o.rough = 0.82 + (fine - 0.5) * 0.1;
    o.ao = onB ? 1 : p < batten + 4 || p > pitch - 4 ? 0.65 : 1;
    if (!onB && (p < batten + 2 || p > pitch - 2)) { o.r *= 0.7; o.g *= 0.7; o.b *= 0.7; }
  });
}

/** Straight-grain wood (grain along v); saw marks for rough-sawn timber. */
function wood(a: number[], b: number[], tile: number, seed: number, rings: number, rough: number, sawn = false) {
  const W = 512, H = 512;
  return build(W, H, tile, tile, sawn ? 1.6 : 0.6, (x, y, o) => {
    const u = x / W, v = y / H;
    const g = pfbm(u * rings, v * 2, rings, 2, 4, seed), f = pnoise(u * 200, v * 6, 200, 6, seed + 4);
    const fig = Math.sin(u * rings * 6 + pfbm(u * 4, v * 3, 4, 3, 3, seed + 8) * 10) * 0.5 + 0.5;
    const t = clamp(0.5 + (g - 0.5) * 1.3 + (f - 0.5) * 0.25 + (fig - 0.5) * 0.12, 0, 1);
    lerp3(a, b, t, o);
    let h = 0.5 + (g - 0.5) * 0.2;
    if (sawn) { const saw = Math.sin(v * 160 + pnoise(u * 6, v * 6, 6, 6, seed) * 3) * 0.5 + 0.5; h += (saw - 0.5) * 0.25; o.r *= 0.92 + saw * 0.08; }
    o.h = h; o.rough = rough + (f - 0.5) * 0.1;
  });
}

/** Rectangular tiles in running bond (dimensions in inches), with grout. */
function tiles(wIn: number, hIn: number, tileFt: number, base: number[], vary: number, grout: number[], seed: number, rough: number, cleft = 0) {
  const W = 512, H = 512, pxPerIn = W / (tileFt * 12);
  const tw = wIn * pxPerIn, th = hIn * pxPerIn;
  return build(W, H, tileFt, tileFt, cleft ? 1.8 : 0.8, (x, y, o) => {
    const row = Math.floor(y / th), off = (row % 2) * tw * 0.5;
    const col = Math.floor((x + off) / tw);
    const gx = (x + off) % tw, gy = y % th;
    const g = pfbm(x / W * 10, y / H * 10, 10, 10, 4, seed), tt = hash2(col, row, seed);
    if (gx < 1.6 || gy < 1.6) { o.r = grout[0]; o.g = grout[1]; o.b = grout[2]; o.h = 0.1; o.rough = 0.95; o.ao = 0.7; return; }
    const s = 1 + (g - 0.5) * vary + (tt - 0.5) * vary * 0.8;
    o.r = base[0] * s; o.g = base[1] * s; o.b = base[2] * s;
    const cl = cleft ? pfbm(x / W * 30, y / H * 30, 30, 30, 4, seed + 3) : 0.5;
    o.h = 0.6 + (cl - 0.5) * cleft; o.rough = rough + (g - 0.5) * 0.08 + (cl - 0.5) * cleft * 0.2;
  });
}

function speckle(base: number[], vary: number, tile: number, seed: number, rough: number, fleck = 0) {
  const W = 512, H = 512;
  return build(W, H, tile, tile, 0.5, (x, y, o) => {
    const g = pfbm(x / W * 6, y / H * 6, 6, 6, 5, seed), f = hash2(x, y, seed);
    const s = 1 + (g - 0.5) * vary + (f - 0.5) * 0.05;
    o.r = base[0] * s; o.g = base[1] * s; o.b = base[2] * s;
    if (fleck && f > 1 - fleck) { o.r += 50; o.g += 50; o.b += 55; }
    o.h = g; o.rough = rough + (g - 0.5) * 0.1;
  });
}

/** Ipe deck boards: 5.5-in boards with 0.25-in gaps, running along u. */
function deckBoards() {
  const W = 512, H = 512, ft = 8, pxPerIn = W / 96;
  const pitch = 5.75 * pxPerIn;
  const boards = boardRows(W, Array.from({ length: Math.ceil(H / pitch) }, () => 0), 48, 200, 21);
  return build(W, H, ft, ft, 1.2, (x, y, o) => {
    const k = Math.floor(y / pitch), ry = y - k * pitch, id = boards[k % boards.length].id[x], tone = boards[k % boards.length].tone[id];
    const g = pfbm(x / W * 4, y / H * 70, 4, 70, 3, 40 + k);
    const gap = ry > pitch - 0.25 * pxPerIn - 0.5 || boards[k % boards.length].id[(x + 1) % W] !== id;
    lerp3([96, 58, 38], [150, 98, 64], clamp(0.25 + tone * 0.5 + (g - 0.5) * 0.9, 0, 1), o);
    if (gap) { o.r *= 0.25; o.g *= 0.25; o.b *= 0.25; }
    o.h = gap ? 0 : 0.6; o.rough = gap ? 1 : 0.62; o.ao = gap ? 0.4 : 1;
  });
}

/** Standing-seam metal: raised seams every 16 in (seams run along v). */
function standingSeam() {
  const W = 256, H = 256, ft = 8, pxPerIn = W / 96, pitch = 16 * pxPerIn;
  return build(W, H, ft, ft, 3, (x, y, o) => {
    const p = x % pitch, seam = p < 1.2 * pxPerIn;
    const g = pnoise(x / W * 6, y / H * 6, 6, 6, 15);
    const v = seam ? 58 : 66 + (g - 0.5) * 6;
    o.r = v; o.g = v * 0.92; o.b = v * 0.84; // dark bronze
    o.h = seam ? 1 : 0.3 + Math.sin((p / pitch) * Math.PI) * 0.04; o.rough = seam ? 0.35 : 0.45;
  });
}

function poolMosaic() {
  const W = 256, H = 256, ft = 2, c = W / (ft * 12); // 1-in mosaic
  return build(W, H, ft, ft, 0.8, (x, y, o) => {
    const gx = x % c, gy = y % c, gr = gx < 1 || gy < 1;
    const t = hash2(Math.floor(x / c), Math.floor(y / c), 6);
    if (gr) { o.r = 190; o.g = 196; o.b = 194; o.h = 0.2; o.rough = 0.8; return; }
    o.r = 38 + t * 22; o.g = 98 + t * 26; o.b = 112 + t * 22; o.h = 0.6; o.rough = 0.18;
  });
}

function grass() {
  const W = 512, H = 512;
  return build(W, H, 16, 16, 0.8, (x, y, o) => {
    const g = pfbm(x / W * 8, y / H * 8, 8, 8, 5, 21), f = hash2(x, y, 22);
    lerp3([62, 76, 40], [112, 118, 60], clamp(g * 1.2 - 0.1 + (f - 0.5) * 0.3, 0, 1), o);
    if (f > 0.994) { o.r = 168; o.g = 94; o.b = 40; } // fallen leaves
    o.h = f; o.rough = 0.95;
  });
}

/* ------------------------------------------------------------------ registry */

const GENERATORS: Record<string, () => TexSet> = {
  hickory,
  plaster: () => plaster([236, 231, 222], 8, 3),
  ceil: () => plaster([242, 238, 231], 4, 4, 0.95),
  theater: () => plaster([58, 54, 56], 8, 5),
  stone: () => fieldstone(31),
  siding: boardAndBatten,
  oak: () => wood([186, 152, 112], [222, 194, 156], 4, 11, 30, 0.5),
  walnut: () => wood([62, 40, 28], [120, 84, 58], 4, 13, 30, 0.42),
  timber: () => wood([108, 76, 50], [158, 116, 78], 7, 15, 18, 0.85, true),
  tile: () => tiles(24, 48, 8, [196, 189, 178], 0.08, [150, 144, 136], 70, 0.32),
  slate: () => tiles(12, 24, 6, [86, 90, 88], 0.25, [56, 54, 52], 80, 0.6, 0.8),
  concrete: () => speckle([150, 148, 143], 0.18, 14, 90, 0.55),
  rubber: () => speckle([34, 34, 36], 0.12, 4, 4, 0.92, 0.02),
  turf: () => speckle([64, 116, 54], 0.25, 6, 8, 0.95),
  pavers: () => tiles(24, 36, 12, [178, 166, 146], 0.16, [160, 150, 132], 33, 0.78, 0.4),
  deck: deckBoards,
  roof: standingSeam,
  poolTile: poolMosaic,
  grass,
  ...FURNITURE_GENERATORS,
  ...NATURE_GENERATORS,
};

const cache = new Map<string, TexSet>();
/** Generated texture set for a key, or null if the key is a flat material. Cached. */
export function textureSet(key: string): TexSet | null {
  const gen = GENERATORS[key];
  if (!gen) return null;
  let t = cache.get(key);
  if (!t) { t = gen(); cache.set(key, t); }
  return t;
}
export const TEXTURE_KEYS = Object.keys(GENERATORS);
/** A pre-baked set (KTX2, see prebuilt.ts) takes the place of the generator for its key. */
export function registerTextureSet(key: string, t: TexSet) { if (GENERATORS[key]) cache.set(key, t); }
