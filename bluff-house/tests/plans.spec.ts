import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { openApp, PROOF, ROOT, saveDataUrl, type App } from './helpers';

declare global { interface Window { __app: App } }

const OUT = path.join(PROOF, 'stage1');

test('clay plan views of all three levels (roof hidden)', async ({ page }) => {
  const errors = await openApp(page);
  for (const L of [0, 1, 2]) {
    saveDataUrl(path.join(OUT, `plan-level${L}.png`), await page.evaluate((l) => window.__app.renderPlan(l), L));
    saveDataUrl(path.join(OUT, `aerial-level${L}.png`), await page.evaluate((l) => window.__app.renderAerial(l), L));
  }
  expect(errors).toEqual([]);
});

/**
 * Overlays each generated plan on the approved drawing (reference/plans/levelN.svg) at the
 * drawing's own viewBox and scores the fit. The walls are rendered once in pure magenta so
 * they can be isolated, then compared with the drawing's solid wall fills.
 */
for (const L of [0, 1, 2]) {
  test(`level ${L} plan lines up with reference/plans/level${L}.svg`, async ({ page }) => {
    await openApp(page);
    const svg = fs.readFileSync(path.join(ROOT, `reference/plans/level${L}.svg`), 'utf8');
    const vb = svg.match(/viewBox="([^"]+)"/)![1].split(/\s+/).map(Number) as [number, number, number, number];
    const plan = await page.evaluate(([l, v]) => window.__app.renderPlan(l, v), [L, vb] as const);
    const probe = await page.evaluate(([l, v]) => window.__app.renderPlan(l, v, 0xff00ff), [L, vb] as const);
    saveDataUrl(path.join(OUT, `plan-level${L}-at-drawing-scale.png`), plan);
    const svgUrl = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
    // only score inside the building's footprint on this level (skips the drawing's scale bar and north arrow)
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'house-data.json'), 'utf8'));
    let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
    for (const r of data.rooms) if (r.level === L) for (const [a, b, c, d] of r.rects) { bx0 = Math.min(bx0, a); bz0 = Math.min(bz0, b); bx1 = Math.max(bx1, c); bz1 = Math.max(bz1, d); }
    const box = [480 + 12 * (bx0 - 1) - vb[0], 168 + 12 * (bz0 - 1) - vb[1], 480 + 12 * (bx1 + 1) - vb[0], 168 + 12 * (bz1 + 1) - vb[1]];
    // the firebox is drawn as a filled symbol, not a wall: leave it out of the score
    const skip = data.openings.filter((o: { kind: string; level: number }) => o.kind === 'fireplace' && o.level === L)
      .map((o: { at: number; from: number; to: number }) => [480 + 12 * (o.at - 3) - vb[0], 168 + 12 * o.from - vb[1], 480 + 12 * (o.at + 3) - vb[0], 168 + 12 * o.to - vb[1]]);
    const result = await page.evaluate(async ([planUrl, probeUrl, refUrl, W, H, BB, SK]) => {
      const load = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
      const [a, m, b] = await Promise.all([load(planUrl), load(probeUrl), load(refUrl)]);
      const px = (img: HTMLImageElement) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.drawImage(img, 0, 0, W, H); return g.getImageData(0, 0, W, H).data; };
      const M = px(m), B = px(b);
      const wall = new Uint8Array(W * H), drawnDark = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) {
        const k = i * 4;
        wall[i] = M[k] > 180 && M[k + 1] < 90 && M[k + 2] > 180 ? 1 : 0;
        drawnDark[i] = B[k] < 70 && B[k + 1] < 70 && B[k + 2] < 70 ? 1 : 0;
      }
      // the drawing's solid walls: dark pixels whose whole 5x5 neighborhood is dark (drops text and hairlines)
      const drawnWall = new Uint8Array(W * H);
      for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
        let all = 1;
        for (let dy = -2; dy <= 2 && all; dy++) for (let dx = -2; dx <= 2; dx++) if (!drawnDark[(y + dy) * W + x + dx]) { all = 0; break; }
        const skipped = SK.some((r: number[]) => x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]);
        drawnWall[y * W + x] = all && !skipped && x >= BB[0] && x <= BB[2] && y >= BB[1] && y <= BB[3] ? 1 : 0;
      }
      const near = (arr: Uint8Array, x: number, y: number, r: number) => {
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H && arr[yy * W + xx]) return true;
        }
        return false;
      };
      let wallPx = 0, wallHit = 0, drawnPx = 0, drawnHit = 0;
      const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d')!;
      const out = g.createImageData(W, H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (wall[i]) { wallPx++; if (near(drawnDark, x, y, 1)) wallHit++; }
        if (drawnWall[i]) { drawnPx++; if (near(wall, x, y, 1)) drawnHit++; }
        let col = [251, 249, 245];
        if (wall[i] && drawnDark[i]) col = [20, 20, 20]; else if (wall[i]) col = [220, 40, 40]; else if (drawnDark[i]) col = [40, 90, 220];
        out.data[i * 4] = col[0]; out.data[i * 4 + 1] = col[1]; out.data[i * 4 + 2] = col[2]; out.data[i * 4 + 3] = 255;
      }
      g.putImageData(out, 0, 0);
      const diff = c.toDataURL('image/png');
      g.globalAlpha = 1; g.drawImage(a, 0, 0, W, H); g.globalAlpha = 0.5; g.drawImage(b, 0, 0, W, H);
      const blend = c.toDataURL('image/png');
      return { precision: wallHit / wallPx, recall: drawnHit / drawnPx, wallPx, drawnPx, diff, blend };
    }, [plan, probe, svgUrl, vb[2], vb[3], box, skip] as const);
    saveDataUrl(path.join(OUT, `overlay-level${L}-blend.png`), result.blend);
    saveDataUrl(path.join(OUT, `overlay-level${L}-diff.png`), result.diff);
    const line = `level ${L}: ${(result.precision * 100).toFixed(1)}% of generated wall pixels land on the drawing's walls (±1 px = ±1 in); ` +
      `${(result.recall * 100).toFixed(1)}% of the drawing's solid wall pixels are covered by generated walls`;
    console.log(line);
    fs.appendFileSync(path.join(OUT, 'alignment.txt'), line + '\n');
    expect(result.precision).toBeGreaterThan(0.97);
    expect(result.recall).toBeGreaterThan(0.9);
  });
}
