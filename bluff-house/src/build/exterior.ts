import { FLOOR_Y } from '../data/house';
import type { Rect } from '../data/types';
import type { BuildContext } from './context';
import { railing } from './rails';
import { greedyRects } from './roof';
import { subtractRects } from './stairs';
import { baseGround } from './terrain';

type V3 = [number, number, number];

/** Rectangles where the grade is cut down under a paved or decked surface, with the height to cut to. */
export function siteCuts(ctx: BuildContext): { rect: Rect; y: number }[] {
  const s = ctx.data.site;
  return [
    { rect: [s.pool.rect[0] - 3, s.pool.rect[1] - 0.6, s.pool.rect[2] + 0.6, s.pool.rect[3] + 0.6], y: -s.pool.depth - 1.5 },
    { rect: s.terrace.rect, y: s.terrace.y - 0.35 },
    { rect: s.entry.walk, y: s.entry.y - 0.35 },
    { rect: s.driveway.rect, y: s.driveway.y - 0.35 },
  ];
}

/** Decks, pool terrace, infinity pool, entry canopy, motor court, foundation skirts, bluff stairs and dock. */
export function buildExterior(ctx: BuildContext, groundAt: (x: number, z: number) => number) {
  const g = ctx.geo, col = ctx.col, s = ctx.data.site;

  // ---- decks ----
  for (const d of s.decks) {
    const [x0, z0, x1, z1] = d.rect;
    g.box([x0, d.y - 0.45, z0], [x1, d.y, z1], { py: 'deck', ny: 'timber', px: 'timber', nx: 'timber', pz: 'timber', nz: 'timber' }, 'site');
    col.floor(x0, z0, x1, z1, d.y);
    for (const r of d.rails) railing(ctx, r.axis, r.at, r.from, r.to, d.y, 'site');
    // stone piers carrying the deck from grade
    const piers: [number, number][] = d.posts ? d.posts.z.map((z) => [d.posts!.x, z]) : [[x0 + 0.5, z0 + 0.5], [x0 + 0.5, z1 - 0.5], [x1 - 0.5, z0 + 0.5]];
    for (const [px, pz] of piers) {
      const gy = groundAt(px, pz);
      g.solid([px - 0.65, gy - 0.5, pz - 0.65], [px + 0.65, d.y - 0.45, pz + 0.65], 'stone', 'site');
      col.box([px - 0.65, gy - 0.5, pz - 0.65], [px + 0.65, d.y - 0.45, pz + 0.65]);
    }
    if (d.covered && d.posts) {
      // timber posts on the piers, beam and roof at the main-level ceiling line
      const top = d.y + 10;
      for (const pz of d.posts.z) {
        g.solid([d.posts.x - 0.45, d.y, pz - 0.45], [d.posts.x + 0.45, top, pz + 0.45], 'timber', 'site');
        col.box([d.posts.x - 0.45, d.y, pz - 0.45], [d.posts.x + 0.45, top, pz + 0.45]);
      }
      g.box([x0 - 1.2, top, z0 - 0.7], [x1, top + 1.1, z1 + 0.7], { py: 'roof', ny: 'soffit', px: 'fascia', nx: 'fascia', pz: 'fascia', nz: 'fascia' }, 'site');
    }
    if (d.privacyScreen) {
      const p = d.privacyScreen;
      const n = Math.round((p.to - p.from) / 0.5);
      for (let k = 0; k < n; k++) {
        const t = p.from + 0.2 + k * 0.5;
        const min: V3 = p.axis === 'z' ? [t, d.y, p.at] : [p.at, d.y, t];
        const max: V3 = p.axis === 'z' ? [t + 0.35, d.y + 7, p.at + 0.25] : [p.at + 0.25, d.y + 7, t + 0.35];
        g.solid(min, max, 'timber', 'site');
      }
      const min: V3 = p.axis === 'z' ? [p.from, d.y, p.at] : [p.at, d.y, p.from];
      const max: V3 = p.axis === 'z' ? [p.to, d.y + 7.3, p.at + 0.4] : [p.at + 0.4, d.y + 7.3, p.to];
      col.box(min, max);
    }
  }

  // ---- terrace + infinity pool ----
  const pool = s.pool.rect, [px0, pz0, px1, pz1] = pool, depth = s.pool.depth;
  const ty = s.terrace.y;
  for (const [x0, z0, x1, z1] of subtractRects(s.terrace.rect, [[px0 - 2.8, pz0 - 0.6, px1 + 0.6, pz1 + 0.6]])) {
    g.box([x0, ty - 0.3, z0], [x1, ty, z1], { py: 'pavers', px: 'pavers', nx: 'pavers', pz: 'pavers', nz: 'pavers' }, 'site');
    col.floor(x0, z0, x1, z1, ty);
  }
  // coping on three sides, the west edge is the vanishing edge
  g.solid([px1, ty - 0.3, pz0 - 0.6], [px1 + 0.6, ty + 0.05, pz1 + 0.6], 'coping', 'site');
  g.solid([px0, ty - 0.3, pz0 - 0.6], [px1, ty + 0.05, pz0], 'coping', 'site');
  g.solid([px0, ty - 0.3, pz1], [px1, ty + 0.05, pz1 + 0.6], 'coping', 'site');
  col.floor(px1, pz0 - 0.6, px1 + 0.6, pz1 + 0.6, ty + 0.05);
  col.floor(px0, pz0 - 0.6, px1, pz0, ty + 0.05);
  col.floor(px0, pz1, px1, pz1 + 0.6, ty + 0.05);
  // basin
  const by = ty - depth;
  g.quad('site', 'poolTile', [px0, by, pz1], [px1, by, pz1], [px1, by, pz0], [px0, by, pz0]);
  g.quad('site', 'poolTile', [px1, by, pz0], [px1, by, pz1], [px1, ty, pz1], [px1, ty, pz0]); // east wall faces -x
  g.quad('site', 'poolTile', [px0, by, pz0], [px1, by, pz0], [px1, ty, pz0], [px0, ty, pz0]); // north wall faces +z
  g.quad('site', 'poolTile', [px1, by, pz1], [px0, by, pz1], [px0, ty, pz1], [px1, ty, pz1]); // south wall faces -z
  const weir = ty - 0.35;
  g.quad('site', 'poolTile', [px0, by, pz1], [px0, by, pz0], [px0, weir, pz0], [px0, weir, pz1]); // west weir wall faces +x
  // catch trough and stone face below the vanishing edge
  g.solid([px0 - 2.8, ty - 3.3, pz0 - 0.6], [px0 - 0.2, ty - 1.4, pz1 + 0.6], 'stone', 'site');
  g.box([px0 - 0.2, ty - 3.3, pz0 - 0.6], [px0, weir, pz1 + 0.6], { py: 'coping', nx: 'stone', pz: 'stone', nz: 'stone' }, 'site');
  g.quad('site', 'water', [px0 - 2.4, ty - 1.5, pz1], [px0 - 0.2, ty - 1.5, pz1], [px0 - 0.2, ty - 1.5, pz0], [px0 - 2.4, ty - 1.5, pz0], false);
  g.quad('site', 'water', [px0, ty - 0.32, pz1], [px1, ty - 0.32, pz1], [px1, ty - 0.32, pz0], [px0, ty - 0.32, pz0], false);
  // pool collision: the basin and a low barrier at the edge so the capsule can't step in
  col.floor(px0, pz0, px1, pz1, by);
  col.box([px0 - 0.2, by, pz0], [px0, ty + 0.05, pz1]);
  col.box([px0 - 2.8, ty - 3.3, pz0 - 0.6], [px0 - 0.2, ty - 1.4, pz1 + 0.6]);

  // ---- entry walk + canopy ----
  {
    const [x0, z0, x1, z1] = s.entry.walk, y = s.entry.y;
    g.box([x0, y - 0.3, z0], [x1, y + 0.05, z1], { py: 'pavers', px: 'pavers', nx: 'pavers', pz: 'pavers', nz: 'pavers' }, 'site');
    col.floor(x0, z0, x1, z1, y + 0.05);
    const [cx0, cz0, cx1, cz1] = s.entry.canopy;
    g.solid([cx0, y + 9.4, cz0], [cx1, y + 10.4, cz1], 'timber', 'site');
    g.box([cx0 - 0.1, y + 10.4, cz0 - 0.1], [cx1 + 0.1, y + 10.6, cz1 + 0.1], { py: 'roof', px: 'fascia', nx: 'fascia', pz: 'fascia', nz: 'fascia' }, 'site');
    for (const [qx, qz] of s.entry.piers) {
      g.solid([qx - 0.7, y, qz - 0.7], [qx + 0.7, y + 9.4, qz + 0.7], 'stone', 'site');
      col.box([qx - 0.7, y, qz - 0.7], [qx + 0.7, y + 9.4, qz + 0.7]);
    }
  }
  // ---- motor court ----
  {
    const [x0, z0, x1, z1] = s.driveway.rect, y = s.driveway.y;
    g.box([x0, y - 0.3, z0], [x1, y, z1], { py: 'concrete', px: 'concrete', nx: 'concrete', pz: 'concrete', nz: 'concrete' }, 'site');
    col.floor(x0, z0, x1, z1, y);
  }

  // ---- stone foundation skirts where the main floor isn't over the lower level ----
  {
    const { plan } = ctx, W = plan.gw, H = plan.gh;
    const mask = new Uint8Array(W * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      if (plan.own[1][j * W + i] < 0 || plan.own[0][j * W + i] >= 0) continue;
      if (baseGround(i + plan.gx0 + 0.5, j + plan.gz0 + 0.5) < FLOOR_Y[1] - 0.4) mask[j * W + i] = 1;
    }
    for (const [i0, j0, i1, j1] of greedyRects(mask, W, H)) {
      const min: V3 = [i0 + plan.gx0, -1, j0 + plan.gz0], max: V3 = [i1 + plan.gx0, FLOOR_Y[1] - 0.1, j1 + plan.gz0];
      g.box(min, max, { px: 'stoneExt', nx: 'stoneExt', pz: 'stoneExt', nz: 'stoneExt' }, 'shell');
      col.box(min, max);
    }
  }

  // ---- bluff stairs ----
  const [w0, w1] = s.bluffStairs.width;
  for (const f of s.bluffStairs.flights) {
    const run = Math.abs(f.to - f.from), n = Math.round(run);
    const dir = Math.sign(f.to - f.from);
    const [c0, c1] = f.axis === 'x' ? [w0, w1] : f.cross!;
    for (let k = 0; k < n; k++) {
      const t0 = f.from + dir * k, t1 = t0 + dir;
      const y = f.y0 + ((f.y1 - f.y0) * (k + 0.5)) / n;
      const lo = Math.min(t0, t1), hi = Math.max(t0, t1);
      if (f.axis === 'x') g.solid([lo, y - 0.25, c0], [hi + 0.05, y, c1], 'deck', 'site');
      else g.solid([c0, y - 0.25, lo], [c1, y, hi + 0.05], 'deck', 'site');
    }
    const ramp = f.axis === 'x'
      ? { x0: Math.min(f.from, f.to), z0: c0, x1: Math.max(f.from, f.to), z1: c1 }
      : { x0: c0, z0: Math.min(f.from, f.to), x1: c1, z1: Math.max(f.from, f.to) };
    col.ramp(ramp.x0, ramp.z0, ramp.x1, ramp.z1, f.axis, f.from, f.to, f.y0, f.y1);
    // sloped steel stringers + rails on both sides, supports down to grade
    for (const c of [c0, c1]) {
      const A: V3 = f.axis === 'x' ? [f.from, f.y0, c] : [c, f.y0, f.from];
      const B: V3 = f.axis === 'x' ? [f.to, f.y1, c] : [c, f.y1, f.to];
      g.beam([A[0], A[1] - 0.6, A[2]], [B[0], B[1] - 0.6, B[2]], 0.25, 1, 'steel', 'site');
      g.beam([A[0], A[1] + 3.4, A[2]], [B[0], B[1] + 3.4, B[2]], 0.3, 0.15, 'walnut', 'site');
      for (let k = 0; k <= 4; k++) {
        const t = k / 4, x = A[0] + (B[0] - A[0]) * t, y = A[1] + (B[1] - A[1]) * t, z = A[2] + (B[2] - A[2]) * t;
        g.solid([x - 0.06, y, z - 0.06], [x + 0.06, y + 3.4, z + 0.06], 'steel', 'site');
        const gy = groundAt(x, z);
        if (y - gy > 0.5) g.solid([x - 0.17, gy, z - 0.17], [x + 0.17, y - 0.6, z + 0.17], 'steel', 'site');
      }
      // rail collision, chopped into short boxes following the slope
      const segs = Math.ceil(run / 1);
      for (let k = 0; k < segs; k++) {
        const ta = k / segs, tb = (k + 1) / segs;
        const xa = A[0] + (B[0] - A[0]) * ta, xb = A[0] + (B[0] - A[0]) * tb, za = A[2] + (B[2] - A[2]) * ta, zb = A[2] + (B[2] - A[2]) * tb;
        const ya = Math.min(A[1] + (B[1] - A[1]) * ta, A[1] + (B[1] - A[1]) * tb);
        col.box([Math.min(xa, xb) - 0.15, ya - 1, Math.min(za, zb) - 0.15], [Math.max(xa, xb) + 0.15, ya + 4, Math.max(za, zb) + 0.15]);
      }
    }
  }
  for (const l of s.bluffStairs.landings) {
    const [x0, z0, x1, z1] = l.rect;
    g.solid([x0, l.y - 0.3, z0], [x1, l.y, z1], 'deck', 'site');
    col.floor(x0, z0, x1, z1, l.y);
    const gy = groundAt((x0 + x1) / 2, (z0 + z1) / 2);
    g.solid([(x0 + x1) / 2 - 0.2, gy, (z0 + z1) / 2 - 0.2], [(x0 + x1) / 2 + 0.2, l.y - 0.3, (z0 + z1) / 2 + 0.2], 'steel', 'site');
  }
  // the turns between flights are guarded on their outer sides
  {
    const L1 = s.bluffStairs.landings[1];
    if (L1) { const [x0, z0, , z1] = L1.rect; railing(ctx, 'x', x0, z0, z1, L1.y, 'site'); railing(ctx, 'z', z0, x0, L1.rect[2], L1.y, 'site'); }
    const L0 = s.bluffStairs.landings[0];
    if (L0) { const [x0, z0, x1, z1] = L0.rect; railing(ctx, 'z', z0, x0, x1, L0.y, 'site'); railing(ctx, 'z', z1, x0, x1, L0.y, 'site'); }
  }

  // ---- dock ----
  const dy = s.dock.y;
  for (const [x0, z0, x1, z1] of s.dock.rects) {
    g.solid([x0, dy - 0.4, z0], [x1, dy, z1], 'deck', 'site');
    col.floor(x0, z0, x1, z1, dy);
  }
  {
    const [rx0, rx1] = s.dock.roof.x, [rz0, rz1] = s.dock.roof.z, ry = s.dock.roof.ridgeY;
    const zm = (rz0 + rz1) / 2, eaveY = dy + 10;
    for (const x of [rx0 + 0.5, (rx0 + rx1) / 2 + 3, rx1 - 0.5]) for (const z of [rz0 + 0.5, zm, rz1 - 0.5]) {
      if (x > -100 && x < -88.5 && z > rz0 + 6) continue; // boat slip stays clear
      g.solid([x - 0.4, s.lake.y - 6, z - 0.4], [x + 0.4, eaveY, z + 0.4], 'timber', 'site');
      if (z > rz0 + 1 || x > -100) col.box([x - 0.4, dy, z - 0.4], [x + 0.4, eaveY, z + 0.4]);
    }
    // gable roof running along x
    for (const dir of [-1, 1]) {
      const zE = zm + dir * ((rz1 - rz0) / 2 + 1.5);
      const a: V3 = [rx0 - 1, ry, zm], b: V3 = [rx1 + 1, ry, zm], c: V3 = [rx1 + 1, eaveY, zE], d: V3 = [rx0 - 1, eaveY, zE];
      if (dir > 0) { g.quad('site', 'roof', a, d, c, b); g.quad('site', 'soffit', a, b, c, d); }
      else { g.quad('site', 'roof', b, c, d, a); g.quad('site', 'soffit', b, a, d, c); }
    }
    railing(ctx, 'z', rz1, -88, rx1 + 0.5, dy, 'site');
    railing(ctx, 'x', rx1 + 0.5, rz0 + 6, rz1, dy, 'site');
  }
  // ---- lake ----
  {
    const y = s.lake.y;
    g.quad('site', 'lake', [-6000, y, 6000], [-40, y, 6000], [-40, y, -6000], [-6000, y, -6000], false);
  }
}
