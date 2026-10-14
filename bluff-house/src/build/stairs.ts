import { FLOOR_Y } from '../data/house';
import type { Rect } from '../data/types';
import type { BuildContext } from './context';
import { glassGuardProfile } from './rails';

/** Derived stair layout: exact riser math, flight extents and the open well per level. */
export interface StairLayout {
  risersPerFloor: number;
  riser: number; // ft
  tread: number; // ft
  perFlight: number; // risers per flight
  runA: { x0: number; x1: number; z0: number; z1: number }; // flight A climbs toward +z
  landing: Rect;
  runB: { x0: number; x1: number; z0: number; z1: number }; // flight B climbs toward -x
  well: Rect[];
  floorToFloor: number;
}

export function stairLayout(ctx: BuildContext): StairLayout {
  const s = ctx.data.stair;
  const f2f = FLOOR_Y[1] - FLOOR_Y[0];
  const risersPerFloor = Math.round((f2f * 12) / s.riserIn);
  const riser = f2f / risersPerFloor; // exact: the risers sum to the floor-to-floor height
  const tread = s.treadIn / 12;
  const perFlight = risersPerFloor / 2;
  if (!Number.isInteger(perFlight)) throw new Error(`stair: ${risersPerFloor} risers can't split into two equal flights`);
  const runLen = (perFlight - 1) * tread; // treads per flight = risers - 1 (the landing / floor is the last step)
  const A = s.flightA, B = s.flightB;
  const runA = { x0: A.x0, x1: A.x1, z0: A.z1 - runLen, z1: A.z1 };
  const runB = { x0: B.x1 - runLen, x1: B.x1, z0: B.z0, z1: B.z1 };
  if (runA.z0 < A.z0 - 1e-6 || runB.x0 < B.x0 - 1e-6) throw new Error('stair: flight does not fit its run');
  const well: Rect[] = [[runA.x0, runA.z0, runA.x1, runA.z1], s.landing, [runB.x0, runB.z0, runB.x1, runB.z1]];
  return { risersPerFloor, riser, tread, perFlight, runA, landing: s.landing, runB, well, floorToFloor: f2f };
}

/** Rectangle difference: pieces of r not covered by any of `holes`. */
export function subtractRects(r: Rect, holes: Rect[]): Rect[] {
  let pieces: Rect[] = [r];
  for (const h of holes) {
    const next: Rect[] = [];
    for (const [x0, z0, x1, z1] of pieces) {
      const [hx0, hz0, hx1, hz1] = h;
      if (hx1 <= x0 || hx0 >= x1 || hz1 <= z0 || hz0 >= z1) { next.push([x0, z0, x1, z1]); continue; }
      if (hz0 > z0) next.push([x0, z0, x1, hz0]);
      if (hz1 < z1) next.push([x0, hz1, x1, z1]);
      const mz0 = Math.max(z0, hz0), mz1 = Math.min(z1, hz1);
      if (hx0 > x0) next.push([x0, mz0, hx0, mz1]);
      if (hx1 < x1) next.push([hx1, mz0, x1, mz1]);
    }
    pieces = next;
  }
  return pieces.filter(([a, b, c, d]) => c - a > 1e-4 && d - b > 1e-4);
}

/**
 * Switchback stair through all three levels: open-riser white oak treads on a steel
 * mono-stringer, glass guards with a walnut cap. Collision uses invisible ramps through
 * the flights so walking is smooth, not the treads.
 */
