import raw from '../../house-data.json';
import type { HouseData, LevelIndex, Room } from './types';

export const house = raw as unknown as HouseData;

export const LEVELS = house.levels;
export const FLOOR_Y = LEVELS.map((l) => l.floorY);
export const CEIL_H = LEVELS.map((l) => l.ceiling);
export const WALL_H = LEVELS.map((l) => l.wallHeight);
export const WALL_T = house.wallThickness;

export const rectArea = ([x0, z0, x1, z1]: [number, number, number, number]) => (x1 - x0) * (z1 - z0);
export const roomArea = (r: Room) => r.rects.reduce((a, rc) => a + rectArea(rc), 0);

/** Heated area is every room with a floor, minus the garage. Computed from the data, never typed in. */
export function squareFootage(data: HouseData = house) {
  const byLevel = [0, 0, 0];
  let garage = 0;
  for (const r of data.rooms) {
    if (r.void) continue;
    if (r.id === 'garage') { garage += roomArea(r); continue; }
    byLevel[r.level] += roomArea(r);
  }
  return { byLevel, heated: byLevel[0] + byLevel[1] + byLevel[2], garage };
}

/** Structural checks so a bad edit to the JSON fails loudly instead of building a broken house. */
export function validateHouse(data: HouseData = house): string[] {
  const errs: string[] = [];
  const ids = new Set<string>();
  const cells = [new Map<string, string>(), new Map<string, string>(), new Map<string, string>()];
  for (const r of data.rooms) {
    if (ids.has(r.id)) errs.push(`duplicate room id ${r.id}`);
    ids.add(r.id);
    if (![0, 1, 2].includes(r.level)) errs.push(`${r.id}: bad level ${r.level}`);
    for (const [x0, z0, x1, z1] of r.rects) {
      if (!(x1 > x0 && z1 > z0)) errs.push(`${r.id}: degenerate rect`);
      if (![x0, z0, x1, z1].every(Number.isInteger)) errs.push(`${r.id}: rects must sit on the 1-ft grid`);
      for (let i = x0; i < x1; i++) for (let j = z0; j < z1; j++) {
        const k = i + ',' + j;
        const prev = cells[r.level].get(k);
        if (prev && prev !== r.id) { errs.push(`${r.id} overlaps ${prev} at ${k} (level ${r.level})`); i = x1; break; }
        cells[r.level].set(k, r.id);
      }
    }
  }
  for (const o of data.openings) {
    if (!(o.to > o.from)) errs.push(`opening at L${o.level} ${o.axis}=${o.at}: from >= to`);
    if ((o.head ?? 0) < (o.sill ?? 0)) errs.push(`opening at L${o.level} ${o.axis}=${o.at}: head below sill`);
  }
  for (const id of Object.keys(data.furnitureByRoom)) {
    if (id !== 'exterior' && !ids.has(id)) errs.push(`furnitureByRoom references unknown room ${id}`);
  }
  return errs;
}

export const levelOfFeet = (feet: number): LevelIndex => (feet < 5.6 ? 0 : feet < 16.6 ? 1 : 2);
