/**
 * Downloads the CC0 furniture models and PBR texture sets the walkthrough can use instead of its
 * procedural stand-ins, compresses them, and writes the manifest the app reads at startup.
 *
 *   pnpm assets            (= tsx scripts/fetch-assets.ts)
 *
 * Sources, in the spec's order of preference: Poly Haven models (CC0), then Kenney / Quaternius (CC0)
 * for simple items; textures from ambientCG / Poly Haven (CC0, 2K: albedo + normal + roughness + AO).
 *
 * Pipeline:
 *   1. query each host's public API for the best match per item (no hard-coded asset ids, so a
 *      renamed asset doesn't break the script), download the 1K/2K glTF + textures into assets/raw/;
 *   2. pack and compress with glTF-Transform (`optimize`: WebP textures ≤ 1024 px, meshopt) into
 *      public/models/<file>.glb;
 *   3. write public/models/manifest.json; the app swaps each parametric stand-in for its model and
 *      fits it to the item's size box (logging anything that needs > 15% non-uniform scale).
 *
 * If a host is unreachable (as in the build environment, whose network policy blocks these hosts),
 * nothing fails: the script writes assets/MANUAL-DOWNLOADS.md with the exact pages and API URLs to
 * fetch by hand into assets/raw/, then re-run with --local to compress whatever is there.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const RAW = path.join(ROOT, 'assets', 'raw');
const OUT = path.join(ROOT, 'public', 'models');
const LOCAL = process.argv.includes('--local');

/** Model wanted for each catalog `glb` name: search terms (name/tags) and Poly Haven categories. */
const MODELS: { file: string; items: string[]; search: string[] }[] = [
  { file: 'sectional.glb', items: ['Sectional', 'Media sectional'], search: ['sectional', 'sofa', 'couch'] },
  { file: 'sofa.glb', items: ['Loft sofa'], search: ['sofa', 'couch'] },
  { file: 'outdoor_sofa.glb', items: ['Outdoor sofa'], search: ['outdoor sofa', 'garden sofa', 'sofa'] },
  { file: 'lounge_chair.glb', items: ['Lounge chair'], search: ['armchair', 'lounge chair', 'chair'] },
  { file: 'dining_chair.glb', items: ['Dining chair'], search: ['dining chair', 'chair'] },
  { file: 'office_chair.glb', items: ['Desk chair'], search: ['office chair', 'desk chair'] },
  { file: 'bar_stool.glb', items: ['Stool'], search: ['bar stool', 'stool'] },
  { file: 'bench.glb', items: ['Bench'], search: ['bench'] },
  { file: 'lounger.glb', items: ['Lounger'], search: ['sun lounger', 'deck chair', 'lounger'] },
  { file: 'adirondack_chair.glb', items: ['Adirondack chair'], search: ['adirondack', 'garden chair'] },
  { file: 'bed_king.glb', items: ['Bed'], search: ['bed', 'double bed'] },
  { file: 'bed_queen.glb', items: ['Queen bed'], search: ['bed'] },
  { file: 'nightstand.glb', items: ['Nightstand'], search: ['nightstand', 'bedside', 'side cabinet'] },
  { file: 'dresser.glb', items: ['Dresser'], search: ['dresser', 'chest of drawers', 'drawer'] },
  { file: 'side_table.glb', items: ['Side table'], search: ['side table', 'end table'] },
  { file: 'coffee_table.glb', items: ['Coffee table'], search: ['coffee table'] },
  { file: 'dining_table.glb', items: ['Dining table'], search: ['dining table', 'table'] },
  { file: 'console_table.glb', items: ['Console'], search: ['console table', 'console'] },
  { file: 'desk.glb', items: ['Desk'], search: ['desk', 'writing desk'] },
  { file: 'potted_plant.glb', items: ['Plant'], search: ['potted plant', 'plant', 'fiddle'] },
  { file: 'patio_umbrella.glb', items: ['Umbrella'], search: ['umbrella', 'parasol'] },
  { file: 'pool_table.glb', items: ['Pool table'], search: ['pool table', 'billiard'] },
  { file: 'power_rack.glb', items: ['Power rack'], search: ['squat rack', 'power rack'] },
  { file: 'dumbbell_rack.glb', items: ['Dumbbells'], search: ['dumbbell'] },
  { file: 'treadmill.glb', items: ['Treadmill'], search: ['treadmill'] },
  { file: 'exercise_bike.glb', items: ['Spin bike'], search: ['exercise bike', 'stationary bike'] },
  { file: 'rowing_machine.glb', items: ['Rower'], search: ['rowing machine', 'rower'] },
  { file: 'suv.glb', items: ['SUV'], search: ['suv', 'car'] },
  { file: 'coupe.glb', items: ['Coupe'], search: ['sports car', 'coupe', 'car'] },
  { file: 'wake_boat.glb', items: ['Wake boat'], search: ['boat', 'motorboat', 'speedboat'] },
];

