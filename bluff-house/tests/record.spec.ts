import { test } from '@playwright/test';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { openApp, ROOT, saveDataUrl, type App } from './helpers';

declare global { interface Window { __app: App } }

/**
 * Records the guided tour as a video: the app is stepped with a fixed 1/FPS timestep (so the
 * film is perfectly smooth no matter how slow each software-rendered frame is), every frame is
 * read off the canvas with the room caption drawn on, and ffmpeg encodes the result.
 *
 *   RECORD=1 pnpm exec playwright test tests/record.spec.ts
 *
 * Env: HOUR (clock time, default 16.75), FPS (30), W×H (960×540: software rendering costs ~2 s a frame), START (frame to resume from),
 * FRAMES (dir for the frames), OUT (mp4 path), LIMIT (stop after this many frames, for a preview).
 * Frames already on disk are kept, so an interrupted run resumes where it stopped.
 */
const FPS = +(process.env.FPS ?? 30);
const W = +(process.env.W ?? 960), H = +(process.env.H ?? 540);
const HOUR = +(process.env.HOUR ?? 16.75);
const FRAMES = process.env.FRAMES ?? path.join(ROOT, 'video', 'frames');
const OUT = process.env.OUT ?? path.join(ROOT, 'video', 'bluff-house-tour.mp4');

test('record the guided tour', async ({ page }) => {
  test.skip(!process.env.RECORD, 'set RECORD=1 to record the tour video');
  test.setTimeout(24 * 3600_000);
  await page.setViewportSize({ width: W, height: H });
  await openApp(page);
  fs.mkdirSync(FRAMES, { recursive: true });
  const total = await page.evaluate(([w, h, hour]) => window.__app.filmBegin(w, h, hour), [W, H, HOUR] as const);
  const n = Math.min(Math.ceil(total.seconds * FPS), +(process.env.LIMIT ?? Infinity)); // LIMIT: short preview
  const start = +(process.env.START ?? fs.readdirSync(FRAMES).filter((f) => f.endsWith('.jpg')).length);
  console.log(`tour ${total.seconds.toFixed(1)} s → ${n} frames at ${FPS} fps, starting at ${start}`);
  // fast-forward (simulation only, no rendering) to the first frame still missing
  if (start > 0) await page.evaluate(([k, dt]) => window.__app.filmSkip(k, dt), [start, 1 / FPS] as const);
  const t0 = Date.now();
  let reused = 0;
  for (let i = start; i < n; i++) {
    const f = await page.evaluate((dt) => window.__app.filmFrame(dt), 1 / FPS);
    const file = path.join(FRAMES, `${String(i).padStart(5, '0')}.jpg`);
    if (f.same && i > 0) { fs.copyFileSync(path.join(FRAMES, `${String(i - 1).padStart(5, '0')}.jpg`), file); reused++; }
    else saveDataUrl(file, f.url);
    if (i % 150 === 0) {
      const per = (Date.now() - t0) / (i - start + 1);
      console.log(`frame ${i}/${n}  ${(per / 1000).toFixed(2)} s/frame (${reused} still frames reused)  ~${(((n - i) * per) / 60000).toFixed(0)} min left`);
    }
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  // 1 s fade in and 1.5 s fade out; yuv420p + faststart so it plays everywhere, including phones
  const dur = n / FPS;
  execSync(`ffmpeg -y -loglevel error -framerate ${FPS} -i "${FRAMES}/%05d.jpg" -vf "fade=in:st=0:d=1,fade=out:st=${(dur - 1.5).toFixed(2)}:d=1.5" -c:v libx264 -preset slow -crf 21 -pix_fmt yuv420p -movflags +faststart "${OUT}"`);
  console.log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB)`);
});
