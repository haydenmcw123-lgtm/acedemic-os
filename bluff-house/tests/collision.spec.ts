import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { openApp, ROOT, type App } from './helpers';

declare global { interface Window { __app: App } }

// yaw convention: 0 faces north (-z), π/2 west (-x), π south (+z), -π/2 east (+x)
const N = 0, W = Math.PI / 2, E = -Math.PI / 2;

const app = <T>(page: Page, fn: (a: App, arg: any) => T, arg?: unknown) => page.evaluate(([f, a]) => new Function('app', 'arg', `return (${f})(app, arg)`)(window.__app, a) as T, [fn.toString(), arg] as const);

let page: Page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  const errors = await openApp(page);
  expect(errors).toEqual([]);
});
test.afterAll(async () => { await page.close(); });

test('every full-height wall piece blocks the capsule along its whole length', async () => {
  const res = await app(page, (a) => {
    const FL = [0, 11, 22];
    let tested = 0; const misses: string[] = [];
    for (const p of a.wallPieces) {
      const f = FL[p.level];
      if (p.y0 > f + 1 || p.y1 < f + 5.5) continue; // sills and heads are short pieces
      for (let t = p.s + 0.25; t <= p.e - 0.25 + 1e-6; t += 0.5) {
        const [x, z] = p.axis === 'x' ? [p.at, t] : [t, p.at];
        tested++;
        if (!a.overlaps(x, z, f)) misses.push(`L${p.level} ${p.axis}=${p.at} t=${t.toFixed(2)}`);
      }
    }
    return { tested, misses: misses.slice(0, 20), missCount: misses.length };
  });
  console.log(`wall samples tested: ${res.tested}, not blocking: ${res.missCount}`);
  expect(res.missCount, res.misses.join('\n')).toBe(0);
  expect(res.tested).toBeGreaterThan(500);
});

test('walking into walls and glass is blocked', async () => {
  const cases = [
    { name: 'foyer → north exterior wall', at: [47, 8, 11], yaw: N, check: (s: any) => s.z >= 1.2 },
    { name: 'primary bedroom → west fixed glass', at: [8, 4, 11], yaw: W, check: (s: any) => s.x >= 1.1 },
    { name: 'primary bedroom → open slider → deck rail', at: [8, 11.5, 11], yaw: W, check: (s: any) => s.x >= -12.8 && s.x < -10 },
    { name: 'kitchen → stair-hall wall', at: [49, 42, 11], yaw: N, check: (s: any) => s.z >= 37.2 },
    { name: 'garage → east garage doors', at: [70, 60, 11], yaw: E, check: (s: any) => s.x <= 80.8 },
    { name: 'gym → west glass', at: [8, 25, 0], yaw: W, check: (s: any) => s.x >= 1.1 },
    { name: 'bedroom 3 → north wall', at: [49, 8, 22], yaw: N, check: (s: any) => s.z >= 1.2 },
  ];
  for (const c of cases) {
    const r = await app(page, (a, c) => { a.teleport(c.at[0], c.at[1], c.at[2], c.yaw); return a.walk({ forward: 1, sprint: true }, 6); }, { at: c.at, yaw: c.yaw });
    console.log(`${c.name}: stopped at (${r.x.toFixed(2)}, ${r.z.toFixed(2)}) feet ${r.feet.toFixed(2)}, overlaps ${r.overlaps}`);
    expect(c.check(r), c.name).toBe(true);
    expect(r.overlaps, c.name).toBe(0);
  }
});

test('up and down every flight of stairs', async () => {
  const up = [[54, 23.2], [54, 31.4], [54, 34], [51, 34], [43.4, 34]];
  const down = [[51, 34], [54, 34], [54, 31.4], [54, 24.2], [54, 23]];
  const res = await app(page, (a, { up, down }) => {
    const out: { leg: string; feet: number; level: number; overlaps: number; reached: boolean }[] = [];
    a.teleport(47, 27, 0);
    const go = (pts: number[][], leg: string) => {
      let ov = 0, reached = true;
      for (const [x, z] of pts) { const r = a.walkTo(x, z, 20, 0.5); ov += r.overlaps; reached = reached && r.reached; }
      const s = a.state(); out.push({ leg, feet: s.feet, level: s.level, overlaps: ov, reached });
    };
    go(up, 'L0 → L1'); a.walkTo(47, 28, 10); go(up, 'L1 → L2');
    a.walkTo(43.4, 34, 10); go(down, 'L2 → L1'); a.walkTo(47, 28, 10); a.walkTo(43.4, 34, 10); go(down.slice(), 'L1 → L0');
    return out;
  }, { up, down });
  for (const r of res) console.log(`${r.leg}: feet ${r.feet.toFixed(2)}, level ${r.level}, reached ${r.reached}, overlaps ${r.overlaps}`);
  expect(res.map((r) => Math.round(r.feet))).toEqual([11, 22, 11, 0]);
  expect(res.every((r) => r.reached && r.overlaps === 0)).toBe(true);
});

