import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { openApp, PROOF, type App } from './helpers';

declare global { interface Window { __app: App } }

/**
 * Staging clearance (spec §4 and §10), measured on the furniture as placed from the JSON:
 *  - every doorway has a clear 3-ft-wide path, 3 ft deep on both sides (a wide slider or garage
 *    door passes if any 3-ft window across it is clear);
 *  - no furniture bounding box intersects a wall;
 *  - art hangs no more than 0.2 ft off a solid wall and never over an opening;
 *  - nothing sits across the tour path: no furniture collider within 1 ft (the capsule radius)
 *    of the camera's path, so the tour never brushes a chair or a plant.
 */
test('furniture clears doorways, walls and the tour path; art hangs flush', async ({ page }) => {
  test.setTimeout(600_000);
  const errors = await openApp(page);
  const c = await page.evaluate(() => window.__app.clearance());
  // measure the path with furniture colliders off, so they can't push the camera clear and hide a conflict
  await page.evaluate(() => window.__app.setFurnished(false));
  const tour = await page.evaluate(() => window.__app.tourFurnitureConflicts(1.0));
  await page.evaluate(() => window.__app.setFurnished(true));
  const out = path.join(PROOF, 'stage4');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'clearance.txt'), [
    `${c.items} furniture items · ${c.doors} doorways · ${c.walls} wall pieces · ${c.art} pieces of art`,
    `doorway, wall and art problems: ${c.problems.length}`, ...c.problems.map((p: string) => '  ' + p),
    `furniture within 1 ft of the tour path: ${tour.length}`, ...tour.map((t: { name: string; room: string; gap: number; at: number[] }) => `  ${t.name} (${t.room}) ${t.gap} ft from the path at ${t.at}`),
  ].join('\n') + '\n');
  expect(errors).toEqual([]);
  expect(c.doors).toBeGreaterThan(20);
  expect(c.art).toBe(3);
  expect(c.problems).toEqual([]);
  expect(tour).toEqual([]);
});
