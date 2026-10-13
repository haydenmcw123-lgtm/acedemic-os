import { expect, test } from '@playwright/test';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { openApp, PROOF, ROOT, saveDataUrl, type App } from './helpers';

declare global { interface Window { __app: App } }

/**
 * The ten fixed views from the spec, each at Noon / Golden / Night.
 * Every frame gets a health check: Inf/NaN pixels in the HDR buffer (what bloom turns into
 * "black squares") and clipped pixels (blown-out highlights). Frames are compared at 640×360
 * against the approved baselines in tests/baselines/stage3; UPDATE_BASELINES=1 (re)approves them.
 */
// [name, x, z, feet, yaw, pitch] — yaw 0 = north, π/2 = west toward the lake
export const VIEWS: [string, number, number, number, number, number][] = [
  ['01-front-entry-from-motor-court', 92, 11, 11, Math.PI / 2 - 0.12, 0.06],
  ['02-foyer-toward-great-room', 52, 4, 11, 2.75, -0.02],
  ['03-great-room-toward-lake', 22, 36, 11, Math.PI / 2, 0.08],
  ['04-kitchen-island-toward-lake', 36, 40, 11, Math.PI / 2 - 0.05, -0.02],
  ['05-primary-bedroom', 16, 18, 11, 0.86, -0.05],
  ['06-primary-bath', 36, 10, 11, 1.107, -0.1],
  ['07-study-through-bookcase-door', 13.5, 21.2, 22, 0.32, -0.04],
  ['08-loft-over-void', 33, 30, 22, Math.PI / 2 + 0.2, -0.25],
  ['09-game-room-at-walkout', 22, 46, 0, Math.PI / 2 - 0.15, -0.02],
  // the bluff is ~56 ft at ~50°, so from the dock only the top of the house clears the crest
  ['10-house-from-dock', -82, 85, -46.2, -1.12, 0.6],
];
export const HOURS: [string, number][] = [['noon', 12.5], ['golden', 17.75], ['night', 20.5]];

const OUT = path.join(PROOF, 'stage3', 'views');
const BASE = path.join(ROOT, 'tests', 'baselines', 'stage3');
const UPDATE = !!process.env.UPDATE_BASELINES;

test('ten fixed views at Noon, Golden and Night: no Inf/NaN, no blown-out frames', async ({ page }) => {
  test.setTimeout(1_800_000);
  const errors = await openApp(page);
  fs.mkdirSync(OUT, { recursive: true });
  const report: string[] = ['view,time,nanInfPixels,trueBlack%,clipped%,meanLum,exposure,sunEl,drawCalls,triangles,baselineDiff'];
  const rows: string[] = [];
  const problems: string[] = [];
  for (const [name, x, z, feet, yaw, pitch] of VIEWS) {
    const files: string[] = [];
    for (const [hn, h] of HOURS) {
      const r = await page.evaluate(([x, z, f, y, p, h]) => window.__app.photo(x, z, f, y, p, h, 1280, 720), [x, z, feet, yaw, pitch, h] as const);
      const png = path.join(OUT, `${name}-${hn}.png`);
      saveDataUrl(png, r.url);
      // proof frames are kept as JPEGs (a PNG of a grainy 1280×720 frame is ~1.7 MB)
      const file = png.replace(/\.png$/, '.jpg');
      execSync(`convert "${png}" -quality 88 "${file}"`);
      // baselines are stored and compared at 640×360: enough to catch a regression, small enough to commit
      const small = png.replace(/\.png$/, '.small.png');
      execSync(`convert "${png}" -resize 640x360 "${small}"`);
      fs.unlinkSync(png);
      files.push(file);
      let diff = '';
      const base = path.join(BASE, `${name}-${hn}.png`);
      if (UPDATE) { fs.mkdirSync(BASE, { recursive: true }); fs.copyFileSync(small, base); }
      else if (fs.existsSync(base)) {
        // mean absolute difference per channel, 0..255
        const out = execSync(`compare -metric MAE "${small}" "${base}" null: 2>&1 || true`).toString();
        const mae = parseFloat(out.split('(')[1] ?? '1') * 255;
        diff = mae.toFixed(2);
        if (mae > 6) problems.push(`${name} ${hn}: differs from the approved baseline (MAE ${diff})`);
      }
      fs.unlinkSync(small);
      report.push([name, hn, r.nanInf, (r.black * 100).toFixed(3), (r.clipped * 100).toFixed(2), r.meanLum.toFixed(3), r.exposure.toFixed(2), r.sunEl.toFixed(1), r.calls, r.tris, diff].join(','));
      // NaN/Inf in the HDR buffer is what bloom turns into black squares; true-black pixels are
      // reported but allowed (unlit black steel frames and a cold firebox at night are legitimately black)
      if (r.nanInf > 0) problems.push(`${name} ${hn}: ${r.nanInf} Inf/NaN pixels in the HDR buffer`);
      if (r.clipped > 0.03) problems.push(`${name} ${hn}: ${(r.clipped * 100).toFixed(1)}% clipped pixels (blown out)`);
    }
    const row = path.join(OUT, `_row-${name}.png`);
    execSync(`convert ${files.map((f) => `"${f}"`).join(' ')} -resize 640x360 +append "${row}"`);
    rows.push(row);
  }
  execSync(`convert ${rows.map((f) => `"${f}"`).join(' ')} -append -quality 88 "${path.join(PROOF, 'stage3', 'contact-sheet.jpg')}"`);
  for (const r of rows) fs.unlinkSync(r);
  fs.writeFileSync(path.join(PROOF, 'stage3', 'health.csv'), report.join('\n') + '\n');
  console.log(report.join('\n'));
  expect(errors).toEqual([]);
  expect(problems).toEqual([]);
});

test('tone mapping A/B: AgX vs ACES Filmic', async ({ page }) => {
  test.setTimeout(600_000);
  await openApp(page);
  const out = path.join(PROOF, 'stage3', 'tonemap-ab');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const pairs: string[] = [];
  for (const [name, x, z, feet, yaw, pitch] of [VIEWS[2], VIEWS[0]]) for (const [hn, h] of [HOURS[1], HOURS[2]]) {
    const files: string[] = [];
    for (const tm of ['agx', 'aces'] as const) {
      await page.evaluate((t) => window.__app.setToneMap(t), tm);
      const r = await page.evaluate(([x, z, f, y, p, h]) => window.__app.photo(x, z, f, y, p, h, 960, 540), [x, z, feet, yaw, pitch, h] as const);
      const f = path.join(out, `${name}-${hn}-${tm}.png`); saveDataUrl(f, r.url); files.push(f);
    }
    const pair = path.join(out, `_pair-${name}-${hn}.png`);
    execSync(`convert ${files.map((f) => `"${f}"`).join(' ')} -resize 640x360 +append "${pair}"`);
    pairs.push(pair);
  }
  execSync(`convert ${pairs.map((f) => `"${f}"`).join(' ')} -append -quality 88 "${path.join(PROOF, 'stage3', 'tonemap-agx-left-aces-right.jpg')}"`);
  fs.rmSync(out, { recursive: true, force: true }); // only the side-by-side sheet is kept
  await page.evaluate(() => window.__app.setToneMap('agx'));
});
