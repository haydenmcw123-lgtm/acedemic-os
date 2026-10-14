/**
 * Stage 7: publishes the production build to GitHub Pages.
 *
 *   pnpm deploy:pages
 *
 * This repo's GitHub Pages site is served from the root of `main` (your Academic OS page lives
 * there), so the walkthrough goes into its own folder on `main` and nothing else is touched:
 *
 *   https://<user>.github.io/<repo>/bluff-house-tour/
 *
 * Steps: build with that base path (no source maps), drop the lightmap PNGs (the app loads the
 * KTX2 copies), check out `main` in a temporary worktree, replace only `bluff-house-tour/`, commit,
 * push. GitHub Pages republishes in about a minute. Override the folder with PAGES_DIR=…
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const sh = (cmd: string, cwd = ROOT, env: NodeJS.ProcessEnv = {}) => execSync(cmd, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
const out = (cmd: string, cwd = ROOT) => execSync(cmd, { cwd, encoding: 'utf8' }).trim();

const dir = process.env.PAGES_DIR ?? 'bluff-house-tour';
const branch = process.env.PAGES_BRANCH ?? 'main';
const remote = out('git remote get-url origin');
const m = /github\.com[/:]([^/]+)\/([^/.]+?)(\.git)?$/.exec(remote);
if (!m) throw new Error(`origin is not a GitHub repo: ${remote}`);
const [, owner, repo] = m;
const base = `/${repo}/${dir}/`;
const dist = path.join(ROOT, 'dist-pages');

console.log(`\n▸ building for https://${owner.toLowerCase()}.github.io${base}`);
sh(`pnpm exec vite build --outDir "${dist}" --emptyOutDir`, ROOT, { BASE_PATH: base, SOURCEMAP: '0' });
for (const f of fs.readdirSync(path.join(dist, 'lightmaps'))) if (f.endsWith('.png')) fs.rmSync(path.join(dist, 'lightmaps', f));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-'));
try {
  sh(`git fetch origin ${branch}`);
  sh(`git worktree add --detach "${tmp}" origin/${branch}`);
  const target = path.join(tmp, dir);
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(dist, target, { recursive: true });
  sh(`git add -A "${dir}"`, tmp);
  if (!out('git status --porcelain', tmp)) { console.log('▸ nothing changed since the last deploy'); }
  else {
    const rev = out('git rev-parse --short HEAD');
    sh(`git commit -q -m "Deploy Bluff House walkthrough (${rev}) to /${dir}/"`, tmp);
    sh(`git push origin HEAD:${branch}`, tmp);
    console.log(`\n✔ pushed. Live in ~1 minute at https://${owner.toLowerCase()}.github.io${base}`);
  }
} finally {
  sh(`git worktree remove --force "${tmp}"`);
}
