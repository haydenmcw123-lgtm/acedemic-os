import { expect, test } from '@playwright/test';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { openApp, PROOF, ROOT, type App } from './helpers';

declare global { interface Window { __app: App } }
const OUT = path.join(PROOF, 'stage6');
const BUDGET = { callsInside: 250, callsOutside: 400, tris: 1_500_000, gpuMB: 350, downloadMB: 60, firstViewS: 6 };
/** `pnpm perf` sets this: the real-GPU run on your own machine (the other tests are skipped). */
const REAL = !!process.env.PERF_REAL;
const fill = (ms: number, seconds: number) => Array.from({ length: Math.round(seconds * 1000 / ms) }, () => ms);
const merge = (file: string, key: string, value: unknown) => {
  fs.mkdirSync(OUT, { recursive: true });
  const f = path.join(OUT, file);
  const j = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
  j[key] = value;
  fs.writeFileSync(f, JSON.stringify(j, null, 2));
};

test.describe(() => {
  test.skip(REAL, 'container tests');

test('adaptive quality: steps down under load, back up with headroom, never oscillates', async ({ page }) => {
  await openApp(page);
  // 1. sustained 30 ms frames: one tier every ~2 s, in order, down to the floor — then it stays there
  const heavy = await page.evaluate((s) => window.__app.adaptiveRun(s), fill(30, 20));
  expect(heavy.log.map((l: { to: number }) => l.to)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  for (let i = 1; i < heavy.log.length; i++) expect(heavy.log[i].t - heavy.log[i - 1].t).toBeGreaterThanOrEqual(1900);
  expect(heavy.applied).toEqual({ pixelRatio: 0.75, ao: false, aoSamples: 8, lake: false, shadow: 1024 });

  // 2. 15 ms is inside the 12–20 ms hysteresis band: a minute of it changes nothing
  const band = await page.evaluate((s) => window.__app.adaptiveRun(s, false), fill(15, 60));
  expect(band.log.length).toBe(heavy.log.length);

  // 3. fast frames (8 ms): up one tier per 10 s of headroom, not before
  const up = await page.evaluate((s) => window.__app.adaptiveRun(s, false), fill(8, 9.5));
  expect(up.tier).toBe(7);
  const up2 = await page.evaluate((s) => window.__app.adaptiveRun(s, false), fill(8, 19));
  expect(up2.tier).toBe(5);

  // 4. the oscillation trap: a vsync-locked 60 Hz display at tier 2 probes up to tier 1 after 10 s;
  //    tier 1 is too heavy (22 ms) → back to 2 and tier 1 is locked out: 2 more minutes, no change
  await page.evaluate((s) => window.__app.adaptiveRun(s), fill(30, 4.1)); // full → tier 2
  const probe = await page.evaluate((s) => window.__app.adaptiveRun(s, false), fill(16.7, 10.5));
  expect(probe.tier).toBe(1);
  const fail = await page.evaluate((s) => window.__app.adaptiveRun(s, false), fill(22, 2));
  expect(fail.tier).toBe(2);
  expect(fail.ceiling).toBe(2);
  const calm = await page.evaluate((s) => window.__app.adaptiveRun(s, false), [...fill(16.7, 60), ...fill(8, 60)]);
  expect(calm.tier).toBe(2);
  expect(calm.log.length).toBe(fail.log.length);

  // 5. a 1 s hitch (tab in the background) is not a frame: no reaction
  const gap = await page.evaluate((s) => window.__app.adaptiveRun(s), [...fill(16.7, 1), 1000, ...fill(16.7, 1)]);
  expect(gap.tier).toBe(0);
  merge('adaptive.json', 'heavy', heavy.log);
  merge('adaptive.json', 'probeThenLock', fail.log);
});

test('frame loop: no app allocations, no shader re-checks (heap sampling over 90 warmed-up frames)', async ({ page }) => {
  test.setTimeout(900_000);
  await openApp(page);
  // warm everything up first: the tour moving, the first lightmap blend, the first probe swaps
  await page.evaluate(() => window.__app.setTime(17.75));
  // the JIT first: a function runs interpreted (boxing every float result on the heap) until it has
  // been called a few hundred times; a real session gets there in seconds, so measure after that
  await page.evaluate(() => window.__app.runFrames(1500, 64, 36, true, 1 / 30, false));
  await page.evaluate(() => window.__app.runFrames(300, 64, 36, false));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.startSampling', { samplingInterval: 256, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  await page.evaluate(() => window.__app.runFrames(90, 64, 36, false));
  const { profile } = await cdp.send('HeapProfiler.stopSampling');
  // a sampled allocation is the app's when it happens in app source (src/…), or one call below it in
  // a builtin (map/filter/slice…) or a three.js math constructor (new Vector3, .clone()); anything
  // deeper inside a library (the renderer, the post chain) is that library's and reported apart
  type Node = { callFrame: { functionName: string; url: string; lineNumber: number }; selfSize: number; children: Node[] };
  const isApp = (n: Node) => /\/src\/(?!test-api)/.test(n.callFrame.url);
  const name = (n: Node) => `${n.callFrame.url.replace(/^.*\/(src|node_modules\/\.vite\/deps)\//, '$1/').replace(/\?.*$/, '')}:${n.callFrame.lineNumber + 1} ${n.callFrame.functionName || '(anon)'}`;
  const MATH = /^(Vector[234]|Matrix[34]|Quaternion|Color|Euler|Box3|Sphere|Ray|Plane|Frustum|clone)$/;
  const byFn: Record<string, number> = {}, lib: Record<string, number> = {};
  let total = 0;
  const walk = (n: Node, parent: Node | null) => {
    total += n.selfSize;
    if (n.selfSize) {
      const mine = isApp(n) ? n : parent && isApp(parent) && (!n.callFrame.url || MATH.test(n.callFrame.functionName)) ? parent : null;
      if (mine) byFn[name(mine)] = (byFn[name(mine)] ?? 0) + n.selfSize;
      else lib[name(n)] = (lib[name(n)] ?? 0) + n.selfSize;
    }
    for (const c of n.children) walk(c, n);
  };
  walk(profile.head as Node, null);
  const app = Object.entries(byFn).sort((a, b) => b[1] - a[1]);
  const appBytes = app.reduce((s, [, v]) => s + v, 0);
  merge('allocation.json', 'perFrame', { frames: 90, sampledBytesTotal: total, appBytes, appBytesPerFrame: Math.round(appBytes / 90), top: app.slice(0, 15), libraryTop: Object.entries(lib).sort((a, b) => b[1] - a[1]).slice(0, 12) });
  console.log(`app allocations: ${appBytes} B over 90 frames (${Math.round(appBytes / 90)} B/frame); all code incl. three/postprocessing: ${total} B`, app.slice(0, 10));
  // before Stage 6 this was 472 KB/frame; what is left is V8 boxing decimal numbers and the BVH's
  // ray-hit objects (the floor probe under the camera) — no app objects, arrays, strings or closures
  expect(appBytes / 90).toBeLessThan(2048);
  // and no shader-program re-checks per frame (two-pass transparent glass used to force ~40)
  const checks = await page.evaluate(() => window.__app.programChecks(4));
  merge('allocation.json', 'programChecksPerFrame', { all: checks.all, noLake: checks.noLake, noAO: checks.noAO });
  expect(checks.all).toBe(0);
});

test('shadows: the 16-bit shadow map renders like three.js\'s own, and the mirror pass never drops casters', async ({ page }) => {
  await openApp(page);
  const lum: Record<string, number> = {};
  // the study at noon: only the roof's shadow keeps the high sun off these walls
  for (const mode of ['three', 'ours16']) {
    await page.evaluate((m) => window.__app.shadowMode(m), mode);
    lum[mode] = (await page.evaluate(() => window.__app.photo(13.5, 21.2, 22, 0.32, -0.04, 12.5, 640, 360))).meanLum;
  }
  expect(Math.abs(lum.ours16 - lum.three)).toBeLessThan(0.005);
  // and the lake's mirror pass (which hides the interiors) must never be the pass that refreshes the
  // shadow map: the primary bath at golden hour is lit the same with the mirror on or off
  const bath: number[] = [];
  for (const on of [false, true]) {
    await page.evaluate((v) => window.__app.lakeEnabled(v), on);
    bath.push((await page.evaluate(() => window.__app.photo(36, 10, 11, 1.107, -0.1, 17.75, 640, 360))).meanLum);
  }
  expect(Math.abs(bath[0] - bath[1])).toBeLessThan(0.005);
});

test('LODs: far-away furniture twins and lite tree crowns switch with distance', async ({ page }) => {
  await openApp(page);
  const kitchen = await page.evaluate(() => window.__app.lodAt(42.6, 41, 11));
  const water = await page.evaluate(() => window.__app.lodAt(-260, 30, -49));
  // in the kitchen all three floors are close: full detail (the deck furniture, 50+ ft away, may be a twin);
  // trees beyond 140 ft are lite even from here
  for (const g of ['L0i', 'L1i', 'L2i']) expect(kitchen.furnitureFar).not.toContain(g);
  expect(kitchen.treesFull).toBeGreaterThan(0);
  // from the water every floor shows its twin, and nearly all trees are lite
  expect([...water.furnitureFar].sort()).toEqual(['L0i', 'L1i', 'L2i', 'site']);
  expect(water.treesLite).toBeGreaterThan(water.treesFull);
  expect(water.furnitureLoTris).toBeLessThan(water.furnitureTris * 0.25); // the twins: < 25% of the triangles
  merge('perf.json', 'lod', { kitchen, water });
});

test('budgets on the tour, High and Medium: draw calls and triangles per stop, GPU memory', async ({ page }) => {
  test.setTimeout(3_600_000);
  await openApp(page);
  await page.evaluate(() => window.__app.setTime(17.75));
  type F = { inside: boolean; calls: number; sceneCalls: number; mirrorCalls: number; tris: number; ms: number };
  const passes: Record<string, unknown> = {};
  for (const q of ['high', 'medium'] as const) {
    await page.evaluate((x) => window.__app.setQuality(x), q);
    const r = await page.evaluate(() => window.__app.tourTally(1280, 720, 4));
    const frames = [...r.stops, ...r.travel] as F[];
    // every stop the tour holds at
    expect(r.stops.length).toBe(JSON.parse(fs.readFileSync(path.join(ROOT, 'house-data.json'), 'utf8')).tourStops.filter((t: { dwellSec?: number }) => t.dwellSec).length);
    const ms = frames.map((f) => f.ms).sort((a, b) => a - b);
    const pct = (p: number) => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))];
    const max = (fs: F[], k: keyof F) => Math.max(0, ...fs.map((f) => f[k] as number));
    passes[q] = {
      tourSeconds: Math.round(r.seconds), stops: r.stops, travelSamples: r.travel.length,
      inside: { maxSceneCalls: max(frames.filter((f) => f.inside), 'sceneCalls'), maxFrameCalls: max(frames.filter((f) => f.inside), 'calls') },
      outside: { maxSceneCalls: max(frames.filter((f) => !f.inside), 'sceneCalls'), maxFrameCalls: max(frames.filter((f) => !f.inside), 'calls') },
      maxTris: max(frames, 'tris'),
      softwareMs: { avg: Math.round(ms.reduce((s, v) => s + v, 0) / ms.length), p95: pct(0.95), p99: pct(0.99) },
    };
    for (const f of frames) {
      expect(f.sceneCalls).toBeLessThanOrEqual(f.inside ? BUDGET.callsInside : BUDGET.callsOutside);
      expect(f.tris).toBeLessThanOrEqual(BUDGET.tris);
    }
  }
  // GPU memory at 1920×1080 on High, after the whole tour (every probe captured, every texture used)
  await page.evaluate(() => window.__app.setQuality('high'));
  await page.evaluate(() => window.__app.frameTally(-260, 30, -49, -Math.PI / 2, 0.12, 1920, 1080));
  await page.evaluate(() => window.__app.frameTally(22, 36, 11, Math.PI / 2, 0.08, 1920, 1080));
  const mem = await page.evaluate(() => window.__app.gpuMemory());
  merge('perf.json', 'tour', passes);
  merge('perf.json', 'gpuMemoryMB', { at: '1920×1080, High', total: Math.round(mem.total), textures: Math.round(mem.textures), buffers: Math.round(mem.buffers), renderbuffers: Math.round(mem.renderbuffers) });
  expect(mem.total).toBeLessThanOrEqual(BUDGET.gpuMB);
});

