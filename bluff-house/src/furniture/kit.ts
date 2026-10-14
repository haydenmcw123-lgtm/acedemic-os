import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/**
 * A tiny modelling kit for furniture, ported from the reference prototype's helpers. Every piece is
 * built in item-local feet: the floor is y = 0 and the front faces +z. A mesh's material is a key
 * from the material library, or a role ("@up" upholstery, "@wood", "@rug"…) that the catalog
 * resolves per item, so staging can swap finishes without rebuilding geometry.
 *
 * UV modes: "box" (default) projects UVs from the local position in feet along the dominant normal
 * axis, so textures keep their real-world scale; "keep" leaves the primitive's 0..1 UVs (art,
 * screens, leaf cards); "fit" stretches 0..1 across the mesh's footprint (rugs).
 */
export type UvMode = 'box' | 'keep' | 'fit';

/** A book or bottle to be instanced later (item-local placement). */
export interface Prop { kind: 'book' | 'bottle' | 'bottleLying'; x: number; y: number; z: number; w: number; h: number; d: number; c: number }

export class Kit {
  /**
   * Level of detail for the kits built while this is set: 'lo' makes the far-away twin of each
   * piece (plain boxes instead of rounded ones, 6-sided cylinders, coarse spheres) — the same
   * shapes and extents with a fraction of the triangles.
   */
  static detail: 'hi' | 'lo' = 'hi';
  readonly g = new THREE.Group();
  readonly props: Prop[] = [];

  mesh(geo: THREE.BufferGeometry, mat: string, opts: { uv?: UvMode; cast?: boolean } = {}) {
    const o = new THREE.Mesh(geo);
    o.userData.mat = mat; o.userData.uv = opts.uv ?? 'box'; o.userData.cast = opts.cast ?? true;
    this.g.add(o);
    return o;
  }
  /** Rounded box; (x, y, z) is the bottom center. */
  rb(mat: string, w: number, h: number, d: number, x: number, y: number, z: number, r = 0.05, ry = 0) {
    const rr = Math.max(0.001, Math.min(r, w / 2 - 0.002, h / 2 - 0.002, d / 2 - 0.002));
    const soft = mat === '@up' || mat === '@duvet' || mat === 'sheet' || mat === '@accent';
    const geo = r > 0 && Kit.detail === 'hi' ? new RoundedBoxGeometry(w, h, d, soft ? 2 : 1, rr) : new THREE.BoxGeometry(w, h, d);
    const o = this.mesh(geo, mat);
    o.position.set(x, y + h / 2, z); o.rotation.y = ry;
    return o;
  }
  bx(mat: string, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0) { return this.rb(mat, w, h, d, x, y, z, 0, ry); }
  /** Vertical cylinder; (x, y, z) is the bottom center. */
  cy(mat: string, rt: number, rb: number, h: number, x: number, y: number, z: number, seg = 16) {
    const o = this.mesh(new THREE.CylinderGeometry(rt, rb, h, lod(seg)), mat);
    o.position.set(x, y + h / 2, z);
    return o;
  }
  /** Cylinder lying along an axis, centered at (x, y, z). */
  cyc(mat: string, r: number, len: number, x: number, y: number, z: number, axis: 'x' | 'y' | 'z' = 'x', seg = 14) {
    const o = this.mesh(new THREE.CylinderGeometry(r, r, len, lod(seg)), mat);
    o.position.set(x, y, z);
    if (axis === 'x') o.rotation.z = Math.PI / 2; else if (axis === 'z') o.rotation.x = Math.PI / 2;
    return o;
  }
  sp(mat: string, r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, det = 14) {
    const d = Kit.detail === 'hi' ? det : Math.min(det, 8);
    const o = this.mesh(new THREE.SphereGeometry(r, d, Math.max(Kit.detail === 'hi' ? 6 : 4, (d * 0.75) | 0)), mat);
    o.position.set(x, y, z); o.scale.set(sx, sy, sz);
    return o;
  }
  plane(mat: string, w: number, h: number, x: number, y: number, z: number, ry = 0, rx = 0, uv: UvMode = 'keep', cast = false) {
    const o = this.mesh(new THREE.PlaneGeometry(w, h), mat, { uv, cast });
    o.position.set(x, y, z); o.rotation.set(rx, ry, 0, 'YXZ');
    return o;
  }
  torus(mat: string, r: number, tube: number, x: number, y: number, z: number, rx = 0, ry = 0, arc = Math.PI * 2) {
    const o = this.mesh(Kit.detail === 'hi' ? new THREE.TorusGeometry(r, tube, 6, 24, arc) : new THREE.TorusGeometry(r, tube, 4, 10, arc), mat);
    o.position.set(x, y, z); o.rotation.set(rx, ry, 0);
    return o;
  }
}

/** Cylinder sides at the current detail: far away, 6 is round enough. */
const lod = (seg: number) => (Kit.detail === 'hi' ? seg : Math.min(seg, 6));

const _n = new THREE.Vector3();

/**
 * Bakes a kit mesh into a plain non-indexed geometry (position, normal, uv) transformed by `m`,
 * with UVs computed in the item's local feet before the transform.
 */
export function bakeMesh(mesh: THREE.Mesh, local: THREE.Matrix4, world: THREE.Matrix4): THREE.BufferGeometry {
  const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
  src.applyMatrix4(local);
  const pos = src.attributes.position as THREE.BufferAttribute, nrm = src.attributes.normal as THREE.BufferAttribute;
  const mode = mesh.userData.uv as UvMode;
  let uv: THREE.BufferAttribute;
  if (mode === 'keep' && src.attributes.uv) uv = src.attributes.uv as THREE.BufferAttribute;
  else if (mode === 'fit') {
    src.computeBoundingBox();
    const b = src.boundingBox!, sx = b.max.x - b.min.x || 1, sz = b.max.z - b.min.z || 1;
    uv = new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2);
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) - b.min.x) / sx, 1 - (pos.getZ(i) - b.min.z) / sz);
  } else {
    uv = new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2);
    for (let i = 0; i < pos.count; i += 3) {
      // one projection per triangle (by its face normal) so a face never smears across two axes
      _n.set(0, 0, 0);
      for (let k = 0; k < 3; k++) _n.x += nrm.getX(i + k), _n.y += nrm.getY(i + k), _n.z += nrm.getZ(i + k);
      const ax = Math.abs(_n.x), ay = Math.abs(_n.y), az = Math.abs(_n.z);
      for (let k = i; k < i + 3; k++) {
        const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k);
        if (ay >= ax && ay >= az) uv.setXY(k, x, z);
        else if (ax >= az) uv.setXY(k, z, y);
        else uv.setXY(k, x, y);
      }
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', pos);
  out.setAttribute('normal', nrm);
  out.setAttribute('uv', uv);
  out.applyMatrix4(world);
  return out;
}
