/**
 * Stage 5, step 1: exports the static architecture for the Blender lightmap bake.
 *
 *   pnpm bake:export   →  bake/scene.json + bake/scene.bin
 *
 * Builds the house exactly as the app does (same code, same JSON) and writes every merged mesh:
 *  - receivers: the interior surfaces (levels 0–2 and the stair hall) — these get lightmaps;
 *  - occluders: exterior shell, roof, fireplace mass, built-in furniture, decks and the terrain
 *    near the house — they shape the light but don't get lightmaps;
 *  - skipped: glass, water, emissive fixtures and loose furniture (it fades in and out).
 * Each mesh carries its average albedo (texture mean × color, linear) so light bounces with the
 * right color, and its triangles in the exact order the app draws them, so the lightmap UVs that
 * Blender writes back can be applied vertex for vertex.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { buildHouse } from '../src/build/house';
import { house } from '../src/data/house';
import { Furniture } from '../src/furniture/furnish';
import { sunPosition } from '../src/lighting/sun';
import { UTC_OFFSET } from '../src/lighting/timeofday';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'bake');

const RECEIVER_GROUPS = new Set(['L0i', 'L1i', 'L2i', 'stair']);
const SKIP_MATS = new Set(['glass', 'water', 'bulb', 'lake', 'poolGlow', 'heater', 'opal', 'shade', 'ember', 'screenGame', 'screenGolf']);
const NEAR = { x0: -40, x1: 100, z0: -30, z1: 110 }; // terrain kept as an occluder around the house

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/** Average linear albedo of a material: its color times the mean of its color map. */
function albedo(m: THREE.MeshStandardMaterial): [number, number, number] {
  const c = m.color ?? new THREE.Color(1, 1, 1);
  let r = 1, g = 1, b = 1;
  const img = (m.map?.image as { data?: Uint8Array; width: number; height: number } | undefined);
  if (img?.data) {
    let sr = 0, sg = 0, sb = 0, n = 0;
    for (let i = 0; i < img.data.length; i += 4 * 7) { sr += srgbToLinear(img.data[i] / 255); sg += srgbToLinear(img.data[i + 1] / 255); sb += srgbToLinear(img.data[i + 2] / 255); n++; }
    r = sr / n; g = sg / n; b = sb / n;
  }
  return [+(c.r * r).toFixed(4), +(c.g * g).toFixed(4), +(c.b * b).toFixed(4)];
}

const built = buildHouse(house);
const furniture = new Furniture(house, built.groups);
const objects: { name: string; role: 'receiver' | 'occluder'; albedo: [number, number, number]; offset: number; tris: number }[] = [];
const chunks: Float32Array[] = [];
let offset = 0;

function add(mesh: THREE.Mesh, role: 'receiver' | 'occluder', filter?: (cx: number, cz: number) => boolean) {
  const mat = mesh.material as THREE.MeshStandardMaterial;
  const key = String(mesh.userData.mat ?? mat.name ?? '').split('|')[0];
  if (SKIP_MATS.has(key) || (mat as THREE.Material).transparent) return;
  const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  mesh.updateWorldMatrix(true, false);
  const pos = geo.attributes.position as THREE.BufferAttribute, nrm = geo.attributes.normal as THREE.BufferAttribute;
  const v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  const data: number[] = [];
  let tris = 0;
  for (let t = 0; t < pos.count; t += 3) {
    if (filter) {
      const cx = (pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)) / 3, cz = (pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2)) / 3;
      if (!filter(cx, cz)) continue;
    }
    for (let k = t; k < t + 3; k++) {
      v.fromBufferAttribute(pos, k).applyMatrix4(mesh.matrixWorld);
      n.fromBufferAttribute(nrm, k).applyMatrix3(nm).normalize();
      data.push(v.x, v.y, v.z, n.x, n.y, n.z);
    }
    tris++;
  }
  if (!tris) return;
  objects.push({ name: mesh.name, role, albedo: albedo(mat), offset, tris });
  chunks.push(new Float32Array(data));
  offset += data.length;
}

for (const [key, group] of built.groups) {
  // furniture sits in a 'furniture:hi' / 'furniture:lo' pair per group: the bake uses the full-detail set
  const kids = group.children.flatMap((o) => (o.name === 'furniture:hi' ? o.children : o.name === 'furniture:lo' ? [] : [o]));
  for (const o of kids) {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh) continue;
    if (m.name.startsWith('furniture:')) { if (m.name.endsWith(':builtin')) add(m, 'occluder'); continue; }
    if (m.name === 'terrain') { add(m, 'occluder', (x, z) => x > NEAR.x0 && x < NEAR.x1 && z > NEAR.z0 && z < NEAR.z1); continue; }
    add(m, RECEIVER_GROUPS.has(key) ? 'receiver' : 'occluder', key === 'site' ? (x, z) => x > NEAR.x0 && x < NEAR.x1 && z > NEAR.z0 && z < NEAR.z1 : undefined);
  }
}
for (const o of built.roof.children) add(o as THREE.Mesh, 'occluder');
void furniture;

fs.mkdirSync(OUT, { recursive: true });
const all = new Float32Array(offset);
let at = 0; for (const c of chunks) { all.set(c, at); at += c.length; }
fs.writeFileSync(path.join(OUT, 'scene.bin'), Buffer.from(all.buffer));
const sum = (r: string) => objects.filter((o) => o.role === r).reduce((a, o) => a + o.tris, 0);
// the three bake times (the Morning / Noon / Golden presets), with the sun exactly as the runtime sets it
const sstep = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const [Y, M, D] = house.location.date.split('-').map(Number);
const LOW = new THREE.Color(1.0, 0.62, 0.32), HIGH = new THREE.Color(1.0, 0.96, 0.9);
const times = ([['morning', 8], ['noon', 12.5], ['golden', 17.75]] as const).map(([name, hour]) => {
  const s = sunPosition(Y, M, D, hour, house.location.lat, house.location.lon, UTC_OFFSET);
  const c = LOW.clone().lerp(HIGH, sstep(3, 30, s.elevation));
  return { name, hour, elevation: s.elevation, azimuth: s.azimuth, dir: s.dir, color: [c.r, c.g, c.b], strength: 3.4 * sstep(-0.8, 6, s.elevation) };
});
fs.writeFileSync(path.join(OUT, 'scene.json'), JSON.stringify({ units: 'feet', stride: 6, times, objects }, null, 1));
console.info(`bake export: ${objects.filter((o) => o.role === 'receiver').length} receiver meshes (${sum('receiver').toLocaleString()} tris), ${objects.filter((o) => o.role === 'occluder').length} occluders (${sum('occluder').toLocaleString()} tris)`);
