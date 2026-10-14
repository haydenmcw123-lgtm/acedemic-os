import { CEIL_H, FLOOR_Y, WALL_H } from '../data/house';
import type { BuildContext } from './context';

type V3 = [number, number, number];

export const GABLE = { pitch: 0.68, eave: 2.2 };

/** Greedy decomposition of a boolean grid into rectangles [i0, j0, i1, j1). */
export function greedyRects(mask: Uint8Array, W: number, H: number): [number, number, number, number][] {
  const used = new Uint8Array(W * H), out: [number, number, number, number][] = [];
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (!mask[j * W + i] || used[j * W + i]) continue;
    let w = 1; while (i + w < W && mask[j * W + i + w] && !used[j * W + i + w]) w++;
    let h = 1;
    outer: while (j + h < H) { for (let k = 0; k < w; k++) if (!mask[(j + h) * W + i + k] || used[(j + h) * W + i + k]) break outer; h++; }
    for (let a = 0; a < h; a++) for (let k = 0; k < w; k++) used[(j + a) * W + i + k] = 1;
    out.push([i, j, i + w, j + h]);
  }
  return out;
}

/** The great room's gable, derived from its rectangle: ridge runs east–west through its middle. */
export function gableGeometry(ctx: BuildContext) {
  const great = ctx.data.rooms.find((r) => r.id === 'great');
  if (!great) return null;
  const [x0, z0, x1, z1] = great.rects[0];
  const y0 = FLOOR_Y[2] + WALL_H[2]; // eave line = top of the upper-level walls
  const half = (z1 - z0) / 2, zr = (z0 + z1) / 2;
  const yr = y0 + half * GABLE.pitch;
  return { x0, x1, z0, z1, zr, y0, yr, half };
}

/**
 * Standing-seam roofs: flat-roof slabs over every top-most room, 2.2-ft eaves on the upper level,
 * and the great room's 8:12 gable with exposed timber trusses and a full glass gable end facing the lake.
 */
export function buildRoof(ctx: BuildContext) {
  const { plan } = ctx; const g = ctx.geo;
  const W = plan.gw, H = plan.gh;
  for (let L = 0; L < 3; L++) {
    const mask = new Uint8Array(W * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const o = plan.own[L][j * W + i];
      if (o < 0 || plan.rooms[o].void) continue;
      const up = L < 2 ? plan.own[L + 1][j * W + i] : -1;
      if (up < 0) mask[j * W + i] = 1;
    }
    const y = FLOOR_Y[L] + CEIL_H[L];
    for (const [i0, j0, i1, j1] of greedyRects(mask, W, H)) {
      const x0 = i0 + plan.gx0, x1 = i1 + plan.gx0, z0 = j0 + plan.gz0, z1 = j1 + plan.gz0;
      const outside = (ax: 'x' | 'z', line: number, a: number, b: number) => {
        for (let t = a; t < b; t++) if ((ax === 'x' ? plan.ownerAt(L, line, t) : plan.ownerAt(L, t, line)) >= 0) return false;
        return true;
      };
      const ev = GABLE.eave;
      const e0 = L === 2 && outside('x', x0 - 1, z0, z1) ? ev : 0.3, e1 = L === 2 && outside('x', x1, z0, z1) ? ev : 0.3;
      const f0 = L === 2 && outside('z', z0 - 1, x0, x1) ? ev : 0.3, f1 = L === 2 && outside('z', z1, x0, x1) ? ev : 0.3;
      g.box([x0 - e0, y, z0 - f0], [x1 + e1, y + 1.3, z1 + f1], { py: 'roof', ny: 'soffit', px: 'fascia', nx: 'fascia', pz: 'fascia', nz: 'fascia' }, 'shell');
    }
  }

  const G = gableGeometry(ctx);
  if (!G) return;
  const { x0, x1, z0, z1, zr, y0, yr, half } = G;
  const th = Math.atan(GABLE.pitch);
  const ex0 = x0 - 3.2, ex1 = x1 + 0.6; // overhang past the glass gable to the west
  // two sloped roof planes (built as quads with thickness)
  // no overhang on a side that butts into an upper-level room (the upper hall)
  const bordersRoom = (z: number) => { for (let x = x0; x < x1; x++) if (ctx.plan.ownerAt(2, x, z) >= 0) return true; return false; };
  for (const dir of [-1, 1]) {
    const eave = bordersRoom(dir < 0 ? z0 - 1 : z1) ? 0 : GABLE.eave;
    const zEave = zr + dir * (half + eave);
    const yEave = yr - (half + eave) * GABLE.pitch;
    const t = 1.0 / Math.cos(th);
    const top = (x: number, zz: number, yy: number): V3 => [x, yy + t * 0.5 + 0.05, zz];
    const bot = (x: number, zz: number, yy: number): V3 => [x, yy - t * 0.5 + 0.05, zz];
    const r0 = top(ex0, zr, yr), r1 = top(ex1, zr, yr), e0 = top(ex0, zEave, yEave), e1 = top(ex1, zEave, yEave);
    const b0 = bot(ex0, zr, yr), b1 = bot(ex1, zr, yr), c0 = bot(ex0, zEave, yEave), c1 = bot(ex1, zEave, yEave);
    if (dir > 0) { g.quad('shell', 'roof', r0, e0, e1, r1); g.quad('shell', 'soffit', b0, b1, c1, c0); g.quad('shell', 'fascia', c0, c1, e1, e0); }
    else { g.quad('shell', 'roof', r1, e1, e0, r0); g.quad('shell', 'soffit', b1, b0, c0, c1); g.quad('shell', 'fascia', c1, c0, e0, e1); }
    // rake ends
    if (dir > 0) { g.quad('shell', 'fascia', b0, c0, e0, r0); g.quad('shell', 'fascia', c1, b1, r1, e1); }
    else { g.quad('shell', 'fascia', c0, b0, r0, e0); g.quad('shell', 'fascia', b1, c1, e1, r1); }
  }
  // east gable wall (solid) and west gable end (glass) above the eave line
  const tri = (x: number): [V3, V3, V3] => [[x, y0, z0], [x, y0, z1], [x, yr, zr]];
  {
    const [a, b, c] = tri(x1 - 0.25), [a2, b2, c2] = tri(x1 + 0.25);
    g.tri('L1i', 'plaster', a, b, c); g.tri('shell', 'siding', a2, c2, b2);
  }
  {
    const [a, b, c] = tri(0);
    g.tri('shell', 'glass', a, b, c, false); g.tri('shell', 'glass', a, c, b, false);
    // steel mullions every ~4 ft, sized to the rake
    for (let z = z0 + 4; z < z1 - 1; z += 4.33) {
      const hgt = (yr - y0) * (1 - Math.abs(z - zr) / half);
      if (hgt > 0.3) g.solid([-0.1, y0, z - 0.07], [0.1, y0 + hgt, z + 0.07], 'steel', 'shell');
    }
    g.solid([-0.12, y0 - 0.2, z0], [0.12, y0 + 0.1, z1], 'steel', 'shell');
  }
  // exposed timber trusses (bottom chord, king post, rafters, struts) and a ridge beam
  const span = x1 - x0;
  for (const f of [0.14, 0.5, 0.86]) {
    const x = x0 + span * f;
    g.solid([x - 0.38, y0 - 1.1, z0], [x + 0.38, y0, z1], 'timber', 'L1i');
    g.solid([x - 0.38, y0, zr - 0.45], [x + 0.38, yr - 0.6, zr + 0.45], 'timber', 'L1i');
    for (const dir of [-1, 1]) {
      g.beam([x, y0 - 0.55, zr + dir * half], [x, yr - 0.55, zr], 0.75, 1.0, 'timber', 'L1i');
      g.beam([x, y0 + 0.3, zr + dir * 0.5], [x, y0 + 3.2, zr + dir * 5.5], 0.6, 0.7, 'timber', 'L1i');
    }
  }
  g.solid([x0, yr - 2.0, zr - 0.5], [x1, yr - 0.7, zr + 0.5], 'timber', 'L1i');
  // collision for the roof planes isn't needed (unreachable)
}

