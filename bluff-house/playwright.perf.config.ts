import { defineConfig } from '@playwright/test';

/**
 * `pnpm perf`: the real perf check on your own machine. Unlike the test suite (headless, software
 * rendering), this opens a visible Chrome window so the app runs on your real GPU, serves the
 * production build, and plays the guided tour on High and Medium with vsync off (so a frame that
 * takes 7 ms reports 7 ms, not the display's 16.7). Leave the window alone while it
 * runs (about 15 minutes): the report lands in perf-report.md.
 *
 * Uses your installed Google Chrome. No Chrome? `pnpm exec playwright install chromium`, then
 * `PERF_BROWSER=chromium pnpm perf`.
 */
process.env.PERF_REAL = '1'; // tells perf.spec.ts to run the real-GPU test (and skip the container ones)
const PORT = 4173;
const channel = process.env.PERF_BROWSER === 'chromium' ? undefined : process.env.PERF_BROWSER ?? 'chrome';
export default defineConfig({
  testDir: 'tests',
  testMatch: 'perf.spec.ts',
  timeout: 3_600_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: false,
    channel,
    viewport: null, // the real window size and pixel ratio
    // vsync off: frame times show what each frame really costs, not the display's 16.7 ms cadence
    launchOptions: { args: ['--start-maximized', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'] },
  },
  webServer: { command: `pnpm exec vite preview --port ${PORT} --strictPort`, url: `http://localhost:${PORT}`, reuseExistingServer: true, timeout: 60_000 },
});
