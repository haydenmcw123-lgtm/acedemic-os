import { CEIL_H, FLOOR_Y, house } from '../data/house';
import type { Opening } from '../data/types';
import type { Plan } from '../build/plan';

/** A recessed can in a ceiling. */
export interface Can { x: number; y: number; z: number; level: number }
/** A light cluster the interior light pool can sit on: one per room (two for big rooms). */
export interface LightPoint { x: number; y: number; z: number; level: number; room: string; lumens: number; radius: number }
/** A big exterior glazing rectangle that pours daylight in (for the RectAreaLight pool). */
export interface WindowLight { cx: number; cy: number; cz: number; nx: number; nz: number; w: number; h: number; level: number }

const SPACING = 6.5; // ft between cans

/** Cans on a grid in every room with a flat ceiling, and one or two light clusters per room. Everything from the JSON. */
export function fixtures(plan: Plan) {
  const cans: Can[] = [], points: LightPoint[] = [];
  for (const r of house.rooms) {
    if (r.void) continue;
    const L = r.level, cy = FLOOR_Y[L] + CEIL_H[L];
    let lumens = 0;
    for (const [x0, z0, x1, z1] of r.rects) {
      const w = x1 - x0, d = z1 - z0;
      if (!r.noCeil && r.id !== 'garage') {
        const nx = Math.max(1, Math.round(w / SPACING)), nz = Math.max(1, Math.round(d / SPACING));
        for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) cans.push({ x: x0 + (w * (i + 0.5)) / nx, y: cy - 0.06, z: z0 + (d * (j + 0.5)) / nz, level: L });
      }
      lumens += w * d * 35; // ≈ 35 lm/sq ft, a well-lit residential room
    }
    // clusters: big rooms (or tall open ones) get two, along their long axis
    const [x0, z0, x1, z1] = r.rects[0];
    const long = Math.max(x1 - x0, z1 - z0), alongX = x1 - x0 >= z1 - z0;
    const yL = r.noCeil ? FLOOR_Y[L] + 9 : cy - 2.2;
    const radius = Math.max(14, long * 0.9);
    const spots = long > 20 ? [0.27, 0.73] : [0.5];
    for (const f of spots) {
      const x = alongX ? x0 + (x1 - x0) * f : (x0 + x1) / 2, z = alongX ? (z0 + z1) / 2 : z0 + (z1 - z0) * f;
      points.push({ x, y: yL, z, level: L, room: r.id, lumens: lumens / spots.length, radius });
    }
  }
  return { cans, points, windows: windowLights(plan) };
}

/** Exterior glazing merged per wall run into big rectangles that face into the house. */
function windowLights(plan: Plan): WindowLight[] {
  const glaze = (o: Opening) => ['glass', 'window', 'fold', 'slide', 'glassdoor'].includes(o.kind);
  const out: WindowLight[] = [];
  const byLine = new Map<string, Opening[]>();
  for (const o of house.openings) if (glaze(o)) {
    const k = `${o.level}|${o.axis}|${o.at}`;
    (byLine.get(k) ?? byLine.set(k, []).get(k)!).push(o);
  }
  for (const list of byLine.values()) {
    list.sort((a, b) => a.from - b.from);
    let cur: { o: Opening; from: number; to: number; sill: number; head: number } | null = null;
    const flush = () => {
      if (!cur) return;
      const { o, from, to, sill, head } = cur;
      const w = to - from, h = head - sill;
      // which side is the room? probe a cell just inside on each side
      const mid = (from + to) / 2;
      const inside = (side: number) => {
        const [i, j] = o.axis === 'x' ? [Math.floor(o.at + (side > 0 ? 0.5 : -0.5)), Math.floor(mid)] : [Math.floor(mid), Math.floor(o.at + (side > 0 ? 0.5 : -0.5))];
        return plan.ownerAt(o.level, i, j) >= 0;
      };
      const a = inside(-1), b = inside(1);
      if (w * h >= 20 && a !== b) {
        const n = b ? 1 : -1; // normal points into the room
        const base = FLOOR_Y[o.level];
        out.push({
          cx: o.axis === 'x' ? o.at : mid, cz: o.axis === 'x' ? mid : o.at, cy: base + (sill + head) / 2,
          nx: o.axis === 'x' ? n : 0, nz: o.axis === 'x' ? 0 : n, w, h, level: o.level,
        });
      }
      cur = null;
    };
    for (const o of list) {
      const sill = o.sill ?? 0, head = o.head ?? 7.33;
      if (cur && o.from - cur.to < 1.6) { cur.to = o.to; cur.sill = Math.min(cur.sill, sill); cur.head = Math.max(cur.head, head); }
      else { flush(); cur = { o, from: o.from, to: o.to, sill, head }; }
    }
    flush();
  }
  return out;
}
