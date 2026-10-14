import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { material } from '../materials/library';
import { textureSet } from '../materials/procedural';
import { clamp, fbm2, rng, len2 } from '../util/noise';
import { LAKE_Y } from './world';

/**
 * Mid-October trees.
 *  - Near (≤ 300 ft): instanced trees per species — red maple, orange oak, gold hickory and white
 *    pine — each a tapered trunk plus a crown of alpha-tested leaf cards that sway in the wind (vertex
 *    shader) and cast leaf-shaped shadows (a depth material with the same alpha test).
 *    LOD: past 140 ft a tree swaps to a lite crown (30% of the cards, each bigger, same silhouette),
 *    except near the house where the sun's shadow map covers it (a swap there would re-render shadows).
 *  - Mid (300–1,000 ft): camera-facing impostor billboards, tinted per instance.
 *  - Boulders on the bluff.
 * Placement keeps the house, decks, pool, drive, bluff stairs and dock clear, and keeps the view
 * from the main level to the lake open (trees on the bluff below the house stay below its sightline).
 */

/** Shared wind clock for every swaying material. */
export const wind = { time: { value: 0 } };

type Species = { key: string; leaf: string; cards: number; crown: [number, number]; trunk: number; pine?: boolean };
const SPECIES: Species[] = [
  { key: 'maple', leaf: 'leafRed', cards: 150, crown: [0.62, 0.36], trunk: 0.42 },
  { key: 'oak', leaf: 'leafOrange', cards: 170, crown: [0.6, 0.42], trunk: 0.38 },
  { key: 'hickory', leaf: 'leafGold', cards: 130, crown: [0.66, 0.3], trunk: 0.5 },
  { key: 'pine', leaf: 'needles', cards: 160, crown: [0.6, 0.2], trunk: 0.3, pine: true },
];

/** A unit tree (height 1, base at the origin): trunk geometry and crown-card geometry. */
function unitTree(sp: Species, seed: number, lite = 1) {
  const r = rng(seed);
  const trunk = new THREE.CylinderGeometry(0.008, 0.022, 1, 7, 1, true).translate(0, 0.5, 0);
  // a couple of main limbs into the crown
  const limbs: THREE.BufferGeometry[] = [trunk];
  if (!sp.pine) for (let i = 0; i < 3; i++) {
    const a = r() * Math.PI * 2, l = 0.25 + r() * 0.1;
    const g = new THREE.CylinderGeometry(0.004, 0.009, l, 5, 1, true).translate(0, l / 2, 0);
    g.rotateZ(0.7 + r() * 0.3); g.rotateY(a); g.translate(0, sp.trunk + r() * 0.15, 0);
    limbs.push(g);
  }
  const cards: THREE.BufferGeometry[] = [];
  const [cy, rad] = sp.crown;
  const n = Math.round(sp.cards * lite), grow = Math.sqrt(1 / lite); // same leaf area with fewer cards
  for (let i = 0; i < n; i++) {
    let x: number, y: number, z: number, s: number;
    if (sp.pine) {
      // a narrow cone of needle tufts, denser and wider toward the bottom
      const h = Math.pow(r(), 0.8), ring = (1 - h) * rad * (0.6 + r() * 0.5), a = r() * Math.PI * 2;
      x = Math.cos(a) * ring; z = Math.sin(a) * ring; y = 0.25 + h * 0.72; s = 0.06 + (1 - h) * 0.06;
    } else {
      // points on/inside an ellipsoid crown
      const u = r() * 2 - 1, a = r() * Math.PI * 2, rr = 0.55 + Math.cbrt(r()) * 0.45, q = Math.sqrt(1 - u * u);
      x = q * Math.cos(a) * rad * rr; z = q * Math.sin(a) * rad * rr; y = cy + u * (1 - cy) * 0.82 * rr; s = 0.08 + r() * 0.06;
    }
    const g = new THREE.PlaneGeometry(s * grow, s * grow);
    g.rotateX(-Math.PI / 2 + (r() - 0.5) * 1.6); g.rotateY(r() * Math.PI * 2);
    g.translate(x, y, z);
    cards.push(g);
  }
  return { trunk: mergeGeometries(limbs.map((g) => g.toNonIndexed()))!, crown: mergeGeometries(cards)! };
}

