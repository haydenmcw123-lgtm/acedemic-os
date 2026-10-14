import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { HouseData } from '../data/types';
import { material } from '../materials/library';
import type { LightPoint } from './fixtures';

/**
 * Outdoor lighting, all from the site data: step lights along the bluff stairs, lanterns on the dock,
 * sconces on the entry piers, infrared heaters under the covered deck and lights in the pool. The
 * visible fixtures are emissive (they bloom at night); a handful of light "clusters" join the
 * interior light pool so the nearest ones actually light the ground around you after dark.
 */
export function buildOutdoorLights(data: HouseData) {
  const s = data.site;
  const parts = new Map<string, THREE.BufferGeometry[]>();
  const add = (mat: string, g: THREE.BufferGeometry) => { (parts.get(mat) ?? parts.set(mat, []).get(mat)!).push(g); };
  const box = (mat: string, w: number, h: number, d: number, x: number, y: number, z: number) => add(mat, new THREE.BoxGeometry(w, h, d).translate(x, y, z));

  // bluff stairs: a low step light every ~5 ft on the uphill-side stringer of each flight
  const [w0, w1] = s.bluffStairs.width;
  for (const f of s.bluffStairs.flights) {
    const len = Math.abs(f.to - f.from), n = Math.max(2, Math.round(len / 5));
    const cross = f.cross ?? [w0, w1];
    for (let i = 0; i <= n; i++) {
      const t = i / n, a = f.from + (f.to - f.from) * t, y = f.y0 + (f.y1 - f.y0) * t + 0.9;
      const [x, z] = f.axis === 'x' ? [a, cross[0] + 0.15] : [cross[0] + 0.15, a];
      box('steel', 0.5, 0.3, 0.3, x, y, z);
      box('bulb', f.axis === 'x' ? 0.4 : 0.02, 0.12, f.axis === 'x' ? 0.02 : 0.4, f.axis === 'x' ? x : x + 0.16, y - 0.08, f.axis === 'x' ? z + 0.16 : z);
    }
  }
  // dock: lanterns on the four outer posts
  {
    const [x0, x1] = s.dock.roof.x, [z0, z1] = s.dock.roof.z, y = s.dock.y + 7.5;
    for (const [x, z] of [[x0 + 0.5, z0 + 0.5], [x1 - 0.5, z0 + 0.5], [x0 + 0.5, z1 - 0.5], [x1 - 0.5, z1 - 0.5]]) {
      box('bronze', 0.7, 1.0, 0.7, x + 0.6, y, z);
      box('opal', 0.5, 0.7, 0.5, x + 0.6, y, z);
    }
  }
  // entry: a sconce on each stone pier, facing the walk
  for (const [x, z] of s.entry.piers) { box('bronze', 0.3, 1.1, 0.5, x + 0.85, s.entry.y + 6.2, z); box('opal', 0.12, 0.8, 0.36, x + 1.02, s.entry.y + 6.2, z); }
  // covered deck: slim infrared heaters under the roof
  const deck = s.decks.find((d) => d.covered);
  if (deck) {
    const [x0, z0, x1, z1] = deck.rect, xm = (x0 + x1) / 2;
    for (let z = z0 + 5; z < z1 - 3; z += 8) { box('steel', 3.2, 0.35, 0.6, xm, deck.y + 9.3, z); box('heater', 2.9, 0.04, 0.4, xm, deck.y + 9.11, z); }
  }
  // pool: two underwater lights on the east wall
  {
    const [, pz0, px1, pz1] = s.pool.rect, zc = (pz0 + pz1) / 2;
    for (const dz of [-5, 5]) box('poolGlow', 0.05, 0.7, 0.7, px1 - 0.03, s.terrace.y - 1.6, zc + dz);
  }
  const group = new THREE.Group(); group.name = 'outdoor-lights';
  for (const [mat, list] of parts) {
    const m = new THREE.Mesh(mergeGeometries(list.map((g) => g.toNonIndexed()))!, material(mat, 'ext'));
    m.castShadow = false; m.name = 'outdoor-lights:' + mat;
    group.add(m);
  }

  // clusters for the shared light pool (they only light up after dark, like the interior)
  const lvl = (y: number) => (y < 5 ? 0 : y < 16 ? 1 : 2);
  const pts: LightPoint[] = [];
  const pt = (room: string, x: number, y: number, z: number, lumens: number, radius: number) => pts.push({ room, x, y, z, level: lvl(y), lumens, radius });
  const [ex0, ez0, ex1, ez1] = s.entry.canopy;
  pt('entry', (ex0 + ex1) / 2, s.entry.y + 8, (ez0 + ez1) / 2, 1400, 16);
  if (deck) pt('deck', (deck.rect[0] + deck.rect[2]) / 2, deck.y + 8.5, (deck.rect[1] + deck.rect[3]) / 2, 1800, 18);
  pt('terrace', (s.terrace.rect[0] + s.terrace.rect[2]) / 2, s.terrace.y + 7, (s.terrace.rect[1] + s.terrace.rect[3]) / 2, 1200, 22);
  for (const l of s.bluffStairs.landings) pt('bluff', (l.rect[0] + l.rect[2]) / 2, l.y + 3, (l.rect[1] + l.rect[3]) / 2, 350, 12);
  pt('dock', (s.dock.roof.x[0] + s.dock.roof.x[1]) / 2, s.dock.y + 8, (s.dock.roof.z[0] + s.dock.roof.z[1]) / 2, 1600, 18);
  return { group, points: pts };
}
