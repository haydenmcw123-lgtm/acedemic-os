import { defineConfig } from 'vite';

// The Playwright test server sets FROZEN=1: no hot reload and no file watching, so editing source
// while a long test (or the video recorder) runs can never reload the page under it.
const frozen = !!process.env.FROZEN;

export default defineConfig({
  // BASE_PATH: where the site is served from. `/` locally; `/<repo>/<folder>/` on GitHub Pages
  // (scripts/deploy-pages.ts sets it). Every asset URL in the app is relative to it.
  base: process.env.BASE_PATH ?? '/',
  server: { port: 5173, strictPort: true, hmr: frozen ? false : undefined, watch: frozen ? { ignored: ['**/*'] } : undefined },
  build: { target: 'es2022', sourcemap: process.env.SOURCEMAP !== '0', chunkSizeWarningLimit: 2000 },
});