/** Architectural PBR sets (ambientCG search terms), one per material key in src/materials/library.ts. */
const TEXTURES: { key: string; search: string; tileFt: number }[] = [
  { key: 'hickory', search: 'wood floor planks light', tileFt: 8 },
  { key: 'plaster', search: 'plaster white', tileFt: 8 },
  { key: 'stone', search: 'stacked stone wall', tileFt: 5 },
  { key: 'siding', search: 'wood siding vertical', tileFt: 8 },
  { key: 'oak', search: 'wood oak', tileFt: 4 },
  { key: 'walnut', search: 'wood walnut', tileFt: 4 },
  { key: 'tile', search: 'tiles large porcelain', tileFt: 8 },
  { key: 'slate', search: 'slate tiles', tileFt: 6 },
  { key: 'concrete', search: 'concrete polished', tileFt: 14 },
  { key: 'pavers', search: 'paving stones', tileFt: 12 },
  { key: 'deck', search: 'wood planks deck', tileFt: 8 },
  { key: 'roof', search: 'metal standing seam', tileFt: 8 },
  { key: 'grass', search: 'grass', tileFt: 16 },
  { key: 'fabric', search: 'fabric linen', tileFt: 1 },
  { key: 'leather', search: 'leather', tileFt: 1.5 },
  { key: 'quartz', search: 'marble white', tileFt: 4 },
];

