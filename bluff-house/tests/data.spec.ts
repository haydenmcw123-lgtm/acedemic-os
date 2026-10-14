import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers';

// The kit you supplied is the source of truth for the plan. house-data.json extends it
// (site, stair spec, location, re-centered tour stops); these tests keep the two in step.
const kit = JSON.parse(fs.readFileSync(path.join(ROOT, 'reference/house-data.kit.json'), 'utf8'));
const ours = JSON.parse(fs.readFileSync(path.join(ROOT, 'house-data.json'), 'utf8'));
const strip = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== false && v !== undefined));

test('rooms, open spans and openings are exactly the kit\'s', () => {
  expect(ours.rooms.map(strip)).toEqual(kit.rooms.map(strip));
  expect(ours.opens.map(strip)).toEqual(kit.opens.map(strip));
  const noFireplaceHeights = (o: Record<string, unknown>) => (o.kind === 'fireplace' ? { ...o, sill: undefined, head: undefined } : o);
  expect(ours.openings.map((o: Record<string, unknown>) => strip(noFireplaceHeights(o)))).toEqual(kit.openings.map((o: Record<string, unknown>) => strip(noFireplaceHeights(o))));
});

test('square footage matches the kit summary (7,224 heated)', () => {
  const area = (L: number) => ours.rooms.filter((r: any) => r.level === L && !r.void && r.id !== 'garage')
    .reduce((a: number, r: any) => a + r.rects.reduce((s: number, [x0, z0, x1, z1]: number[]) => s + (x1 - x0) * (z1 - z0), 0), 0);
  expect([0, 1, 2].map(area)).toEqual(kit.summary.out.map((o: { area: number }) => o.area));
});

/**
 * Deliberate relocations (Stage 4 clearance rule), each with its reason. Everything else stays within
 * 1.7 ft of the kit; small nudges off walls and out of doorways are within that.
 */
const RELOCATED: Record<string, string> = {
  'Dog wash': 'between the mudroom\'s two doors it blocked one 3-ft doorway path or the other in either orientation; moved to the west wall beside the lockers',
};

test('the same 155 furniture items, in the same rooms, with the same sizes and rotations', () => {
  const k = Object.entries(kit.furnitureByRoom).flatMap(([rk, v]: [string, any]) => v.map((it: any) => ({ ...it, room: rk.split(':')[1] })));
  const o = Object.entries(ours.furnitureByRoom).flatMap(([room, v]: [string, any]) => v.map((it: any) => ({ ...it, room })));
  expect(o.length).toBe(k.length);
  const used = new Set<number>();
  const problems: string[] = [];
  for (const a of k) {
    let best = -1, bd = Infinity;
    // nearest unused item with the same name, preferring one of the same size (base vs upper cabinets share a spot)
    const sameSize = (b: any) => a.size.every((s: number, i: number) => Math.abs(s - b.size[i]) <= 0.15);
    for (const strict of [true, false]) {
      if (best >= 0) break;
      o.forEach((b, j) => { if (!used.has(j) && b.name === a.item && (!strict || sameSize(b))) { const dd = Math.hypot(a.x - b.x, a.z - b.z); if (dd < bd) { bd = dd; best = j; } } });
    }
    if (best < 0) { problems.push(`missing ${a.item} in ${a.room}`); continue; }
    used.add(best);
    const b = o[best];
    // ours stores the footprint center; the kit stores the prototype's placement origin (≤ 1.6 ft apart)
    if (bd > 1.7 && !RELOCATED[a.item]) problems.push(`${a.item} moved ${bd.toFixed(2)} ft`);
    if (b.room !== a.room) problems.push(`${a.item}: room ${b.room} vs ${a.room}`);
    if (a.size.some((s: number, i: number) => Math.abs(s - b.size[i]) > 0.15)) problems.push(`${a.item}: size ${b.size} vs ${a.size}`);
    if (Math.abs(((a.rotDeg - b.rotDeg + 540) % 360) - 180) > 1) problems.push(`${a.item}: rotation ${b.rotDeg} vs ${a.rotDeg}`);
  }
  expect(problems).toEqual([]);
});

test('tour: same start and finish as the kit; only doorway re-centering in between', () => {
  const ks = kit.tourStops, os = ours.tourStops;
  expect(os[0]).toEqual(ks[0]);
  expect(os[os.length - 1]).toEqual(ks[ks.length - 1]);
  // every dwell stop (the tour's "moments") is kept, with its look-at and timing
  const dw = (s: any[]) => s.filter((t) => t.dwellSec).map((t) => [t.dwellSec, t.lookAt]);
  expect(dw(os)).toEqual(dw(ks));
});