export function buildStairs(ctx: BuildContext, lay: StairLayout) {
  const { riser, tread, perFlight, runA, runB, landing } = lay;
  const g = ctx.geo, grp = 'stair' as const;
  const flightRise = perFlight * riser;
  const tTh = 0.15; // 1.75" tread
  for (let L = 0; L < 2; L++) {
    const base = FLOOR_Y[L];
    // flight A: climbs +z from runA.z0 to runA.z1
    for (let k = 1; k < perFlight; k++) {
      const top = base + k * riser;
      const z0 = runA.z0 + (k - 1) * tread;
      g.solid([runA.x0 + 0.3, top - tTh, z0 - 0.08], [runA.x1 - 0.3, top, z0 + tread], 'oak', grp);
    }
    // landing slab
    const ly = base + flightRise;
    g.box([landing[0] + 0.05, ly - 0.5, landing[1]], [landing[2] - 0.25, ly, landing[3] - 0.25], { px: 'oak', nx: 'oak', py: 'oak', ny: 'ceil', pz: 'oak', nz: 'oak' }, grp);
    // flight B: climbs -x from runB.x1 to runB.x0
    for (let k = 1; k < perFlight; k++) {
      const top = ly + k * riser;
      const x1 = runB.x1 - (k - 1) * tread;
      g.solid([x1 - tread, top - tTh, runB.z0 + 0.3], [x1 + 0.08, top, runB.z1 - 0.3], 'oak', grp);
    }
    // mono-stringers along the flight centerlines
    const cxA = (runA.x0 + runA.x1) / 2, czB = (runB.z0 + runB.z1) / 2;
    g.beam([cxA, base - 0.45, runA.z0], [cxA, ly - 0.45, runA.z1], 0.5, 0.7, 'steel', grp);
    g.beam([runB.x1, ly - 0.45, czB], [runB.x0, base + 2 * flightRise - 0.45, czB], 0.5, 0.7, 'steel', grp);

    // collision: ramps through the nosings plus the landing
    ctx.col.ramp(runA.x0, runA.z0, runA.x1, runA.z1, 'z', runA.z0, runA.z1, base, ly);
    ctx.col.floor(landing[0], landing[1], landing[2], landing[3], ly);
    ctx.col.ramp(runB.x0, runB.z0, runB.x1, runB.z1, 'x', runB.x1, runB.x0, ly, base + 2 * flightRise);
    ctx.stairRamps.push({ x0: runA.x0, z0: runA.z0, x1: runA.x1, z1: runA.z1, axis: 'z', s0: runA.z0, s1: runA.z1, y0: base, y1: ly });
    ctx.stairRamps.push({ x0: runB.x0, z0: runB.z0, x1: runB.x1, z1: runB.z1, axis: 'x', s0: runB.x1, s1: runB.x0, y0: ly, y1: base + 2 * flightRise });
    // walnut handrails on the wall side, 34" above the nosing line
    g.beam([runA.x1 - 0.45, base + 2.85, runA.z0], [runA.x1 - 0.45, ly + 2.85, runA.z1], 0.18, 0.18, 'walnut', grp);
    g.beam([runB.x1, ly + 2.85, runB.z1 - 0.45], [runB.x0, base + 2 * flightRise + 2.85, runB.z1 - 0.45], 0.18, 0.18, 'walnut', grp);
  }

  // Glass guards along the open sides of the well, one continuous panel per edge from the
  // lowest floor to 42" above the top floor, so there is never a gap to fall through.
  // Beside the foot of flight A the treads are under a foot high, so the glass can start 1 ft into
  // the flight there (it keeps the turn onto the stair clear); on the top floor the well is open to
  // the full height, so that level's guard runs the whole length.
  const yTop = FLOOR_Y[2] + 3.5;
  glassGuardProfile(ctx, 'x', runA.x0, FLOOR_Y[0], [[runA.z0 + 1, FLOOR_Y[2]], [runA.z1, FLOOR_Y[2]]], grp, false);
  glassGuardProfile(ctx, 'x', runA.x0, FLOOR_Y[2], [[runA.z0, yTop], [runA.z1, yTop]], grp);
  glassGuardProfile(ctx, 'z', runB.z0, FLOOR_Y[0], [[runB.x0, yTop], [runB.x1, yTop]], grp);
  // top level: guard across the head of flight A
  glassGuardProfile(ctx, 'z', runA.z0, FLOOR_Y[2], [[runA.x0, yTop], [runA.x1, yTop]], grp);
}