/** Stone fireplace mass rising through both stories to above the ridge; firebox faces the great room. */
export function buildFireplace(ctx: BuildContext) {
  const fps = ctx.data.openings.filter((o) => o.kind === 'fireplace' && o.level === 1);
  const G = gableGeometry(ctx);
  for (const o of fps) {
    const g = ctx.geo;
    const z0 = o.from, z1 = o.to, xc = o.at; // a mass 5 ft deep centered on the wall line
    const x0 = xc - 2.5, x1 = xc + 2.5;
    const topY = (G ? G.yr : FLOOR_Y[2] + WALL_H[2]) + 6;
    const fy0 = FLOOR_Y[1] + 1, fy1 = FLOOR_Y[1] + 4.2; // firebox opening
    const fz0 = z0 + 1.5, fz1 = z1 - 1.5;
    // outer foot on the terrace (outside the lower-level wall), then the full mass from the main floor up
    g.solid([x0, FLOOR_Y[0] - 0.5, z0], [xc - 0.25, FLOOR_Y[1] - 1, z1], 'stone', 'shell');
    g.solid([x0, FLOOR_Y[1] - 1, z0], [x1, fy0, z1], 'stone', 'shell');
    // sides of the firebox
    g.solid([x0, fy0, z0], [x1, fy1, fz0], 'stone', 'shell');
    g.solid([x0, fy0, fz1], [x1, fy1, z1], 'stone', 'shell');
    // back of the firebox (outer half)
    g.solid([x0, fy0, fz0], [xc + 0.4, fy1, fz1], 'stone', 'shell');
    // firebox interior faces
    g.quad('L1i', 'soot', [xc + 0.4, fy0, fz1], [xc + 0.4, fy0, fz0], [xc + 0.4, fy1, fz0], [xc + 0.4, fy1, fz1]);
    // above the firebox up past the ridge
    g.solid([x0, fy1, z0], [x1, topY, z1], 'stone', 'shell');
    g.solid([x0 - 0.3, topY, z0 - 0.3], [x1 + 0.3, topY + 0.5, z1 + 0.3], 'bronze', 'shell');
    // raised hearth and timber mantel on the room side
    g.solid([x1, FLOOR_Y[1], z0 - 1], [x1 + 1.6, FLOOR_Y[1] + 1.2, z1 + 1], 'stone', 'L1i');
    g.solid([x1, fy1 + 0.5, z0 - 1], [x1 + 1.0, fy1 + 1.15, z1 + 1], 'timber', 'L1i');
    ctx.col.box([x0, FLOOR_Y[0] - 0.5, z0], [xc - 0.25, FLOOR_Y[1] - 1, z1]);
    ctx.col.box([x0, FLOOR_Y[1] - 1, z0], [x1, topY, z1]);
    ctx.col.box([x1, FLOOR_Y[1], z0 - 1], [x1 + 1.6, FLOOR_Y[1] + 1.2, z1 + 1]);
  }
}
