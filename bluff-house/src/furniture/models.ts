import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { Furniture } from './furnish';

/**
 * Loads the downloaded furniture models listed in public/models/manifest.json (written by
 * scripts/fetch-assets.ts) and swaps them in for the parametric stand-ins as each one arrives.
 * With no manifest (or an empty one) nothing happens: the stand-ins stay.
 */
export async function loadModels(furniture: Furniture, onProgress: (done: number, total: number) => void = () => {}) {
  let manifest: Record<string, string> = {};
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}models/manifest.json`);
    if (r.ok && (r.headers.get('content-type') ?? '').includes('json')) manifest = await r.json();
  } catch { /* no models: keep the stand-ins */ }
  const entries = Object.entries(manifest);
  if (!entries.length) return 0;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  let done = 0;
  await Promise.all(entries.map(async ([file, url]) => {
    try { const g = await loader.loadAsync(`${import.meta.env.BASE_URL}${url}`); furniture.useModel(file, g.scene); }
    catch (e) { console.warn(`model ${file} failed to load; keeping the stand-in`, e); }
    onProgress(++done, entries.length);
  }));
  return done;
}
