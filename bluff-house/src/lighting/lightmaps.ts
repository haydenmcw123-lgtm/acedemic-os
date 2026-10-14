import * as THREE from 'three';
import type { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { material, type Variant } from '../materials/library';

/**
 * Baked GI (Stage 5): three Cycles lightmaps — Morning 8:00, Noon 12:30, Golden 17:45 — baked by
 * scripts/bake.py onto a second UV set of the interior surfaces. Each holds everything except the
 * sun's direct light (indirect bounce from sun and sky, plus sky light through the windows); the
 * sun itself stays real-time with its sharp shadow map, and so do the electric lights.
 *
 * As the clock moves, the surfaces blend the three maps themselves (three texture reads, weights
 * from the clock): no blended copy in GPU memory. Night is the noon bake × 0.05. The maps load as
 * KTX2 (block-compressed on the GPU) when `pnpm textures` has made them, else as the PNGs.
 *
 * On baked surfaces the lightmap *replaces* the stand-in fill lights (hemisphere, window
 * RectAreaLights, sky-environment diffuse) — that is what removes the light leaks — and the baked
 * ambient occlusion keeps reflections out of corners.
 */
interface Manifest {
  res: number; maxValue: number; skyFactor: number;
  times: { name: string; hour: number; file: string }[];
  ao: string; uv2: string;
  objects: { name: string; tris: number; offset: number }[];
}

const PRESET_HOURS = [8, 12.5, 17.75];
/** Calibration on top of the physical units (π · maxValue): the bake is physically dim indoors (a few % of
 * outdoor light); 3.5× plus the interior exposure gives the look of a properly exposed interior photo. */
export const LIGHTMAP_GAIN = 3.5;

export class Lightmaps {
  ready = false;
  enabled = true;
  readonly receivers: { mesh: THREE.Mesh; live: THREE.Material; baked: THREE.Material }[] = [];
  private maps: THREE.Texture[] = [];
  private ao: THREE.Texture | null = null;
  private manifest: Manifest | null = null;
  private weights = new THREE.Vector4(0, 1, 0, 1); // morning, noon, golden, scale
  /** Which files were used: 'ktx2' or 'png'. */
  format = '';
  problems: string[] = [];

  constructor(private ktx2: KTX2Loader | null = null) {}

  /** Loads the bake (if there is one) and applies it to the meshes it was baked for. */
  async load(groups: Iterable<THREE.Object3D>, base = `${import.meta.env.BASE_URL}lightmaps/`) {
    let m: Manifest;
    try {
      const r = await fetch(base + 'manifest.json');
      if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return false;
      m = await r.json();
    } catch { return false; }
    const uv = new Float32Array(await (await fetch(base + m.uv2)).arrayBuffer());
    // KTX2 if `pnpm textures` made it (flipped at encode time), else the PNG (flipY on: Blender's UV
    // (0,0) is the bottom-left)
    const ktx = this.ktx2 && (await fetch(base + m.ao.replace(/\.png$/, '.ktx2'), { method: 'HEAD' }).then((r) => r.ok && !(r.headers.get('content-type') ?? '').includes('html')).catch(() => false));
    this.format = ktx ? 'ktx2' : 'png';
    const png = new THREE.TextureLoader();
    const load = async (f: string) => {
      const t = ktx ? await this.ktx2!.loadAsync(base + f.replace(/\.png$/, '.ktx2')) : await png.loadAsync(base + f);
      if (!ktx) t.colorSpace = f === m.ao ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      t.channel = 1; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter;
      return t;
    };
    const byName = new Map(m.times.map((t) => [t.name, t]));
    const order = ['morning', 'noon', 'golden'].map((n) => byName.get(n) ?? m.times[0]);
    this.maps = await Promise.all(order.map((t) => load(t.file)));
    this.ao = await load(m.ao);

    // second UV set onto the receivers (matched by mesh name and triangle count)
    const meshes = new Map<string, THREE.Mesh>();
    for (const g of groups) g.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.set(o.name, o as THREE.Mesh); });
    const intensity = Math.PI * m.maxValue * LIGHTMAP_GAIN;
    for (const o of m.objects) {
      const mesh = meshes.get(o.name);
      if (!mesh) { this.problems.push(`no mesh "${o.name}" (the house changed since the bake: run pnpm bake)`); continue; }
      const count = mesh.geometry.attributes.position.count;
      if (count !== o.tris * 3) { this.problems.push(`"${o.name}": ${count / 3} triangles vs ${o.tris} baked (run pnpm bake)`); continue; }
      mesh.geometry.setAttribute('uv1', new THREE.BufferAttribute(uv.slice(o.offset, o.offset + o.tris * 6), 2));
      const live = mesh.material as THREE.MeshStandardMaterial;
      const [key, variant] = live.name.split('|') as [string, Variant];
      const baked = material(key, variant, 'baked') as THREE.MeshStandardMaterial;
      if (!baked.userData.lightmapped) this.patch(baked, intensity);
      mesh.material = baked;
      this.receivers.push({ mesh, live, baked });
    }
    this.manifest = m;
    this.ready = true;
    return true;
  }

  private patch(m: THREE.MeshStandardMaterial, intensity: number) {
    m.userData.lightmapped = true;
    m.lightMap = this.maps[1]; // noon; morning and golden come in as extra uniforms
    m.lightMapIntensity = intensity;
    const ao = this.ao!, [a, , c] = this.maps, w = this.weights;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.bakedAO = { value: ao };
      sh.uniforms.lmMorning = { value: a }; sh.uniforms.lmGolden = { value: c }; sh.uniforms.lmWeights = { value: w };
      const maps = THREE.ShaderChunk.lights_fragment_maps
        .replace('vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );',
          'vec4 lightMapTexel = vec4( ( texture2D( lmMorning, vLightMapUv ).rgb * lmWeights.x + texture2D( lightMap, vLightMapUv ).rgb * lmWeights.y + texture2D( lmGolden, vLightMapUv ).rgb * lmWeights.z ) * lmWeights.w, 1.0 );')
        .replace('irradiance += lightMapIrradiance;', 'irradiance = lightMapIrradiance; // baked: replaces ambient + hemisphere fill\n\t\tbakedOcc = texture2D( bakedAO, vLightMapUv ).r;')
        .replace('iblIrradiance += getIBLIrradiance( geometryNormal );', '// baked: the lightmap carries the sky light')
        .replace('radiance += iblRadiance;', 'radiance += iblRadiance * mix( 1.0, bakedOcc, 0.85 ); // keep reflections out of corners');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <lightmap_pars_fragment>', '#include <lightmap_pars_fragment>\nuniform sampler2D bakedAO, lmMorning, lmGolden; uniform vec4 lmWeights;')
        .replace('#include <lights_fragment_begin>', '#undef RE_Direct_RectArea // window fill light is in the bake\n#include <lights_fragment_begin>\nfloat bakedOcc = 1.0;')
        .replace('#include <lights_fragment_maps>', maps);
    };
    m.customProgramCacheKey = () => 'baked-gi';
    m.needsUpdate = true;
  }

  /**
   * Blend weights for a clock time: linear between the three presets, faded with the sky light
   * before the morning bake and after the golden one, toward noon × 0.05 at night.
   */
  setTime(hour: number, daylight: (h: number) => number) {
    const [h0, h1, h2] = PRESET_HOURS;
    let wm = 0, wn = 0, wg = 0, scale = 1;
    if (hour <= h0) { wm = 1; scale = daylight(hour) / Math.max(1e-3, daylight(h0)); }
    else if (hour <= h1) { const t = (hour - h0) / (h1 - h0); wm = 1 - t; wn = t; }
    else if (hour <= h2) { const t = (hour - h1) / (h2 - h1); wn = 1 - t; wg = t; }
    else { wg = 1; scale = daylight(hour) / Math.max(1e-3, daylight(h2)); }
    // night: whatever daylight is left, plus the noon bake × 0.05
    const night = 1 - Math.min(1, scale);
    wm *= scale; wn = wn * scale + 0.05 * night; wg *= scale;
    this.weights.set(wm, wn, wg, 1); // a shared uniform: every lightmapped surface sees it at once
  }

  /** Baked GI on/off (before/after comparisons): off puts the real-time stand-in lighting back. */
  setEnabled(on: boolean) {
    this.enabled = on;
    for (const r of this.receivers) r.mesh.material = on ? r.baked : r.live;
  }

  get info() { return { ready: this.ready, receivers: this.receivers.length, problems: this.problems, res: this.manifest?.res ?? 0, weights: this.weights.toArray(), format: this.format }; }
}
