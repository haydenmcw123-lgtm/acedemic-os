import * as THREE from 'three';
import { material } from '../materials/library';
import { clamp, fbm2, noise2, sstep } from '../util/noise';
import type { TerrainFn } from './terrain';

/**
 * The world beyond the lot: a long mountain lake between our shore (the bluff, x ≈ −48) and the far
 * shore ~1,750 ft west, wooded hills rising 300–1,300 ft on both sides, and three rings of Blue
 * Ridge silhouettes further out that the distance haze turns blue.
 *
 * The hills are one heightfield on a non-uniform grid (10-ft cells next to the lot, growing to
 * ~300 ft at the edges), with a hole where the detailed lot terrain is. Fall color is painted per
 * vertex — oranges, reds, gold and evergreens in patches — and a canopy texture adds crowns up close.
 */
export const LOT = { x0: -140, x1: 270, z0: -150, z1: 280 };
export const LAKE_Y = -50;
const EXTENT = 7000;

/** West (far) shoreline x at a given z. */
export const farShoreX = (z: number) => -1750 + 260 * Math.sin(z / 1900 + 1) + 160 * (fbm2(z / 900, 7.7, 3, 41) - 0.5);
/** East (our) shoreline x at a given z, away from the lot. */
const nearShoreX = (z: number) => -48 - 140 * sstep(300, 1500, Math.abs(z - 65)) * (0.6 + fbm2(z / 700, 1.3, 3, 42)) + 40 * (noise2(z / 300, 2.2, 43) - 0.5);

/** Distance from a point outside the lot rectangle to the rectangle (0 inside). */
const lotDist = (x: number, z: number) => Math.hypot(Math.max(0, LOT.x0 - x, x - LOT.x1), Math.max(0, LOT.z0 - z, z - LOT.z1));

function hills(x: number, z: number) {
  const xw = farShoreX(z), xe = nearShoreX(z);
  if (x > xw && x < xe) return LAKE_Y - 12; // lake bed
  const east = x >= xe, d = east ? x - xe : xw - x;
  const big = fbm2(x / 2600, z / 2600, 4, 51), ridge = 1 - Math.abs(fbm2(x / 900, z / 900, 3, 52) * 2 - 1);
  let top = 260 + big * 1100 + ridge * 160;
  // our side climbs gently away from the lot (the house sits on a low bench above the bluff)
  if (east) top *= 0.2 + 0.8 * sstep(300, 3000, lotDist(x, z));
  const rise = 1 - Math.exp(-d / (east ? 1100 : 650));
  return LAKE_Y - 2 + rise * top + fbm2(x / 160, z / 160, 3, 53) * 28 * sstep(0, 120, d);
}


/** Grid coordinates along one axis: fine next to the lot, geometric growth outward, exact lot edges. */
function axis(lo: number, hi: number) {
  const out: number[] = [];
  for (let v = lo; v <= hi + 1e-6; v += 10) out.push(v);
  let step = 10, v = lo;
  while (v > -EXTENT) { step = Math.min(300, step * 1.12); v -= step; out.unshift(Math.max(-EXTENT, v)); }
  step = 10; v = hi;
  while (v < EXTENT) { step = Math.min(300, step * 1.12); v += step; out.push(Math.min(EXTENT, v)); }
  return out;
}

const PALETTE: [number, number, number][] = [
  [0.3, 0.11, 0.03], // burnt orange
  [0.24, 0.05, 0.03], // red maple
  [0.33, 0.21, 0.04], // gold hickory
  [0.04, 0.07, 0.04], // evergreen
  [0.15, 0.09, 0.04], // russet oak
];

export interface World { group: THREE.Group; height: (x: number, z: number) => number }