test('perf mode end to end (the pnpm perf pipeline, here at 20× tour speed in software)', async ({ page }) => {
  test.setTimeout(1_800_000);
  await page.setViewportSize({ width: 480, height: 270 });
  await page.goto('/?perf=low&perfSpeed=20');
  await page.waitForFunction(() => (window as unknown as { __perfReport?: unknown }).__perfReport, null, { timeout: 1_700_000, polling: 2000 });
  const r = await page.evaluate(() => (window as unknown as { __perfReport: PerfReport }).__perfReport);
  expect(r.passes.map((p) => p.quality)).toEqual(['low']);
  const p = r.passes[0];
  expect(p.frames).toBeGreaterThan(50);
  const dwells = JSON.parse(fs.readFileSync(path.join(ROOT, 'house-data.json'), 'utf8')).tourStops.filter((t: { dwellSec?: number }) => t.dwellSec).length;
  expect(p.stops.length).toBe(dwells); // every stop the tour dwells at was measured…
  expect(p.stops.filter((s) => s.tris > 0 && s.sceneCalls > 0).length).toBe(dwells); // …with real numbers
  expect(p.p99Ms).toBeGreaterThanOrEqual(p.p95Ms);
  expect(r.firstViewMs).toBeGreaterThan(0);
  expect(r.gpuMemoryMB).toBeGreaterThan(0);
  fs.writeFileSync(path.join(OUT, 'perf-mode-smoke.md'), perfMarkdown(r).replace('# Perf report', '# Perf report — smoke run (software rendering, 20× tour speed: the timings mean nothing, the pipeline is what is tested)'));
  await page.screenshot({ path: path.join(OUT, 'perf-mode-overlay.png') });
});