async function reachable(url: string) {
  try { const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8000) }); return r.ok || r.status === 405; } catch { return false; }
}
async function getJson(url: string) { const r = await fetch(url, { signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json(); }
async function download(url: string, file: string) {
  const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}

/** Best Poly Haven model for a set of search terms (by name, then tags). */
async function polyHavenModel(index: Record<string, { name: string; tags?: string[]; categories?: string[] }>, terms: string[]) {
  for (const t of terms) {
    const hit = Object.entries(index).find(([, a]) => a.name.toLowerCase().includes(t)) ?? Object.entries(index).find(([, a]) => (a.tags ?? []).some((g) => g.toLowerCase() === t));
    if (hit) return hit[0];
  }
  return null;
}

async function fetchModels(credits: string[]) {
  const index = await getJson('https://api.polyhaven.com/assets?t=models');
  for (const m of MODELS) {
    const id = await polyHavenModel(index, m.search);
    if (!id) { console.warn(`no Poly Haven model for ${m.file} (${m.search.join(', ')}): keeping the parametric stand-in`); continue; }
    const files = await getJson(`https://api.polyhaven.com/files/${id}`);
    const g = files.gltf?.['2k'] ?? files.gltf?.['1k'];
    if (!g) continue;
    const dir = path.join(RAW, id);
    await download(g.gltf.url, path.join(dir, `${id}.gltf`));
    for (const [rel, f] of Object.entries<{ url: string }>(g.gltf.include ?? {})) await download(f.url, path.join(dir, rel));
    credits.push(`- ${m.items.join(', ')}: "${index[id].name}" by Poly Haven (https://polyhaven.com/a/${id}), CC0`);
    console.info(`${m.file} ← polyhaven:${id}`);
    fs.writeFileSync(path.join(dir, 'target.txt'), m.file);
  }
}

async function fetchTextures(credits: string[]) {
  for (const t of TEXTURES) {
    const q = encodeURIComponent(t.search);
    const j = await getJson(`https://ambientcg.com/api/v2/full_json?type=Material&sort=Popular&limit=1&q=${q}&include=downloadData`);
    const a = j.foundAssets?.[0];
    const zip = a?.downloadFolders?.default?.downloadFiletypeCategories?.zip?.downloads?.find((d: { attribute: string }) => d.attribute === '2K-JPG');
    if (!zip) { console.warn(`no ambientCG set for ${t.key}`); continue; }
    const file = path.join(RAW, 'textures', `${t.key}_${a.assetId}_2K-JPG.zip`);
    await download(zip.downloadLink ?? zip.fullDownloadPath, file);
    credits.push(`- ${t.key}: ${a.assetId} by ambientCG (https://ambientcg.com/view?id=${a.assetId}), CC0, tile ${t.tileFt} ft`);
  }
}

/** Packs and compresses every downloaded model into public/models and writes the manifest. */
function compress() {
  fs.mkdirSync(OUT, { recursive: true });
  const manifest: Record<string, string> = {};
  if (fs.existsSync(RAW)) for (const id of fs.readdirSync(RAW)) {
    const dir = path.join(RAW, id), target = path.join(dir, 'target.txt');
    if (!fs.existsSync(target)) continue;
    const file = fs.readFileSync(target, 'utf8').trim();
    const src = fs.readdirSync(dir).find((f) => f.endsWith('.gltf') || f.endsWith('.glb'));
    if (!src) continue;
    execSync(`pnpm dlx @gltf-transform/cli@4 optimize "${path.join(dir, src)}" "${path.join(OUT, file)}" --texture-compress webp --texture-size 1024 --compress meshopt`, { stdio: 'inherit' });
    manifest[file] = `models/${file}`;
  }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.info(`${Object.keys(manifest).length} models in public/models/manifest.json`);
}

function manualList(hosts: Record<string, boolean>) {
  const lines = [
    '# Assets to download by hand',
    '',
    `Generated by \`scripts/fetch-assets.ts\` on ${new Date().toISOString().slice(0, 10)}. These hosts were unreachable from the build environment:`,
    '',
    ...Object.entries(hosts).map(([h, ok]) => `- ${h}: ${ok ? 'reachable' : '**blocked**'}`),
    '',
    'Either allow them (Claude Code on the web: environment → Edit → Network access → Allowed domains) and run `pnpm assets`,',
    'or download by hand and run `pnpm assets --local`.',
    '',
    '## Furniture models (Poly Haven, CC0) → `assets/raw/<asset id>/`',
    '',
    'For each item, pick the closest model on Poly Haven, download its **glTF (2K)** into `assets/raw/<asset id>/`, and',
    'put the target file name in `assets/raw/<asset id>/target.txt` (e.g. `sectional.glb`). Search pages:',
    '',
    '| Target file | JSON items | Search |',
    '|---|---|---|',
    ...MODELS.map((m) => `| \`${m.file}\` | ${m.items.join(', ')} | https://polyhaven.com/models?s=${encodeURIComponent(m.search[0])} |`),
    '',
    'Files for one asset (all variants, with direct URLs): `https://api.polyhaven.com/files/<asset id>`.',
    '',
    '## Architectural textures (ambientCG, CC0, 2K-JPG) → `assets/raw/textures/`',
    '',
    '| Material | Search | Real-world tile |',
    '|---|---|---|',
    ...TEXTURES.map((t) => `| \`${t.key}\` | https://ambientcg.com/list?type=Material&q=${encodeURIComponent(t.search)} | ${t.tileFt} ft |`),
    '',
    'Each set downloads as `https://ambientcg.com/get?file=<AssetId>_2K-JPG.zip`.',
    '',
    'Until then the walkthrough uses its procedural stand-ins (every material and every furniture piece is generated in code,',
    'fitted to the JSON), so nothing is missing — it just isn\'t photo-scanned.',
  ];
  fs.mkdirSync(path.join(ROOT, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'assets', 'MANUAL-DOWNLOADS.md'), lines.join('\n') + '\n');
}

const hosts: Record<string, boolean> = {};
if (!LOCAL) {
  for (const h of ['https://api.polyhaven.com/assets?t=models', 'https://dl.polyhaven.org', 'https://ambientcg.com/api/v2/full_json?type=Material&limit=1']) hosts[new URL(h).host] = await reachable(h);
}
const credits: string[] = [];
if (!LOCAL && hosts['api.polyhaven.com'] && hosts['dl.polyhaven.org']) await fetchModels(credits);
if (!LOCAL && hosts['ambientcg.com']) await fetchTextures(credits);
if (!LOCAL && Object.values(hosts).some((ok) => !ok)) { manualList(hosts); console.warn('Some hosts are blocked: wrote assets/MANUAL-DOWNLOADS.md'); }
compress();
if (credits.length) {
  fs.writeFileSync(path.join(ROOT, 'assets', 'downloaded-credits.md'), credits.join('\n') + '\n');
  console.info('Add assets/downloaded-credits.md to CREDITS.md');
}
