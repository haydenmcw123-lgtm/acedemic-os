import { expect, test } from '@playwright/test';
import path from 'node:path';
import { openApp, PROOF, type App } from './helpers';

declare global { interface Window { __app: App } }

const OUT = path.join(PROOF, 'stage2');
test.use({ viewport: { width: 1600, height: 900 } });

test('sun follows NOAA for Oct 15 at Lake Lure', async ({ page }) => {
  await openApp(page);
  const r = await page.evaluate(() => [8, 12.5, 17.75, 18.75, 20.5].map((h) => window.__app.setTime(h)));
  console.log(r.map((s: any) => `az ${s.azimuth.toFixed(1)} el ${s.elevation.toFixed(1)}`).join(' | '));
  expect(r[1].azimuth).toBeGreaterThan(150); expect(r[1].azimuth).toBeLessThan(180); // early afternoon: south
  expect(r[2].azimuth).toBeGreaterThan(240); expect(r[2].azimuth).toBeLessThan(260); // golden hour: WSW, over the lake
  expect(r[3].elevation).toBeGreaterThan(0); expect(r[3].elevation).toBeLessThan(3); // 6:45 PM just above the horizon
  expect(r[4].elevation).toBeLessThan(-10); // 8:30 PM: night
});

test('room-size labels show rooms in view and hide rooms behind walls', async ({ page }) => {
  await openApp(page);
  const east = await page.evaluate(() => window.__app.labelsShown(13, 35, 11, -Math.PI / 2));
  const north = await page.evaluate(() => window.__app.labelsShown(13, 35, 11, 0));
  console.log('great room facing east:', east, '| facing north:', north);
  expect(east).toContain('kitchen');
  expect(north).not.toContain('primary'); // the primary suite is behind the great-room wall
  expect(east.every((id: string) => !['office', 'bed2', 'bed5', 'gym'].includes(id))).toBe(true); // other levels never show
  // proof shot: from the kitchen looking across to the great room and dining room
  const shown = await page.evaluate(() => window.__app.labelsShown(44, 41, 11, Math.PI * 0.6));
  console.log('kitchen facing west-southwest:', shown);
  await page.evaluate(() => window.__app.shot(1600, 900));
  await page.screenshot({ path: path.join(OUT, 'room-sizes-from-kitchen.png') });
});

test('measuring gives feet and inches that match the geometry', async ({ page }) => {
  await openApp(page);
  // facing the great room's north wall (z = 22.25 face) from x = 13, z = 35: the two picks land on that plane
  const m = await page.evaluate(() => {
    const a = window.__app;
    a.pauseTour(); a.teleport(13, 35, 11, 0); a.run(0.05);
    return a.measureBetween([-0.45, 0], [-0.1, 0]); // both picks on solid wall, west of the bedroom door
  });
  console.log(m);
  expect(m).not.toBeNull();
  expect(Math.abs(m.a[2] - 22.25)).toBeLessThan(0.05);
  expect(Math.abs(m.b[2] - 22.25)).toBeLessThan(0.05);
  expect(Math.abs(m.ft - Math.abs(m.b[0] - m.a[0]))).toBeLessThan(0.01);
  expect(m.text).toMatch(/^\d+′ \d+″$/);
  await page.evaluate(() => window.__app.shot(1600, 900));
  await page.screenshot({ path: path.join(OUT, 'measure-great-room.png') });
});

test('UI: dock, caption and tour framing at a dwell stop', async ({ page }) => {
  await openApp(page);
  // run the tour to the great room's lake-view dwell and grab the screen with the UI on top
  await page.evaluate(() => { const a = window.__app; a.holdCaption(); a.runToStop(21, 31, 2); });
  await page.evaluate(() => window.__app.shot(1600, 900));
  await page.waitForTimeout(800); // caption fade-in
  await page.screenshot({ path: path.join(OUT, 'tour-great-room-dwell.png') });
  await expect(page.locator('.dock')).toBeVisible();
  await expect(page.locator('#hud .name')).not.toHaveText('Bluff House');
  await page.evaluate(() => { const a = window.__app; a.runToStop(-84.6, 100.5, 3); });
  await page.evaluate(() => window.__app.shot(1600, 900));
  await page.screenshot({ path: path.join(OUT, 'tour-ends-on-lake-view.png') });
  await page.keyboard.press('KeyH');
  await expect(page.locator('.hint')).toBeVisible();
  await page.screenshot({ path: path.join(OUT, 'shortcut-card.png') });
});
