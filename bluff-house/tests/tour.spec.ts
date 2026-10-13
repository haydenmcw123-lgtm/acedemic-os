import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { openApp, PROOF, ROOT, type App } from './helpers';

declare global { interface Window { __app: App } }

const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'house-data.json'), 'utf8'));
const roomIds: string[] = data.rooms.filter((r: { void?: boolean }) => !r.void).map((r: { id: string }) => r.id);

test('the guided tour runs start to finish without touching a wall, rail or pane of glass', async ({ page }) => {
  const errors = await openApp(page);
  const r = await page.evaluate(() => window.__app.simTour(1 / 30));
  const minutes = r.seconds / 60;
  const visited = new Set<string>(r.visits);
  const missing = roomIds.filter((id) => !visited.has(id));
  const report = [
    `tour: ${r.length.toFixed(0)} ft in ${minutes.toFixed(2)} min (fixed 1/30 s step), completed: ${r.done}`,
    `capsule overlaps with walls/rails/glass: ${r.overlapSteps} steps`,
    `largest camera move per step: ${r.maxJump.toFixed(3)} ft; largest turn per step: ${r.maxYawStep.toFixed(3)} rad`,
    `rooms visited: ${roomIds.length - missing.length}/${roomIds.length}${missing.length ? ' — missing ' + missing.join(', ') : ''}`,
    `visit order: ${r.visits.join(' → ')}`,
  ].join('\n');
  console.log(report);
  fs.mkdirSync(path.join(PROOF, 'stage2'), { recursive: true });
  fs.writeFileSync(path.join(PROOF, 'stage2', 'tour-report.txt'), report + '\n');

  expect(errors).toEqual([]);
  expect(r.done).toBe(true);
  expect(r.overlapSteps, r.hits.join('\n')).toBe(0);
  expect(missing).toEqual([]);
  // after every room on all three levels: terrace, bluff stairs, then the dock
  expect(r.visits.slice(-3)).toEqual(['terrace', 'bluff', 'dock']);
  expect(minutes).toBeGreaterThan(5);
  expect(minutes).toBeLessThan(7);
  // smooth: no teleports or whip-pans
  expect(r.maxJump).toBeLessThan(0.3);
  expect(r.maxYawStep).toBeLessThan(0.08);
});

test('Space hands the tour to free walk on the spot, R blends back onto the path', async ({ page }) => {
  await openApp(page);
  const r = await page.evaluate(() => {
    const a = window.__app;
    a.restartTour();
    a.run(40);
    const before = a.tourPose();
    a.pauseTour();
    const paused = a.tourPose();
    const walk = a.walk({ forward: 1, right: 0.4 }, 2); // wander off the path a little
    a.resumeTour();
    const blend = a.run(1.5);
    const after = a.tourPose();
    return { before, paused, walk, blend, after };
  });
  console.log(JSON.stringify(r));
  // pausing doesn't move the camera
  expect(Math.hypot(r.paused.x - r.before.x, r.paused.z - r.before.z)).toBeLessThan(1e-6);
  expect(r.paused.mode).toBe('walk');
  // resuming glides back (no jump bigger than walking pace allows) and the tour is running again
  expect(r.blend.maxJump).toBeLessThan(0.35);
  expect(r.after.mode).toBe('tour');
  expect(Math.abs(r.after.feet - r.before.feet)).toBeLessThan(0.5);
});
