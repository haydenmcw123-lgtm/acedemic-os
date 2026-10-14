import { expect, test } from '@playwright/test';
import path from 'node:path';
import { openApp, PROOF, saveDataUrl, type App } from './helpers';

declare global { interface Window { __app: App } }

// [name, x, z, feet, yaw, pitch] — yaw 0 = north, π/2 = west (toward the lake)
const VIEWS: [string, number, number, number, number, number][] = [
  ['front-entry-from-motor-court', 92, 11, 11, Math.PI / 2 - 0.12, 0.02],
  ['foyer-toward-great-room', 50, 6, 11, Math.PI * 0.78, -0.05],
  ['great-room-toward-lake', 22, 36, 11, Math.PI / 2, 0.12],
  ['kitchen-island-toward-lake', 40, 44, 11, Math.PI / 2 - 0.25, -0.02],
  ['stair-hall-from-l1', 46, 25, 11, -Math.PI * 0.62, 0.15],
  ['study-through-bookcase-door', 11.5, 21.2, 22, 0.1, -0.08],
  ['loft-over-void', 33, 30, 22, Math.PI / 2 + 0.2, -0.25],
  ['game-room-at-walkout', 22, 46, 0, Math.PI / 2 - 0.15, -0.02],
  ['house-from-bluff-stairs', -82, 80, -43, -1.14, 0.36],
];

test('clay first-person views', async ({ page }) => {
  const errors = await openApp(page);
  for (const [name, x, z, feet, yaw, pitch] of VIEWS) {
    const url = await page.evaluate(([x, z, f, y, p]) => window.__app.renderView(x, z, f, y, p), [x, z, feet, yaw, pitch] as const);
    saveDataUrl(path.join(PROOF, 'stage1', 'views', `${name}.png`), url);
  }
  expect(errors).toEqual([]);
});
