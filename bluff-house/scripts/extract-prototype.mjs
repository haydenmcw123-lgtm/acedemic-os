// Provenance script (superseded: the original kit's data is now in reference/house-data.kit.json).
// Builds house-data.json from reference/bluff-house-v3.html.
// Plan data (rooms, open spans, openings, tour) is parsed from the prototype source;
// furniture footprints are measured by running the prototype headless and reading
// each placed item's bounding box. Needs three r160 on disk (the prototype's CDN
// build): THREE160_DIR=/path/to/node_modules/three node scripts/extract-prototype.mjs
import fs from 'node:fs';
import path from 'node:path';
import pw from '@playwright/test';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC = path.join(ROOT, 'reference/bluff-house-v3.html');
const THREE_DIR = process.env.THREE160_DIR;
if (!THREE_DIR) throw new Error('Set THREE160_DIR to a three@0.160.0 package directory');
const src = fs.readFileSync(SRC, 'utf8');

function grab(re) {
  const m = src.match(re);
  if (!m) throw new Error('not found: ' + re);
  return m[1];
}
const roomsSrc = grab(/const ROOMS = (\[[\s\S]*?\n\]);/);
const opensSrc = grab(/const OPENS = (\[[\s\S]*?\n\])\.map/);
const openingsSrc = grab(/const OPENINGS = (\[[\s\S]*?\n\])\.map/);
const stopsSrc = grab(/const STOPS = (\[[\s\S]*?\n\]);/);
const metaSrc = grab(/const ROOM_META = (\{[^\n]*\});/);
const evalJs = (s, pre = '') => new Function(`${pre}; return (${s});`)();

const roomsRaw = evalJs(roomsSrc);
const rooms = roomsRaw.map((r) => {
  const o = { id: r.id, level: r.L, name: r.name, rects: r.r };
  for (const k of ['floor', 'wall', 'noCeil', 'void', 'stair', 'meta']) if (r[k] !== undefined) o[k] = r[k];
  return o;
});
const opens = evalJs(opensSrc).map(([level, axis, at, from, to, rail]) => ({ level, axis, at, from, to, ...(rail ? { rail: true } : {}) }));
const openings = evalJs(openingsSrc).map(([level, axis, at, from, to, kind, sill = 0, head = 7.33]) => {
  const o = { level, axis, at, from, to, kind };
  if (kind !== 'fireplace') { o.sill = sill; o.head = kind === 'door' ? 7.33 : head; }
  return o;
});
const stops = evalJs(stopsSrc, 'const W = (x, z, o = {}) => Object.assign({ x, z }, o)').map((s) => {
  const o = { x: s.x, z: s.z };
  if (s.d) o.dwellSec = s.d;
  if (s.look) o.lookAt = s.look;
  if (s.label) o.label = s.label;
  return o;
});
const outdoorMeta = evalJs(metaSrc);

// ---- run the prototype headless to measure furniture ----
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
await page.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', (route) => {
  const rel = route.request().url().split('three@0.160.0/')[1];
  route.fulfill({ path: path.join(THREE_DIR, rel), contentType: 'text/javascript' });
});
await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
await page.addInitScript(() => { window.__HOUSE_TEST = { noLoop: true, fixedDt: 1 / 30 }; });
page.on('pageerror', (e) => console.error('pageerror', e.message));
await page.goto('file://' + SRC);
await page.waitForFunction(() => window.__house && window.__house.ready, null, { timeout: 600000 });
const plan = await page.evaluate(() => window.__house.furnPlan());
await browser.close();

const BUILTIN = new Set(['Cabinetry', 'Island', 'Vanity', 'Closet system', 'Bookcase', 'Refrigerator', 'Range', 'Hood', 'Pantry wall',
  'Pantry cabinets', 'Lockers', 'Laundry', 'Wine racks', 'Back bar', 'Bar counter', 'Tub', 'Toilet', 'Shower glass', 'Dog wash',
  'Outdoor kitchen', 'Hot tub', 'Espresso machine', 'Hitting mat', 'TV', 'Media console']);
const FL = [0, 11, 22];
const r2 = (v) => Math.round(v * 100) / 100;
// An item belongs to the highest room at (x, z) whose floor is at or below its base
// (a range hood mounted 6 ft up in the kitchen is still in the kitchen).
function roomFor(x, z, y) {
  if (y >= -1 && y < 32) {
    for (const level of [2, 1, 0]) {
      if (FL[level] > y) continue;
      for (const r of rooms) if (r.level === level && !r.void && r.rects.some(([x0, z0, x1, z1]) => x >= x0 && x < x1 && z >= z0 && z < z1)) return { id: r.id, level };
    }
  }
  return { id: 'exterior', level: y < 5.6 ? 0 : y < 16.6 ? 1 : 2 };
}
const furnitureByRoom = {};
for (const it of plan) {
  const [bx0, by0, bz0, bx1, by1, bz1] = it.b;
  const lcx = (bx0 + bx1) / 2, lcz = (bz0 + bz1) / 2;
  const c = Math.cos(it.r), s = Math.sin(it.r);
  // three.js rotation about +y: x' = x c + z s, z' = -x s + z c
  const x = it.x + lcx * c + lcz * s, z = it.z - lcx * s + lcz * c;
  const baseY = it.y + by0;
  const { id, level } = roomFor(x, z, it.y + 0.01);
  const item = { name: it.n, x: r2(x), z: r2(z), rotDeg: r2((it.r * 180) / Math.PI), size: [r2(bx1 - bx0), r2(by1 - by0), r2(bz1 - bz0)] };
  if (Math.abs(baseY - FL[level]) > 0.05 || id === 'exterior') item.y = r2(baseY);
  if (BUILTIN.has(it.n)) item.builtIn = true;
  (furnitureByRoom[id] ||= []).push(item);
}

const data = {
  $schema: './src/data/house-data.schema.json',
  name: 'Bluff House',
  location: { name: 'Lake Lure, North Carolina', lat: 35.428, lon: -82.205, date: '2026-10-15', timeZone: 'America/New_York' },
  units: 'feet',
  axes: '+x east, -z north, +y up; lake to the west (x < 0)',
  levels: [
    { level: 0, name: 'Lower Level', floorY: 0, ceiling: 10, wallHeight: 11 },
    { level: 1, name: 'Main Level', floorY: 11, ceiling: 10, wallHeight: 11 },
    { level: 2, name: 'Upper Level', floorY: 22, ceiling: 9, wallHeight: 9 },
  ],
  wallThickness: 0.5,
  rooms,
  opens,
  openings,
  stair: { hall: [42, 22, 56, 36], flightA: { x0: 52, x1: 56, z0: 24, z1: 32 }, landing: [52, 32, 56, 36], flightB: { x0: 44, x1: 52, z0: 32, z1: 36 }, riserIn: 7.33, treadIn: 11 },
  outdoorAreas: outdoorMeta,
  furnitureByRoom,
  tourStops: stops,
};
fs.writeFileSync(path.join(ROOT, 'house-data.json'), JSON.stringify(data, null, 1) + '\n');
console.log('rooms', rooms.length, 'opens', opens.length, 'openings', openings.length, 'stops', stops.length, 'furniture', plan.length);