export function buildWorld(lot: TerrainFn): World {
  // height: the lot's own terrain blends into the hills over 300 ft, and sits 1 ft under the lot mesh at its edge
  const height = (x: number, z: number) => {
    const d = lotDist(x, z);
    if (d < 300) {
      const w = sstep(0, 300, d);
      return (lot.height(x, z) - 1) * (1 - w) + hills(x, z) * w;
    }
    return hills(x, z);
  };

  const xs = axis(LOT.x0, LOT.x1), zs = axis(LOT.z0, LOT.z1);
  const NX = xs.length, NZ = zs.length;
  const pos = new Float32Array(NX * NZ * 3), col = new Float32Array(NX * NZ * 3), uv = new Float32Array(NX * NZ * 2);
  const c = new THREE.Color();
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const x = xs[i], z = zs[j], y = height(x, z), k = j * NX + i;
    pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
    uv[k * 2] = x; uv[k * 2 + 1] = -z;
    // fall color in patches ~400 ft across; evergreens favor the higher ground
    const a = fbm2(x / 420, z / 420, 3, 61) * 0.7 + fbm2(x / 110, z / 110, 2, 64) * 0.3, b = fbm2(x / 260, z / 260, 2, 62);
    const ever = sstep(0.55, 0.72, b + (y - LAKE_Y) / 3000);
    const t = clamp(a * 4.2 - 1.1, 0, 3.999), i0 = Math.floor(t), f = t - i0;
    const p0 = PALETTE[[0, 2, 1, 4, 0][i0]], p1 = PALETTE[[2, 1, 4, 0, 2][i0]];
    c.setRGB(p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f, p0[2] + (p1[2] - p0[2]) * f);
    c.lerp(new THREE.Color(...PALETTE[3]), ever);
    // a rocky, grassy band right at the waterline
    const shore = 1 - sstep(LAKE_Y + 2, LAKE_Y + 14, y);
    c.lerp(new THREE.Color(0.11, 0.1, 0.09), shore);
    col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
  }
  const idx: number[] = [];
  const inLot = (i: number, j: number) => xs[i] >= LOT.x0 + 6 && xs[i + 1] <= LOT.x1 - 6 && zs[j] >= LOT.z0 + 6 && zs[j + 1] <= LOT.z1 - 6;
  for (let j = 0; j < NZ - 1; j++) for (let i = 0; i < NX - 1; i++) {
    if (inLot(i, j)) continue; // the detailed lot terrain covers this cell
    const a = j * NX + i, b = a + 1, d = a + NX, e = d + 1;
    // skip cells entirely under the lake
    if (Math.max(pos[a * 3 + 1], pos[b * 3 + 1], pos[d * 3 + 1], pos[e * 3 + 1]) < LAKE_Y - 3) continue;
    idx.push(a, d, b, b, d, e);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = material('forest', 'ext') as THREE.MeshStandardMaterial;
  mat.vertexColors = true;
  const hillsMesh = new THREE.Mesh(geo, mat);
  hillsMesh.name = 'world:hills'; hillsMesh.receiveShadow = true;

  const group = new THREE.Group(); group.name = 'world';
  group.add(hillsMesh, ridges());
  return { group, height };
}

/**
 * Blue Ridge silhouettes: three rings of mountains at 7,500 / 9,500 / 11,500 ft, each a band of
 * peaks 900–3,400 ft above the lake. Faces lean toward the house so the sky light catches them.
 */
function ridges() {
  const pos: number[] = [], nrm: number[] = [], idx: number[] = [];
  const SEG = 540;
  [[7500, 900, 2100, 71], [9500, 1400, 2800, 72], [11500, 1900, 3400, 73]].forEach(([R, h0, h1, seed]) => {
    const base = pos.length / 3;
    for (let k = 0; k <= SEG; k++) {
      const a = (k / SEG) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const n = fbm2(Math.cos(a) * 6 + seed, Math.sin(a) * 6, 5, seed);
      const sharp = 1 - Math.abs(fbm2(ca * 14, sa * 14 + seed, 3, seed + 1) * 2 - 1);
      const top = LAKE_Y + h0 + (h1 - h0) * (n * 0.8 + sharp * 0.25);
      const x = ca * R, z = sa * R, x2 = ca * (R - 1800), z2 = sa * (R - 1800);
      pos.push(x2, LAKE_Y - 20, z2, x, top, z);
      // normal: toward the center and up
      const nx = -ca * 0.55, nz = -sa * 0.55, ny = 0.83;
      nrm.push(nx, ny, nz, nx, ny, nz);
      if (k < SEG) { const i = base + k * 2; idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2); }
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setIndex(idx);
  const m = new THREE.Mesh(geo, material('ridge', 'ext'));
  m.name = 'world:ridges';
  return m;
}