test('download size and first view (production build)', async ({ page }) => {
  test.setTimeout(600_000);
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-dist-'));
  execSync(`pnpm exec vite build --outDir "${dist}" --emptyOutDir`, { cwd: ROOT, stdio: 'pipe' });
  // what a browser downloads: text compressed (every static host gzips it), images and binaries as-is
  let raw = 0, wire = 0;
  const walk = (d: string) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); const s = fs.statSync(p); if (s.isDirectory()) walk(p); else { raw += s.size; wire += /\.(js|css|html|json|svg|bin)$/.test(f) ? zlib.gzipSync(fs.readFileSync(p)).length : s.size; } } };
  walk(dist);
  const downloadMB = +(wire / 1048576).toFixed(1);
  expect(downloadMB).toBeLessThanOrEqual(BUDGET.downloadMB);
  // first view: open the real app (no test mode) and read when the loader lifts
  const lines: string[] = [];
  page.on('console', (m) => lines.push(m.text()));
  await page.goto('/');
  await page.waitForFunction(() => !document.getElementById('loader'), null, { timeout: 300_000 });
  const fv = lines.map((l) => /First view at ([\d.]+) s/.exec(l)).find(Boolean);
  merge('perf.json', 'download', { rawMB: +(raw / 1048576).toFixed(1), downloadMB, firstViewSoftwareS: fv ? +fv[1] : null });
  fs.rmSync(dist, { recursive: true, force: true });
});
});

