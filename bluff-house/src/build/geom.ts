import * as THREE from 'three';

/**
 * Visibility groups used for level culling.
 * - L0i / L1i / L2i: interior faces of that level (hidden when you are two levels away)
 * - stair: the stair hall (seen through the open well from every level)
 * - shell: everything facing outdoors, glazing, roof
 * - site: terrain, decks, pool, dock
 */
export type GroupKey = 'L0i' | 'L1i' | 'L2i' | 'stair' | 'shell' | 'site';
export const GROUP_KEYS: GroupKey[] = ['L0i', 'L1i', 'L2i', 'stair', 'shell', 'site'];
export const interiorGroup = (level: number): GroupKey => (['L0i', 'L1i', 'L2i'] as const)[level];

type V3 = [number, number, number];

interface Bucket { group: GroupKey; mat: string; pos: number[]; nrm: number[]; uv: number[]; castShadow: boolean }

/** Material keys for the six faces of an axis-aligned box: +x, -x, +y, -y, +z, -z. null skips a face. */
export interface BoxFaces { px?: string | null; nx?: string | null; py?: string | null; ny?: string | null; pz?: string | null; nz?: string | null }
export interface BoxGroups { px?: GroupKey; nx?: GroupKey; py?: GroupKey; ny?: GroupKey; pz?: GroupKey; nz?: GroupKey }

/**
 * Accumulates architecture triangles into buckets keyed by (visibility group, material),
 * with world-projected UVs in feet so every texture keeps its real-world scale.
 * One bucket becomes one mesh: static architecture is merged by material from the start.
 */
export class GeoBuilder {
  private buckets = new Map<string, Bucket>();

  private bucket(group: GroupKey, mat: string, castShadow = true): Bucket {
    const k = group + '|' + mat + '|' + (castShadow ? 1 : 0);
    let b = this.buckets.get(k);
    if (!b) { b = { group, mat, pos: [], nrm: [], uv: [], castShadow }; this.buckets.set(k, b); }
    return b;
  }