/** Adds a wind sway to a material's vertex stage (amplitude grows with height in the tree). */
function addWind(m: THREE.Material, amp: number) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.windTime = wind.time;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float windTime;').replace('#include <begin_vertex>', /* glsl */ `
      #include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 treeAt = instanceMatrix[3].xyz;
      #else
        vec3 treeAt = vec3(0.0);
      #endif
      float ph = treeAt.x * 0.071 + treeAt.z * 0.053;
      float hk = position.y * position.y;
      transformed.x += (sin(windTime * 1.1 + ph) * 0.7 + sin(windTime * 2.7 + ph * 3.0 + position.y * 4.0) * 0.3) * ${amp.toFixed(4)} * hk;
      transformed.z += cos(windTime * 0.9 + ph * 1.3) * ${(amp * 0.6).toFixed(4)} * hk;
      // leaf flutter
      transformed += normal * sin(windTime * 6.0 + dot(position, vec3(37.0, 17.0, 23.0))) * ${(amp * 0.25).toFixed(4)} * hk;
    `);
  };
  m.customProgramCacheKey = () => 'wind' + amp;
}

export interface TreeSite {
  height: (x: number, z: number) => number;
  /** true where nothing may grow (house, decks, drive, stairs, dock, lake) */
  blocked: (x: number, z: number) => boolean;
}

/** Lite crowns past this distance (ft); a little hysteresis keeps a tree from flickering between them. */
export const TREE_LOD = { far: 140, band: 8, every: 0.5 };
const LITE = 0.3;

interface TreeLod { full: THREE.InstancedMesh; lite: THREE.InstancedMesh; mats: Float32Array; cols: Float32Array; pos: Float32Array; n: number; shadowed: Uint8Array }

/**
 * Tree crown LOD: twice a second, every tree is written into either the full or the lite crown
 * instances by its distance from the camera (allocation-free: straight copies between typed arrays).
 */
export class TreeLods {
  private timer = 0;
  private far: Uint8Array[];
  /** Trees currently drawn with full / lite crowns. */
  full = 0; lite = 0;
  constructor(private species: TreeLod[]) { this.far = species.map((s) => new Uint8Array(s.n).fill(2)); }

  update(camX: number, camZ: number, force = false, dt = 0) {
    this.timer -= dt;
    if (this.timer > 0 && !force) return;
    this.timer = TREE_LOD.every;
    this.full = 0; this.lite = 0;
    for (let k = 0; k < this.species.length; k++) {
      const s = this.species[k], far = this.far[k];
      const fm = s.full.instanceMatrix.array as Float32Array, lm = s.lite.instanceMatrix.array as Float32Array;
      const fc = s.full.instanceColor!.array as Float32Array, lc = s.lite.instanceColor!.array as Float32Array;
      let nf = 0, nl = 0, changed = false;
      for (let i = 0; i < s.n; i++) {
        const x = s.pos[i * 2], z = s.pos[i * 2 + 1];
        const d = len2(x - camX, z - camZ);
        const was = far[i];
        // trees the sun's shadow map covers keep their full crown: a crown swap there would force a
        // re-render of the 4096² shadow map every time the camera crossed a tree's LOD distance
        const isFar = !s.shadowed[i] && (was === 1 ? d > TREE_LOD.far - TREE_LOD.band : d > TREE_LOD.far + TREE_LOD.band);
        if ((isFar ? 1 : 0) !== was) { far[i] = isFar ? 1 : 0; changed = true; }
        const dm = isFar ? lm : fm, dc = isFar ? lc : fc, j = isFar ? nl++ : nf++;
        for (let e = 0; e < 16; e++) dm[j * 16 + e] = s.mats[i * 16 + e];
        dc[j * 3] = s.cols[i * 3]; dc[j * 3 + 1] = s.cols[i * 3 + 1]; dc[j * 3 + 2] = s.cols[i * 3 + 2];
      }
      s.full.count = nf; s.lite.count = nl;
      if (changed) { s.full.instanceMatrix.needsUpdate = s.lite.instanceMatrix.needsUpdate = true; s.full.instanceColor!.needsUpdate = s.lite.instanceColor!.needsUpdate = true; }
      this.full += nf; this.lite += nl;
    }
  }
}

export function buildTrees(site: TreeSite, seed = 7) {
  const group = new THREE.Group(); group.name = 'trees';
  const r = rng(seed);
  // ---- near trees ----
  const near: { x: number; z: number; y: number; h: number; s: number; rot: number }[][] = SPECIES.map(() => []);
  const CX = 28, CZ = 40;
  let tries = 0;
  while (near.reduce((a, l) => a + l.length, 0) < 260 && tries++ < 20000) {
    const a = r() * Math.PI * 2, d = 70 + Math.sqrt(r()) * 240;
    const x = CX + Math.cos(a) * d, z = CZ + Math.sin(a) * d;
    if (site.blocked(x, z)) continue;
    const y = site.height(x, z);
    if (y < LAKE_Y + 1.5) continue;
    // keep the lake view from the main level open: below the house, trees must stay under its sightline
    let h = 42 + r() * 34;
    if (x < 4 && z > -40 && z < 120) h = Math.min(h, (11 + 3) - y); // tops below the main-level floor + 3 ft
    if (h < 14) continue;
    // stands: fbm decides where each species clusters
    const f = fbm2(x / 160, z / 160, 3, 91), g = fbm2(x / 90, z / 90, 2, 92);
    const sp = g > 0.6 ? 3 : f < 0.42 ? 0 : f < 0.55 ? 1 : 2;
    // keep a little spacing
    if (near[sp].some((t) => Math.hypot(t.x - x, t.z - z) < 9)) continue;
    near[sp].push({ x, z, y: y - 0.5, h, s: 0.8 + r() * 0.4, rot: r() * Math.PI * 2 });
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(), p = new THREE.Vector3();
  const lods: TreeLod[] = [];
  SPECIES.forEach((sp, k) => {
    const list = near[k];
    if (!list.length) return;
    const geo = unitTree(sp, 400 + k), lite = unitTree(sp, 400 + k, LITE).crown;
    const bark = material('bark', 'ext').clone();
    addWind(bark, 0.006);
    const leaf = material(sp.leaf, 'ext').clone();
    leaf.userData.depthMat = material(sp.leaf, 'ext').userData.depthMat;
    addWind(leaf, 0.012);
    const trunks = new THREE.InstancedMesh(geo.trunk, bark, list.length);
    const crowns = new THREE.InstancedMesh(geo.crown, leaf, list.length);
    const lites = new THREE.InstancedMesh(lite, leaf, list.length);
    const col = new THREE.Color();
    const mats = new Float32Array(list.length * 16), cols = new Float32Array(list.length * 3), pos = new Float32Array(list.length * 2);
    list.forEach((t, i) => {
      m4.compose(p.set(t.x, t.y, t.z), q.setFromAxisAngle(up, t.rot), sc.set(t.h * t.s * 0.9, t.h, t.h * t.s * 0.9));
      trunks.setMatrixAt(i, m4); m4.toArray(mats, i * 16);
      // a little per-tree variation in leaf color (some trees further along than others)
      col.setRGB(1, 0.9 + clamp(fbm2(t.x / 40, t.z / 40, 2, 93), 0, 1) * 0.2, 0.85 + r() * 0.2).toArray(cols, i * 3);
      pos[i * 2] = t.x; pos[i * 2 + 1] = t.z;
    });
    for (const im of [crowns, lites]) { im.setColorAt(0, col); im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); }
    for (const im of [trunks, crowns, lites]) { im.castShadow = true; im.receiveShadow = true; im.name = `trees:${sp.key}`; }
    crowns.customDepthMaterial = lites.customDepthMaterial = leaf.userData.depthMat;
    // bounds of the whole stand, so frustum culling never drops a partition that is in view
    trunks.computeBoundingSphere();
    crowns.boundingSphere = trunks.boundingSphere!.clone(); lites.boundingSphere = trunks.boundingSphere!.clone();
    group.add(trunks, crowns, lites);
    // inside the sun's shadow box (SHADOW_TARGET ± 70 ft, plus a crown's reach): always full detail
    const shadowed = Uint8Array.from(list, (t) => (Math.abs(t.x - 33) < 90 && Math.abs(t.z - 46) < 90 ? 1 : 0));
    lods.push({ full: crowns, lite: lites, mats, cols, pos, n: list.length, shadowed });
  });
  const lod = new TreeLods(lods);
  lod.update(0, 0, true);
  // ---- mid-distance impostors ----
  group.add(impostors(site, r));
  // ---- boulders on the bluff ----
  group.add(boulders(site, r));
  return { group, count: near.reduce((a, l) => a + l.length, 0), lod };
}

/** Camera-facing tree billboards between ~300 and 1,000 ft (beyond that the canopy texture takes over). */
function impostors(site: TreeSite, r: () => number) {
  const pts: { x: number; y: number; z: number; h: number; c: THREE.Color }[] = [];
  const pal = [[0.62, 0.26, 0.06], [0.52, 0.1, 0.06], [0.66, 0.45, 0.09], [0.12, 0.19, 0.11], [0.4, 0.23, 0.1]];
  let tries = 0;
  while (pts.length < 1800 && tries++ < 40000) {
    const a = r() * Math.PI * 2, d = 290 + Math.pow(r(), 0.8) * 750;
    const x = 28 + Math.cos(a) * d, z = 40 + Math.sin(a) * d;
    if (site.blocked(x, z)) continue;
    const y = site.height(x, z);
    if (y < LAKE_Y + 2) continue;
    const f = fbm2(x / 300, z / 300, 3, 95), e = fbm2(x / 180, z / 180, 2, 96) > 0.6 ? 3 : Math.floor(clamp(f * 5 - 0.8, 0, 3.99));
    const c = pal[e === 3 ? 3 : [0, 2, 1, 4][e]];
    pts.push({ x, y, z, h: 45 + r() * 35, c: new THREE.Color(c[0], c[1], c[2]).multiplyScalar(0.8 + r() * 0.4) });
  }
  const tex = textureSet('treeImpostor')!.map;
  const mat = new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null }, light: { value: new THREE.Color(1, 1, 1) }, windTime: wind.time }]),
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vColor;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv; vColor = instanceColor;
        vec3 c = instanceMatrix[3].xyz;
        float h = length(instanceMatrix[1].xyz), w = length(instanceMatrix[0].xyz);
        vec3 toCam = cameraPosition - c; toCam.y = 0.0;
        vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), normalize(toCam)));
        vec3 transformed = c + right * position.x * w + vec3(0.0, position.y * h, 0.0);
        vec4 mv = viewMatrix * vec4(transformed, 1.0);
        gl_Position = projectionMatrix * mv;
        #ifdef USE_FOG
          vFogWorld = transformed;
        #endif
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map; uniform vec3 light;
      varying vec2 vUv; varying vec3 vColor;
      #include <fog_pars_fragment>
      void main() {
        vec4 t = texture2D(map, vUv);
        if (t.a < 0.5) discard;
        gl_FragColor = vec4(t.rgb * vColor * light, 1.0);
        #include <fog_fragment>
      }`,
  });
  mat.uniforms.map.value = tex;
  const geo = new THREE.PlaneGeometry(0.62, 1).translate(0, 0.5, 0);
  const im = new THREE.InstancedMesh(geo, mat, pts.length);
  const m4 = new THREE.Matrix4();
  pts.forEach((t, i) => { m4.makeScale(t.h, t.h, 1).setPosition(t.x, t.y - 2, t.z); im.setMatrixAt(i, m4); im.setColorAt(i, t.c); });
  im.frustumCulled = false; // billboards turn in the shader: their bounds don't follow the instance matrix
  im.name = 'trees:impostors';
  im.userData.impostor = true;
  return im;
}

