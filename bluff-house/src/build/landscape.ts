import type { HouseData, Rect } from '../data/types';

/**
 * Where nothing may grow: the house (all levels, plus a 12-ft clearing), decks, terrace and pool,
 * the entry walk, the drive and motor court, the bluff stairs and the dock — all from the JSON.
 */
export function siteBlocked(data: HouseData): (x: number, z: number) => boolean {
  const rects: [Rect, number][] = [];
  for (const r of data.rooms) for (const q of r.rects) rects.push([q, 12]);
  const s = data.site;
  for (const d of s.decks) rects.push([d.rect, 8]);
  rects.push([s.terrace.rect, 8], [s.pool.rect, 8], [s.entry.walk, 6], [s.entry.canopy, 6], [s.driveway.rect, 8]);
  const [w0, w1] = s.bluffStairs.width;
  for (const f of s.bluffStairs.flights) {
    const [a, b] = [Math.min(f.from, f.to), Math.max(f.from, f.to)];
    const cross = f.cross ?? [w0, w1];
    rects.push([f.axis === 'x' ? [a, cross[0], b, cross[1]] : [cross[0], a, cross[1], b], 6]);
  }
  for (const l of s.bluffStairs.landings) rects.push([l.rect, 6]);
  for (const r of s.dock.rects) rects.push([r, 8]);
  rects.push([[s.dock.roof.x[0], s.dock.roof.z[0], s.dock.roof.x[1], s.dock.roof.z[1]], 8]);
  return (x, z) => rects.some(([[x0, z0, x1, z1], m]) => x > x0 - m && x < x1 + m && z > z0 - m && z < z1 + m);
}
