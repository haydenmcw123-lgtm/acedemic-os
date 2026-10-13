import { expect, test } from '@playwright/test';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { openApp, PROOF, saveDataUrl, type App } from './helpers';

declare global { interface Window { __app: App } }
const OUT = path.join(PROOF, 'stage4');

test('F toggles Furnished ↔ Empty with a 400 ms fade; built-ins stay', async ({ page }) => {
  test.setTimeout(600_000);
  const errors = await openApp(page);
  const s0 = await page.evaluate(() => window.__app.furnitureState());
  expect(s0.furnished).toBe(true);
  expect(s0.looseVisible).toBe(s0.looseMeshes);
  await page.evaluate(() => window.__app.setFurnished(false, true));
  await page.evaluate(() => window.__app.run(0.2));
  const mid = await page.evaluate(() => window.__app.furnitureState());
  expect(mid.fade).toBeGreaterThan(0.3); expect(mid.fade).toBeLessThan(0.7); // halfway through 400 ms
  expect(mid.opacity).toBeLessThan(1);
  await page.evaluate(() => window.__app.run(0.25));
  const empty = await page.evaluate(() => window.__app.furnitureState());
  expect(empty.fade).toBe(0);
  expect(empty.looseVisible).toBe(0);
  expect(empty.looseBlockersOn).toBe(0); // you can walk where the furniture was
  expect(empty.builtInBlockersOn).toBeGreaterThan(30); // cabinets, closets, islands stay solid
  // proof: the great room furnished and empty
  const shots: string[] = [];
  for (const on of [true, false]) {
    await page.evaluate((v) => window.__app.setFurnished(v), on);
    const r = await page.evaluate(() => window.__app.photo(22, 36, 11, Math.PI / 2, 0.02, 16.5, 960, 540));
    const f = path.join(OUT, `great-room-${on ? 'furnished' : 'empty'}.png`); saveDataUrl(f, r.url); shots.push(f);
  }
  execSync(`convert ${shots.map((s) => `"${s}"`).join(' ')} -resize 640x360 +append -quality 88 "${path.join(OUT, 'furnished-left-empty-right.jpg')}"`);
  for (const s of shots) fs.unlinkSync(s);
  expect(errors).toEqual([]);
});

test('clicking a sofa, bed, chair or rug cycles its finish', async ({ page }) => {
  test.setTimeout(600_000);
  await openApp(page);
  const info = await page.evaluate(() => window.__app.furnitureInfo());
  const find = (name: string, room: string) => info.items.find((i: { name: string; room: string }) => i.name === name && i.room === room).id as number;
  const sofa = find('Sectional', 'great'), bed = find('Bed', 'primary'), chair = find('Lounge chair', 'great'), rug = find('Rug', 'great');
  const cycle = (id: number) => page.evaluate((i) => window.__app.cycleItem(i), id);
  expect([await cycle(sofa), await cycle(sofa), await cycle(sofa)]).toEqual(['Leather', 'Bouclé', 'Linen']);
  expect([await cycle(bed), await cycle(bed), await cycle(bed)]).toEqual(['Leather', 'Bouclé', 'Linen']);
  expect([await cycle(chair), await cycle(chair), await cycle(chair)]).toEqual(['Bouclé', 'Linen', 'Leather']);
  expect([await cycle(rug), await cycle(rug), await cycle(rug)]).toEqual(['Flat-weave stripe', 'Kilim', 'Natural wool']);
  // proof: the sectional and rug in each of their three finishes
  const shots: string[] = [];
  for (let k = 0; k < 3; k++) {
    const r = await page.evaluate(() => window.__app.photo(20, 39.5, 11, 0.9, -0.28, 16.5, 960, 540));
    const f = path.join(OUT, `finish-${k}.png`); saveDataUrl(f, r.url); shots.push(f);
    await cycle(sofa); await cycle(rug);
  }
  execSync(`convert ${shots.map((s) => `"${s}"`).join(' ')} -resize 640x360 +append -quality 88 "${path.join(OUT, 'finishes-linen-leather-boucle.jpg')}"`);
  for (const s of shots) fs.unlinkSync(s);
});