function boulders(site: TreeSite, r: () => number) {
  // a weathered boulder: a subdivided sphere pushed around by noise, flattened, welded so it shades smoothly
  const base = new THREE.IcosahedronGeometry(1, 4);
  base.deleteAttribute('uv');
  const welded = mergeVertices(base);
  const pos = welded.attributes.position as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i);
    const k = 0.72 + fbm2(v.x * 1.6 + 3, v.z * 1.6 + v.y * 1.3, 4, 97) * 0.6 + Math.abs(fbm2(v.x * 4, v.y * 4 + v.z, 2, 98) - 0.5) * 0.25;
    v.multiplyScalar(k);
    pos.setXYZ(i, v.x, v.y * 0.62, v.z);
    uv[i * 2] = v.x + v.z * 0.7; uv[i * 2 + 1] = v.y; // ~unit-scale planar UVs: the 6-ft rock texture lands at about a foot per unit
  }
  welded.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  welded.computeVertexNormals();
  // world-scale UVs are set per vertex from the unit shape (the rock texture is 6 ft)
  const list: THREE.Matrix4[] = [];
  let tries = 0;
  while (list.length < 70 && tries++ < 4000) {
    const x = -34 - r() * 26, z = -120 + r() * 340;
    if (site.blocked(x, z)) continue;
    const y = site.height(x, z);
    if (y < LAKE_Y + 0.5 || y > -2) continue;
    const s = 1.5 + Math.pow(r(), 2) * 5;
    list.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y - s * 0.25, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(r() * 0.5, r() * 6.28, r() * 0.5)), new THREE.Vector3(s * (0.8 + r() * 0.5), s, s * (0.8 + r() * 0.5))));
  }
  const im = new THREE.InstancedMesh(welded, material('rock', 'ext'), list.length);
  list.forEach((m, i) => im.setMatrixAt(i, m));
  im.castShadow = true; im.receiveShadow = true; im.name = 'boulders'; im.computeBoundingSphere();
  return im;
}