  /** Quad from 4 corners in counter-clockwise order seen from the front (normal side). */
  quad(group: GroupKey, mat: string, p0: V3, p1: V3, p2: V3, p3: V3, cast = true) {
    const b = this.bucket(group, mat, cast);
    const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
    const bx = p3[0] - p0[0], by = p3[1] - p0[1], bz = p3[2] - p0[2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (const p of [p0, p1, p2, p0, p2, p3]) {
      b.pos.push(p[0], p[1], p[2]); b.nrm.push(nx, ny, nz);
      const [u, v] = worldUV(p, nx, ny, nz); b.uv.push(u, v);
    }
  }

  tri(group: GroupKey, mat: string, p0: V3, p1: V3, p2: V3, cast = true) {
    const b = this.bucket(group, mat, cast);
    const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
    const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (const p of [p0, p1, p2]) { b.pos.push(...p); b.nrm.push(nx, ny, nz); const [u, v] = worldUV(p, nx, ny, nz); b.uv.push(u, v); }
  }

  /** Axis-aligned box with per-face material and group. */
  box(min: V3, max: V3, faces: BoxFaces, groups: BoxGroups | GroupKey, cast = true) {
    const [x0, y0, z0] = min, [x1, y1, z1] = max;
    if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4 || z1 - z0 < 1e-4) return;
    const g = (k: keyof BoxGroups): GroupKey => (typeof groups === 'string' ? groups : groups[k] ?? 'shell');
    if (faces.px) this.quad(g('px'), faces.px, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], cast);
    if (faces.nx) this.quad(g('nx'), faces.nx, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], cast);
    if (faces.py) this.quad(g('py'), faces.py, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], cast);
    if (faces.ny) this.quad(g('ny'), faces.ny, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], cast);
    if (faces.pz) this.quad(g('pz'), faces.pz, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], cast);
    if (faces.nz) this.quad(g('nz'), faces.nz, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], cast);
  }

  /** Box with one material on every face. */
  solid(min: V3, max: V3, mat: string, group: GroupKey, cast = true) {
    this.box(min, max, { px: mat, nx: mat, py: mat, ny: mat, pz: mat, nz: mat }, group, cast);
  }

  /** Box rotated about +y around its own center (cx, cz). Used for doors, the bookcase leaf, sloped parts are separate. */
  orientedBox(cx: number, cz: number, y0: number, y1: number, hw: number, hd: number, rot: number, mat: string, group: GroupKey, cast = true) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const P = (lx: number, ly: number, lz: number): V3 => [cx + lx * c + lz * s, ly, cz - lx * s + lz * c];
    const xs = [-hw, hw], zs = [-hd, hd];
    // +x, -x, +z, -z sides, top, bottom
    this.quad(group, mat, P(xs[1], y0, zs[1]), P(xs[1], y0, zs[0]), P(xs[1], y1, zs[0]), P(xs[1], y1, zs[1]), cast);
    this.quad(group, mat, P(xs[0], y0, zs[0]), P(xs[0], y0, zs[1]), P(xs[0], y1, zs[1]), P(xs[0], y1, zs[0]), cast);
    this.quad(group, mat, P(xs[0], y0, zs[1]), P(xs[1], y0, zs[1]), P(xs[1], y1, zs[1]), P(xs[0], y1, zs[1]), cast);
    this.quad(group, mat, P(xs[1], y0, zs[0]), P(xs[0], y0, zs[0]), P(xs[0], y1, zs[0]), P(xs[1], y1, zs[0]), cast);
    this.quad(group, mat, P(xs[0], y1, zs[1]), P(xs[1], y1, zs[1]), P(xs[1], y1, zs[0]), P(xs[0], y1, zs[0]), cast);
    this.quad(group, mat, P(xs[0], y0, zs[0]), P(xs[1], y0, zs[0]), P(xs[1], y0, zs[1]), P(xs[0], y0, zs[1]), cast);
  }

  /** Box whose long axis runs from a to b (any direction), with cross-section w (horizontal) × h (vertical). */
  beam(a: V3, b: V3, w: number, h: number, mat: string, group: GroupKey, cast = true) {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = d.length(); if (len < 1e-4) return;
    d.normalize();
    const side = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0));
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0); side.normalize();
    const up = new THREE.Vector3().crossVectors(side, d).normalize();
    const c = (s: number, u: number, t: number): V3 => {
      const p = new THREE.Vector3(...a).addScaledVector(side, s * w / 2).addScaledVector(up, u * h / 2).addScaledVector(d, t * len);
      return [p.x, p.y, p.z];
    };
    this.quad(group, mat, c(1, -1, 0), c(1, -1, 1), c(1, 1, 1), c(1, 1, 0), cast);
    this.quad(group, mat, c(-1, -1, 1), c(-1, -1, 0), c(-1, 1, 0), c(-1, 1, 1), cast);
    this.quad(group, mat, c(-1, 1, 0), c(1, 1, 0), c(1, 1, 1), c(-1, 1, 1), cast);
    this.quad(group, mat, c(-1, -1, 1), c(1, -1, 1), c(1, -1, 0), c(-1, -1, 0), cast);
    this.quad(group, mat, c(-1, -1, 0), c(1, -1, 0), c(1, 1, 0), c(-1, 1, 0), cast);
    this.quad(group, mat, c(1, -1, 1), c(-1, -1, 1), c(-1, 1, 1), c(1, 1, 1), cast);
  }

  /** Builds one mesh per (group, material) bucket. */
  build(materialFor: (key: string) => THREE.Material): Map<GroupKey, THREE.Group> {
    const groups = new Map<GroupKey, THREE.Group>();
    for (const k of GROUP_KEYS) { const g = new THREE.Group(); g.name = k; groups.set(k, g); }
    for (const b of this.buckets.values()) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, materialFor(b.mat));
      m.name = b.group + ':' + b.mat;
      m.castShadow = b.castShadow; m.receiveShadow = true;
      m.userData.mat = b.mat;
      groups.get(b.group)!.add(m);
    }
    return groups;
  }

  stats() {
    let tris = 0; for (const b of this.buckets.values()) tris += b.pos.length / 9;
    return { buckets: this.buckets.size, tris };
  }
}

/** Planar UVs in feet: floors use (x, -z); walls use horizontal distance along the face and height. */
function worldUV(p: V3, nx: number, ny: number, nz: number): [number, number] {
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  if (ay >= ax && ay >= az) return [p[0], -p[2]];
  if (ax >= az) return [-p[2] * Math.sign(nx || 1), p[1]];
  return [p[0] * Math.sign(nz || 1), p[1]];
}

/**
 * Collision triangles. Everything solid goes in here (walls, glass, rails, floors, terrain,
 * invisible stair ramps); the controller decides per triangle whether it is ground or wall.
 */
export class ColliderBuilder {
  readonly pos: number[] = [];

  tri(a: V3, b: V3, c: V3) { this.pos.push(...a, ...b, ...c); }
  quad(a: V3, b: V3, c: V3, d: V3) { this.tri(a, b, c); this.tri(a, c, d); }

  box(min: V3, max: V3) {
    const [x0, y0, z0] = min, [x1, y1, z1] = max;
    if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4 || z1 - z0 < 1e-4) return;
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]);
  }

  /** Upward-facing walkable rectangle at height y. */
  floor(x0: number, z0: number, x1: number, z1: number, y: number) {
    this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]);
  }

  /** Walkable ramp: a rectangle whose height varies linearly along `axis` from y0 at s0 to y1 at s1. */
  ramp(x0: number, z0: number, x1: number, z1: number, axis: 'x' | 'z', s0: number, s1: number, y0: number, y1: number) {
    const h = (x: number, z: number) => { const p = axis === 'x' ? x : z; const t = Math.min(1, Math.max(0, (p - s0) / (s1 - s0))); return y0 + (y1 - y0) * t; };
    const a: V3 = [x0, h(x0, z1), z1], b: V3 = [x1, h(x1, z1), z1], c: V3 = [x1, h(x1, z0), z0], d: V3 = [x0, h(x0, z0), z0];
    this.quad(a, b, c, d);
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    return g;
  }
}
