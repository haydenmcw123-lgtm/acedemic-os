import { expect, test } from '@playwright/test';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { openApp, PROOF, saveDataUrl, type App } from './helpers';

declare global { interface Window { __app: App } }
const OUT = path.join(PROOF, 'stage5');

test('the bake is applied to every interior surface it was made for', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = await openApp(page);
  const i = await page.evaluate(() => window.__app.lightmapInfo());
  expect(i.ready).toBe(true);
  expect(i.problems).toEqual([]);
  expect(i.receivers).toBeGreaterThan(40);
  const m = JSON.parse(fs.readFileSync(path.join(path.dirname(OUT), '..', 'public', 'lightmaps', 'manifest.json'), 'utf8'));
  expect(m.times.map((t: { name: string }) => t.name)).toEqual(['morning', 'noon', 'golden']);
  expect(m.res).toBeGreaterThanOrEqual(2048);
  expect(errors).toEqual([]);
});

test('the three lightmaps blend with the clock; night is the noon bake × 0.05', async ({ page }) => {
  test.setTimeout(300_000);
  await openApp(page);
  const w = async (h: number) => { await page.evaluate((x) => window.__app.setTime(x), h); return (await page.evaluate(() => window.__app.lightmapInfo())).weights.slice(0, 3).map((v: number) => +v.toFixed(3)); };
  expect(await w(8)).toEqual([1, 0, 0]);
  expect(await w(12.5)).toEqual([0, 1, 0]);
  expect(await w(17.75)).toEqual([0, 0, 1]);
  expect(await w(10.25)).toEqual([0.5, 0.5, 0]);
  expect(await w(21)).toEqual([0, 0.05, 0]); // full night: only the noon bake × 0.05 (plus the electric lights)
});

test('a box-projected probe per major room; the room you are in drives reflections', async ({ page }) => {
  test.setTimeout(600_000);
  await openApp(page);
  const probes = (await page.evaluate(() => window.__app.lightmapInfo())).probes.map((p: { id: string }) => p.id);
  expect(probes).toEqual(['great', 'kitchen', 'primary', 'foyer', 'game', 'stair']);
  for (const [id, x, z, feet] of [['great', 13, 35, 11], ['kitchen', 34, 30, 11], ['primary', 10, 10, 11], ['foyer', 47, 11, 11], ['game', 12, 44, 0], [null, 25, 8, 22]] as const) {
    await page.evaluate(([x, z, f]) => window.__app.photo(x, z, f, 0, 0, 12.5, 320, 180), [x, z, feet] as const);
    const info = await page.evaluate(() => window.__app.lightmapInfo());
    expect(info.activeProbe).toBe(id); // Bedroom 2 (the last spot) has no probe: the stand-in stays
  }
});

test('before / after: baked GI + probes vs the Stage 4 real-time lighting', async ({ page }) => {
  test.setTimeout(1_200_000);
  await openApp(page);
  fs.mkdirSync(OUT, { recursive: true });
  const views: [string, number, number, number, number, number][] = [
    ['great-room', 22, 36, 11, Math.PI / 2, 0.02],
    ['kitchen', 42.6, 41, 11, Math.PI / 2 - 0.05, -0.06],
    ['primary-bedroom', 16, 18, 11, 0.86, -0.05],
  ];
  const sheets: string[] = [];
  for (const [name, x, z, f, yaw, pitch] of views) {
    const rows: string[] = [];
    for (const [hn, h] of [['noon', 12.5], ['golden', 17.75]] as const) {
      const files: string[] = [];
      for (const on of [false, true]) {
        await page.evaluate((v) => window.__app.bakedGI(v), on);
        const r = await page.evaluate(([x, z, f, y, p, h]) => window.__app.photo(x, z, f, y, p, h, 960, 540), [x, z, f, yaw, pitch, h] as const);
        expect(r.nanInf).toBe(0);
        const file = path.join(OUT, `_${name}-${hn}-${on ? 'after' : 'before'}.png`); saveDataUrl(file, r.url); files.push(file);
      }
      const row = path.join(OUT, `_${name}-${hn}.png`);
      execSync(`convert ${files.map((s) => `"${s}"`).join(' ')} +append "${row}"`); rows.push(row);
      for (const s of files) fs.unlinkSync(s);
    }
    const sheet = path.join(OUT, `before-after-${name}.jpg`);
    execSync(`convert ${rows.map((s) => `"${s}"`).join(' ')} -append -quality 88 "${sheet}"`);
    for (const s of rows) fs.unlinkSync(s);
    sheets.push(sheet);
  }
  execSync(`convert ${sheets.map((s) => `"${s}"`).join(' ')} -resize 1280x -append -quality 85 "${path.join(OUT, 'before-left-after-right.jpg')}"`);
  await page.evaluate(() => window.__app.bakedGI(true));
});
