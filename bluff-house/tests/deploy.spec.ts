import { expect, test } from '@playwright/test';
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PROOF, ROOT } from './helpers';

/**
 * Stage 7: the production build, served under the same sub-path GitHub Pages uses
 * (/acedemic-os/bluff-house-tour/), boots with no errors and loads every asset from that path:
 * the KTX2 textures, the KTX2 lightmaps, the Basis transcoder. Nothing may be fetched from `/`.
 */
const BASE = '/acedemic-os/bluff-house-tour/';
const PORT = 4180;

test('the production build runs from the GitHub Pages sub-path', async ({ page }) => {
  test.setTimeout(900_000);
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-pages-'));
  execSync(`pnpm exec vite build --outDir "${dist}" --emptyOutDir`, { cwd: ROOT, stdio: 'pipe', env: { ...process.env, BASE_PATH: BASE, SOURCEMAP: '0' } });
  for (const f of fs.readdirSync(path.join(dist, 'lightmaps'))) if (f.endsWith('.png')) fs.rmSync(path.join(dist, 'lightmaps', f)); // as the deploy does
  const server = spawn('pnpm', ['exec', 'vite', 'preview', '--outDir', dist, '--port', String(PORT), '--strictPort'], { cwd: ROOT, env: { ...process.env, BASE_PATH: BASE }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 60; i++) { try { await fetch(`http://localhost:${PORT}${BASE}`); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
    const lines: string[] = [], errors: string[] = [], outside: string[] = [], failed: string[] = [];
    page.on('console', (m) => { lines.push(m.text()); if (m.type() === 'error' && !/fonts\.g|ERR_TUNNEL|net::/.test(m.text() + (m.location().url ?? ''))) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (r) => { const u = new URL(r.url()); if (u.hostname === 'localhost' && !u.pathname.startsWith(BASE)) outside.push(u.pathname); });
    // (only our own server counts: this container's network blocks Google Fonts, the one outside request)
    const ours = (u: string) => new URL(u).hostname === 'localhost';
    page.on('requestfailed', (r) => { if (ours(r.url())) failed.push(r.url()); });
    page.on('response', (r) => { if (r.status() >= 400 && ours(r.url())) failed.push(`${r.status()} ${r.url()}`); });
    await page.goto(`http://localhost:${PORT}${BASE}`);
    await page.waitForFunction(() => !document.getElementById('loader'), null, { timeout: 600_000 });
    await page.waitForTimeout(3000); // a few real frames of the tour
    expect(errors).toEqual([]);
    expect(failed).toEqual([]);
    expect(outside).toEqual([]); // everything came from under the sub-path
    expect(lines.some((l) => /Textures: 44 pre-baked KTX2 sets/.test(l))).toBe(true);
    expect(lines.some((l) => /Baked GI: 52 surfaces lightmapped/.test(l))).toBe(true);
    fs.mkdirSync(path.join(PROOF, 'stage7'), { recursive: true });
    await page.screenshot({ path: path.join(PROOF, 'stage7', 'production-build-from-pages-path.png') });
    // what gets published
    let bytes = 0, files = 0;
    const walk = (d: string) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); const s = fs.statSync(p); if (s.isDirectory()) walk(p); else { bytes += s.size; files++; } } };
    walk(dist);
    fs.writeFileSync(path.join(PROOF, 'stage7', 'build.txt'), `production build for ${BASE}: ${files} files, ${(bytes / 1048576).toFixed(1)} MB\n` + lines.filter((l) => /Textures|Baked GI|First view|heated|Furniture:/.test(l)).join('\n') + '\n');
  } finally {
    server.kill();
    fs.rmSync(dist, { recursive: true, force: true });
  }
});
