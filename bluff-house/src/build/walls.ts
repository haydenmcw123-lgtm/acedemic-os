import { FLOOR_Y, WALL_H, WALL_T } from '../data/house';
import type { Opening } from '../data/types';
import { faceGroup, type BuildContext } from './context';
import type { GroupKey } from './geom';
import { dressOpening } from './openings';
import type { WallRun } from './plan';
import { railing } from './rails';

const T2 = WALL_T / 2;

/** Material key for a wall face looking into owner `idx` (-1 = outdoors). */
export function wallMat(ctx: BuildContext, L: number, idx: number): string {
  if (idx < 0) return L === 0 ? 'stoneExt' : 'siding';
  const r = ctx.plan.rooms[idx];
  if (r.void) return 'plaster';
  return r.wall ?? 'plaster';
}

type EndKind = 'free' | 'corner' | 'collinear';

/** Decides how a run ends at point t: continue straight into a neighbor, meet a perpendicular wall, or stop free. */
function endKind(runs: WallRun[], r: WallRun, t: number): EndKind {
  for (const o of runs) {
    if (o === r || o.rail || o.level !== r.level) continue;
    if (o.axis === r.axis && o.at === r.at && (o.e === t || o.s === t)) return 'collinear';
  }
  for (const o of runs) {
    if (o === r || o.rail || o.level !== r.level) continue;
    if (o.axis !== r.axis && o.at === t && o.s <= r.at && o.e >= r.at) return 'corner';
  }
  return 'free';
}

export function buildWalls(ctx: BuildContext) {
  const runs = ctx.plan.runs;
  for (const r of runs) {
    if (r.rail) { railing(ctx, r.axis, r.at, r.s, r.e, FLOOR_Y[r.level], faceGroup(ctx, r.level, r.b >= 0 ? r.b : r.a)); continue; }
    buildRun(ctx, r, endKind(runs, r, r.s), endKind(runs, r, r.e));
  }
}

function buildRun(ctx: BuildContext, r: WallRun, startKind: EndKind, endKindV: EndKind) {
  const { level: L, axis, at, s, e, a, b } = r;
  const base = FLOOR_Y[L], top = base + WALL_H[L];
  const matA = wallMat(ctx, L, a), matB = wallMat(ctx, L, b);
  const gA = faceGroup(ctx, L, a), gB = faceGroup(ctx, L, b);
  const exterior = a < 0 || b < 0;
  // jambs and caps face into the opening: give them the interior side's finish
  const capMat = b >= 0 ? matB : matA, capG: GroupKey = b >= 0 ? gB : gA;
  const ext0 = startKind === 'collinear' ? 0 : T2, ext1 = endKindV === 'collinear' ? 0 : T2;
  const ops = ctx.data.openings
    .filter((o) => o.level === L && o.axis === axis && o.at === at && o.to > s && o.from < e)
    .sort((p, q) => p.from - q.from);

  // Wall pieces are boxes spanning [t0, t1] along the run and [y0, y1] vertically.
  const piece = (t0: number, t1: number, y0: number, y1: number, kind: 'full' | 'sill' | 'head') => {
    const tt0 = t0 === s ? t0 - ext0 : t0, tt1 = t1 === e ? t1 + ext1 : t1;
    if (tt1 - tt0 < 1e-4 || y1 - y0 < 1e-4) return;
    const faces = axis === 'x'
      ? { nx: matA, px: matB, py: kind === 'sill' ? 'sill' : null, ny: kind === 'head' ? capMat : null }
      : { nz: matA, pz: matB, py: kind === 'sill' ? 'sill' : null, ny: kind === 'head' ? capMat : null };
    const groups = axis === 'x' ? { nx: gA, px: gB, py: capG, ny: capG } : { nz: gA, pz: gB, py: capG, ny: capG };
    const min: [number, number, number] = axis === 'x' ? [at - T2, y0, tt0] : [tt0, y0, at - T2];
    const max: [number, number, number] = axis === 'x' ? [at + T2, y1, tt1] : [tt1, y1, at + T2];
    ctx.geo.box(min, max, faces, groups);
    ctx.col.box(min, max);
    ctx.wallPieces.push({ level: L, axis, at, s: tt0, e: tt1, y0, y1, exterior });
  };
  // Vertical end face of the wall at station t, spanning y0..y1, facing direction dir (+1 toward larger t).
  const cap = (t: number, y0: number, y1: number, dir: 1 | -1) => {
    if (y1 - y0 < 1e-4) return;
    if (axis === 'x') {
      const z = t;
      if (dir > 0) ctx.geo.quad(capG, capMat, [at - T2, y0, z], [at + T2, y0, z], [at + T2, y1, z], [at - T2, y1, z]);
      else ctx.geo.quad(capG, capMat, [at + T2, y0, z], [at - T2, y0, z], [at - T2, y1, z], [at + T2, y1, z]);
    } else {
      const x = t;
      if (dir > 0) ctx.geo.quad(capG, capMat, [x, y0, at + T2], [x, y0, at - T2], [x, y1, at - T2], [x, y1, at + T2]);
      else ctx.geo.quad(capG, capMat, [x, y0, at - T2], [x, y0, at + T2], [x, y1, at + T2], [x, y1, at - T2]);
    }
  };

  if (startKind === 'free') cap(s - ext0, base, top, -1);
  if (endKindV === 'free') cap(e + ext1, base, top, 1);

  let t = s;
  ops.forEach((o, i) => {
    const oa = Math.max(o.from, s), ob = Math.min(o.to, e);
    if (oa > t) piece(t, oa, base, top, 'full');
    if (o.kind !== 'fireplace') {
      const sill = o.sill ?? 0, head = Math.min(o.head ?? WALL_H[L], WALL_H[L]);
      if (sill > 0) piece(oa, ob, base, base + sill, 'sill');
      if (head < WALL_H[L]) piece(oa, ob, base + head, top, 'head');
      // jambs only where the opening meets a solid stretch of this wall
      const next = ops[i + 1];
      if (oa > t) cap(oa, base + sill, base + head, 1);
      if (ob < e && (!next || next.from > ob)) cap(ob, base + sill, base + head, -1);
      dressOpening(ctx, o as Opening, oa, ob, base, a, b);
    }
    t = Math.max(t, ob);
  });
  if (t < e) piece(t, e, base, top, 'full');
}
