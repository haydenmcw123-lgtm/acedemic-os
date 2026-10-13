import { defineConfig } from '@playwright/test';

// PORT lets a second checkout (a git worktree) test against its own dev server
const PORT = +(process.env.PORT ?? 5173);

// Headless Chromium renders with SwiftShader (no GPU), so tests drive the app with a
// fixed timestep through window.__app instead of letting the render loop run.
export default defineConfig({
  testDir: 'tests',
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 800 },
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  webServer: { command: `FROZEN=1 pnpm exec vite --port ${PORT} --strictPort`, url: `http://localhost:${PORT}`, reuseExistingServer: true, timeout: 60_000 },
});
