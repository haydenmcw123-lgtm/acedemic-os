import type { BuildContext } from './context';
import type { GroupKey } from './geom';

type V3 = [number, number, number];

/** Frameless glass guard on a steel shoe with a walnut cap rail. Collides as a solid 0.5-ft slab. */
export function railing(ctx: BuildContext, axis: 'x' | 'z', at: number, s: number, e: number, y: number, group: GroupKey, h = 3.5) {
  const g = ctx.geo;
  const box = (t0: number, t1: number, y0: number, y1: number, half: number, mat: string, cast = true) => {
    const min: V3 = axis === 'x' ? [at - half, y0, t0] : [t0, y0, at - half];
    const max: V3 = axis === 'x' ? [at + half, y1, t1] : [t1, y1, at + half];
    g.solid(min, max, mat, group, cast);
  };
  box(s, e, y, y + 0.3, 0.12, 'steel');
  box(s, e, y + 0.3, y + h - 0.12, 0.03, 'glass', false);
  box(s - 0.05, e + 0.05, y + h - 0.12, y + h + 0.04, 0.16, 'walnut');
  const min: V3 = axis === 'x' ? [at - 0.25, y, s] : [s, y, at - 0.25];
  const max: V3 = axis === 'x' ? [at + 0.25, y + h + 0.2, e] : [e, y + h + 0.2, at + 0.25];
  ctx.col.transparent(() => ctx.col.box(min, max));
}

/** Vertical glass panel whose top follows a profile (used for the stair guards). Points are (t, yTop) along the run. */
export function glassGuardProfile(ctx: BuildContext, axis: 'x' | 'z', at: number, yBottom: number, profile: [number, number][], group: GroupKey, cap = true) {
  const g = ctx.geo;
  const half = 0.03;
  const P = (t: number, y: number, n: number): V3 => (axis === 'x' ? [at + n, y, t] : [t, y, at + n]);
  for (let i = 0; i < profile.length - 1; i++) {
    const [t0, y0] = profile[i], [t1, y1] = profile[i + 1];
    // two faces of the pane
    for (const n of [-half, half]) {
      const front = (n > 0) === (axis === 'x');
      const inset = cap ? 0.12 : 0;
      const q: V3[] = [P(t0, yBottom, n), P(t1, yBottom, n), P(t1, y1 - inset, n), P(t0, y0 - inset, n)];
      if (front) g.quad(group, 'glass', q[1], q[0], q[3], q[2], false); else g.quad(group, 'glass', q[0], q[1], q[2], q[3], false);
    }
    // walnut cap rail following the top
    if (cap) g.beam(P(t0, y0 - 0.04, 0), P(t1, y1 - 0.04, 0), 0.32, 0.16, 'walnut', group);
    // collision: a slab under the profile, split into short vertical boxes
    const n = Math.max(1, Math.ceil(Math.abs(t1 - t0) / 0.5));
    for (let k = 0; k < n; k++) {
      const a = t0 + (t1 - t0) * (k / n), b = t0 + (t1 - t0) * ((k + 1) / n);
      const yt = Math.max(y0 + (y1 - y0) * (k / n), y0 + (y1 - y0) * ((k + 1) / n)) + 0.1;
      const lo = Math.min(a, b), hi = Math.max(a, b);
      const min: V3 = axis === 'x' ? [at - 0.25, yBottom, lo] : [lo, yBottom, at - 0.25];
      const max: V3 = axis === 'x' ? [at + 0.25, yt, hi] : [hi, yt, at + 0.25];
      ctx.col.transparent(() => ctx.col.box(min, max));
    }
  }
}