test('the great-room void rail and loft rail on the upper level stop you', async () => {
  const r1 = await app(page, (a) => { a.teleport(13, 19.6, 22, Math.PI); return a.walk({ forward: 1 }, 5); });
  expect(r1.z).toBeLessThanOrEqual(20.8);
  expect(r1.feet).toBeCloseTo(22, 1);
  const r2 = await app(page, (a) => { a.teleport(32, 30, 22, Math.PI / 2); return a.walk({ forward: 1 }, 5); });
  expect(r2.x).toBeGreaterThanOrEqual(27.2);
  expect(r2.feet).toBeCloseTo(22, 1);
});

test('the pool and the deck edges stop you', async () => {
  const pool = await app(page, (a) => { a.teleport(-19, 58, 0, 0); return a.walk({ forward: 1 }, 6); });
  console.log(`pool: stopped at z ${pool.z.toFixed(2)}, min feet ${pool.minFeet.toFixed(2)}`);
  expect(pool.z).toBeGreaterThan(51.5);
  expect(pool.minFeet).toBeGreaterThan(-0.2);
  const deck = await app(page, (a) => { a.teleport(-8, 35, 11, Math.PI / 2); return a.walk({ forward: 1, sprint: true }, 5); });
  expect(deck.x).toBeGreaterThanOrEqual(-14.8);
  expect(deck.minFeet).toBeCloseTo(11, 1);
  const pdeck = await app(page, (a) => { a.teleport(-7, 10, 11, 0); return a.walk({ forward: 1, sprint: true }, 5); });
  expect(pdeck.z).toBeGreaterThanOrEqual(1.2);
  // no railing on the terrace side of the bluff crest, but the >1 ft drop still stops you
  const bluff = await app(page, (a) => { a.teleport(-30, 60, 0, Math.PI / 2); return a.walk({ forward: 1, sprint: true }, 8); });
  console.log(`bluff crest: stopped at x ${bluff.x.toFixed(2)}, min feet ${bluff.minFeet.toFixed(2)}`);
  expect(bluff.x).toBeGreaterThan(-40);
  expect(bluff.minFeet).toBeGreaterThan(-1.1);
});

test('the bluff stairs lead all the way down to the dock', async () => {
  const r = await app(page, (a) => {
    a.teleport(-28, 64, 0);
    let ov = 0;
    const path = [[-33, 64], [-56, 64], [-58, 64], [-80, 64], [-82, 64.5], [-82, 67], [-82, 85], [-84, 90], [-84.6, 100]];
    const legs = path.map(([x, z]) => { const s = a.walkTo(x, z, 40, 0.6); ov += s.overlaps; return s.reached; });
    return { ...a.state(), legs, ov };
  });
  console.log(`dock: (${r.x.toFixed(1)}, ${r.z.toFixed(1)}) feet ${r.feet.toFixed(2)} legs ${r.legs}`);
  expect(r.legs.every(Boolean)).toBe(true);
  expect(r.feet).toBeCloseTo(-46.5, 1);
  expect(r.ov).toBe(0);
});

test('doors are passable: narrowest pocket door, front pivot doors, bookcase door', async () => {
  const powder = await app(page, (a) => { a.teleport(14, 58.25, 11); return a.walkTo(21.5, 58.25, 10, 0.4); });
  expect(powder.reached).toBe(true); expect(powder.room).toBe('powder');
  const front = await app(page, (a) => { a.teleport(66, 11, 11); return a.walkTo(48, 11, 15, 0.5); });
  expect(front.reached).toBe(true); expect(front.room).toBe('foyer'); expect(front.overlaps).toBe(0);
  const study = await app(page, (a) => { a.teleport(10.3, 20, 22); return a.walkTo(10.3, 12, 15, 0.5); });
  console.log(`bookcase door: reached ${study.reached} at (${study.x.toFixed(2)}, ${study.z.toFixed(2)}) room ${study.room}`);
  expect(study.reached).toBe(true); expect(study.room).toBe('office'); expect(study.overlaps).toBe(0);
});

test('every room has solid floor under its center', async () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'house-data.json'), 'utf8'));
  const FL = [0, 11, 22];
  const probes = data.rooms.filter((r: any) => !r.void).map((r: any) => {
    const [x0, z0, x1, z1] = r.rects[0];
    const [x, z] = r.stair ? [47, 27] : [(x0 + x1) / 2, (z0 + z1) / 2];
    return { id: r.id, x, z, f: FL[r.level] };
  });
  const bad = await app(page, (a, probes) => probes.filter((p: any) => { const g = a.groundAt(p.x, p.z, p.f + 0.1); return g === null || Math.abs(g - p.f) > 0.01; }).map((p: any) => p.id), probes);
  expect(bad).toEqual([]);
});

test('level culling hides interiors two floors away, but never outdoors', async () => {
  const at = (x: number, z: number, f: number) => app(page, (a, p) => { a.teleport(p[0], p[1], p[2]); return a.culling(); }, [x, z, f]);
  const up = await at(28, 19.6, 22), mid = await at(13, 33, 11), low = await at(21, 23, 0), out = await at(-19, 60, 0);
  expect(up.visible).toMatchObject({ L0i: false, L1i: true, L2i: true });
  expect(mid.visible).toMatchObject({ L0i: true, L1i: true, L2i: true });
  expect(low.visible).toMatchObject({ L0i: true, L1i: true, L2i: false });
  expect(out.inside).toBe(false);
  expect(out.visible).toMatchObject({ L0i: true, L1i: true, L2i: true });
});