/**
 * The real perf check, on a real GPU: `pnpm perf` builds the app, serves the production build and
 * opens it in a visible Chrome window with `?perf=high,medium` — the app plays the whole guided tour
 * in real time on High, then on Medium, measuring every frame — and writes perf-report.md / .json.
 */
test('real-GPU tour: frame times on High and Medium (pnpm perf)', async ({ page }) => {
  test.skip(!REAL, 'run with pnpm perf (needs a real GPU)');
  test.setTimeout(3_600_000);
  await page.goto('/?perf=high,medium');
  await page.waitForFunction(() => (window as unknown as { __perfReport?: unknown }).__perfReport, null, { timeout: 3_500_000, polling: 2000 });
  const r = await page.evaluate(() => (window as unknown as { __perfReport: PerfReport }).__perfReport);
  const md = perfMarkdown(r);
  fs.writeFileSync(path.join(ROOT, 'perf-report.json'), JSON.stringify(r, null, 2));
  fs.writeFileSync(path.join(ROOT, 'perf-report.md'), md);
  console.log('\n' + md + '\nWritten to perf-report.md and perf-report.json');
  await page.screenshot({ path: path.join(ROOT, 'perf-report.png') });
});

type PerfReport = import('../src/perf/perfmode').PerfReport;
function perfMarkdown(r: PerfReport) {
  const ok = (v: number, b: number) => (v <= b ? `${v} ✅` : `${v} ❌ (budget ${b})`);
  let s = `# Perf report\n\n${r.gpu}\n\n${r.viewport} at ${r.pixelRatio}× · ${r.userAgent}\n\n`;
  s += `| | measured | budget |\n|---|---|---|\n| First view | ${(r.firstViewMs / 1000).toFixed(1)} s | < ${BUDGET.firstViewS} s |\n| Download | ${r.downloadMB} MB | ≤ ${BUDGET.downloadMB} MB |\n| GPU memory | ${r.gpuMemoryMB} MB | ≤ ${BUDGET.gpuMB} MB |\n\n`;
  for (const p of r.passes) {
    s += `## ${p.quality}\n\nFrame time over the whole tour (${p.frames} frames, ${p.seconds} s): **avg ${p.avgMs} ms · p95 ${p.p95Ms} ms · p99 ${p.p99Ms} ms** · worst ${p.maxMs} ms\n\n`;
    s += `Scene draw calls: inside ${ok(p.maxSceneCallsInside, BUDGET.callsInside)} · outside ${ok(p.maxSceneCallsOutside, BUDGET.callsOutside)} (whole frame incl. mirror + post: ${p.maxCallsInside} / ${p.maxCallsOutside}) · max triangles ${ok(p.maxTris, BUDGET.tris)}\n\n`;
    s += `| # | stop | where | scene calls | frame calls | triangles | avg ms |\n|---|---|---|---|---|---|---|\n`;
    for (const st of p.stops) s += `| ${st.stop} | ${st.label} | ${st.inside ? 'inside' : 'outside'} | ${st.sceneCalls} | ${st.calls} | ${st.tris.toLocaleString()} | ${st.avgMs} |\n`;
    s += '\n';
  }
  return s;
}
