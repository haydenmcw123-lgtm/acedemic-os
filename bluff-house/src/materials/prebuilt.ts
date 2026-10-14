import * as THREE from 'three';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { registerTextureSet } from './procedural';

/**
 * Pre-baked textures (Stage 6): `pnpm textures` writes every procedural texture set as mip-mapped
 * KTX2 (UASTC + Zstandard). They are loaded here, before the house is built, and transcoded in a
 * worker to the GPU's own compressed format — 1 byte per texel instead of 4, and no seconds spent
 * generating them at load. Without the files the generators run as before.
 */
let loader: KTX2Loader | null = null;

/** One shared KTX2 loader (the lightmaps use it too). */
export function ktx2(renderer: THREE.WebGLRenderer): KTX2Loader {
  if (!loader) loader = new KTX2Loader().setTranscoderPath(`${import.meta.env.BASE_URL}basis/`).detectSupport(renderer);
  return loader;
}

export async function loadPrebuiltTextures(renderer: THREE.WebGLRenderer, base = `${import.meta.env.BASE_URL}textures/`): Promise<number> {
  let sets: Record<string, { tileU: number; tileV: number }>;
  try {
    const r = await fetch(base + 'manifest.json');
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return 0;
    sets = (await r.json()).sets;
  } catch { return 0; }
  const l = ktx2(renderer);
  const load = async (f: string) => {
    const t = await l.loadAsync(base + f);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
  };
  await Promise.all(Object.entries(sets).map(async ([key, s]) => {
    const [map, normalMap, ormMap] = await Promise.all([load(`${key}.albedo.ktx2`), load(`${key}.normal.ktx2`), load(`${key}.orm.ktx2`)]);
    registerTextureSet(key, { map, normalMap, ormMap, tileU: s.tileU, tileV: s.tileV });
  }));
  return Object.keys(sets).length;
}
