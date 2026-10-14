import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { DynamicBlocker } from '../build/context';
import type { GroupKey } from '../build/geom';
import { FLOOR_Y } from '../data/house';
import type { HouseData } from '../data/types';
import { flatMaterial, flatParams, INTERIOR_MATERIALS, LOOSE_MATERIALS, material } from '../materials/library';
import { CATALOG, RUG_LABELS, RUG_PATTERNS, UPHOLSTERY_FINISHES, UPHOLSTERY_LABELS, type Staging } from './catalog';
import { bakeMesh, Kit, type Prop } from './kit';

/** One placed piece of furniture, in world space. */
interface Bucket { group: GroupKey; mat: string; cast: boolean; loose: boolean; lo: boolean; parts: THREE.BufferGeometry[]; mesh: THREE.Mesh | null }
/** Furniture LOD distance (ft from a floor's furniture bounds). */
const LOD_FAR = 50;

export interface PlacedItem {
  id: number;
  room: string;
  name: string;
  builtIn: boolean;
  group: GroupKey;
  level: number; // -1 outdoors
  x: number; z: number; y: number; rot: number;
  size: [number, number, number];
  staging: Staging;
  roles: Record<string, string>;
  parts: { geo: THREE.BufferGeometry; mat: string; cast: boolean }[];
  /** The same pieces at low detail, drawn when the item's floor is seen from far away (LOD). */
  lo: { geo: THREE.BufferGeometry; mat: string; cast: boolean }[];
  /** Oriented footprint (center, half extents, rotation about y) and height range, in world feet. */
  obb: { cx: number; cz: number; hw: number; hd: number; rot: number; y0: number; y1: number };
  blocker: DynamicBlocker | null;
  /** Fraction of non-uniform scale needed to fit the size box (0 = proportional). */
  stretch: number;
  /** A downloaded model standing in for the parametric one, when present. */
  model?: THREE.Object3D;
}

const BOOK_COLORS = [0x6e2f24, 0x2f4a5c, 0xc9b48e, 0x3f5a3a, 0xd8d1c3, 0x8a6b3d, 0x2b2b2b, 0xa1442d, 0x5c4e6a, 0xe2ddd1, 0xb18a52];
const BOTTLE_COLORS = [0x1d2a1d, 0x2a1d14, 0x22301f, 0x3a2414, 0x14181a, 0x4a3a1a];
const FADE_S = 0.4;

const _m = new THREE.Matrix4(), _l = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
const _box = new THREE.Box3();

/**
 * Places every item in `furnitureByRoom` from the JSON: builds its model, fits it to the item's size
 * box (logging anything that needs >15% non-uniform scale), and merges geometry by (level × material)
 * so a whole floor of furniture costs a few dozen draw calls. Books and bottles are instanced.
 *
 * Built-ins (cabinets, islands, vanities, closets, bookcases…) always stay. Loose furniture uses its
 * own copies of the materials so the Furnished toggle can fade it out and back in over 400 ms.
 */
export class Furniture {
  readonly items: PlacedItem[] = [];
  readonly blockers: DynamicBlocker[] = [];
  /** Merged loose-furniture meshes per group (for fading and the reflection pass). */
  readonly looseMeshes: THREE.Mesh[] = [];
  readonly report: string[] = [];
  furnished = true;
  private fade = 1;
  private target = 1;
  private buckets = new Map<string, Bucket>();
  /** Per group: the hi and lo detail sets, the furniture's bounds, and which one is showing. */
  private lods: { hi: THREE.Group; lo: THREE.Group; box: THREE.Box3; far: boolean }[] = [];
  private lodByGroup = new Map<GroupKey, Furniture['lods'][number]>();
  /** Set when shadows need one re-render (items appeared, vanished or changed). */
  shadowsDirty = false;

  constructor(data: HouseData, private groups: Map<GroupKey, THREE.Group>) {
    const levelOf = new Map(data.rooms.map((r) => [r.id, r.level]));
    const props: { kind: Prop['kind']; group: GroupKey; m: THREE.Matrix4; c: number }[] = [];
    let id = 0, seed = 1;
    for (const [room, list] of Object.entries(data.furnitureByRoom)) {
      for (const it of list) {
        const entry = CATALOG[it.name];
        if (!entry) { this.report.push(`no catalog entry for "${it.name}" (${room})`); continue; }
        const level = room === 'exterior' ? -1 : levelOf.get(room) ?? 1;
        const group: GroupKey = level < 0 ? 'site' : (`L${level}i` as GroupKey);
        const size = it.size as [number, number, number];
        const sd = seed++;
        const kit = entry.build(size, sd);

        // local bounds of the model as built
        kit.g.updateMatrixWorld(true);
        _box.makeEmpty();
        for (const o of kit.g.children) _box.expandByObject(o);
        const bw = _box.max.x - _box.min.x, bh = _box.max.y - _box.min.y, bd = _box.max.z - _box.min.z;
        const sx = size[0] / bw, sy = size[1] / bh, sz = size[2] / bd;
        const flat = size[1] < 0.3; // rugs, mats: only the footprint matters
        const sc = flat ? [sx, sz] : [sx, sy, sz];
        const stretch = Math.max(...sc) / Math.min(...sc) - 1;
        if (stretch > 0.15) this.report.push(`${it.name} in ${room}: needs ${(stretch * 100).toFixed(0)}% non-uniform scale (${bw.toFixed(2)}×${bh.toFixed(2)}×${bd.toFixed(2)} → ${size.join('×')})`);

        const rot = THREE.MathUtils.degToRad(it.rotDeg ?? 0);
        const baseY = it.y ?? (level < 0 ? 0 : FLOOR_Y[level]);
        // world = T(x, y, z) · R(rot) · S(fit) · T(-center, -minY)
        _l.makeTranslation(-(_box.min.x + _box.max.x) / 2, -_box.min.y, -(_box.min.z + _box.max.z) / 2);
        _m.compose(_v.set(it.x, baseY, it.z), _q.setFromAxisAngle(_s.set(0, 1, 0), rot), _s.set(sx, sy, sz)).multiply(_l);

        const roles = { ...(entry.roles ?? {}) };
        const parts: PlacedItem['parts'] = [];
        for (const o of kit.g.children as THREE.Mesh[]) {
          parts.push({ geo: bakeMesh(o, o.matrixWorld, _m), mat: o.userData.mat, cast: o.userData.cast });
        }
        // the far-away twin: same builder, same seed, low detail, fitted with the same transform
        Kit.detail = 'lo';
        const lk = entry.build(size, sd);
        Kit.detail = 'hi';
        lk.g.updateMatrixWorld(true);
        const lo: PlacedItem['lo'] = (lk.g.children as THREE.Mesh[]).map((o) => ({ geo: bakeMesh(o, o.matrixWorld, _m), mat: o.userData.mat, cast: o.userData.cast }));
        for (const p of kit.props) {
          const pm = new THREE.Matrix4();
          if (p.kind === 'book') pm.compose(_v.set(p.x, p.y + p.h / 2, p.z), _q.identity(), _s.set(p.w, p.h, p.d));
          else if (p.kind === 'bottle') pm.makeTranslation(p.x, p.y, p.z);
          else pm.makeRotationX(Math.PI / 2).setPosition(p.x, p.y + 0.12, p.z);
          props.push({ kind: p.kind, group, m: _m.clone().multiply(pm), c: p.c });
        }

        const item: PlacedItem = {
          id: id++, room, name: it.name, builtIn: !!it.builtIn, group, level,
          x: it.x, z: it.z, y: baseY, rot, size, staging: entry.staging ?? null, roles, parts, lo, stretch,
          obb: { cx: it.x, cz: it.z, hw: size[0] / 2, hd: size[2] / 2, rot, y0: baseY, y1: baseY + size[1] },
          blocker: null,
        };
        item.blocker = this.makeBlocker(item, entry.collide ?? 'box');
        if (item.blocker) this.blockers.push(item.blocker);
        this.items.push(item);
        for (const p of parts) this.addPart(item, p);
        for (const p of lo) this.addPart(item, p, true);
        const l = this.lod(group);
        const rr = Math.max(size[0], size[2]) / 2; // any rotation
        l.box.expandByPoint(_v.set(it.x - rr, baseY, it.z - rr)).expandByPoint(_v.set(it.x + rr, baseY + size[1], it.z + rr));
      }
    }
    for (const b of this.buckets.values()) this.rebuild(b);
    this.buildProps(props);
  }

  /** Collision: the whole box for most pieces; plants at the pot and umbrellas at the pole only. */
  private makeBlocker(it: PlacedItem, kind: string): DynamicBlocker | null {
    if (kind === 'none') return null;
    const floor = it.level < 0 ? it.y : FLOOR_Y[it.level];
    if (it.y - floor > 1.5 || it.size[1] < 0.3) return null; // wall-mounted or flat
    if (kind === 'pot') return { cx: it.x, cz: it.z, hw: 0.85, hd: 0.85, rot: 0, y0: it.y, y1: it.y + 2, enabled: true };
    if (kind === 'pole') return { cx: it.x, cz: it.z, hw: 0.45, hd: 0.45, rot: 0, y0: it.y, y1: it.y + 8, enabled: true };
    const shrink = it.builtIn ? 0.05 : 0.15;
    return { cx: it.x, cz: it.z, hw: Math.max(0.1, it.size[0] / 2 - shrink), hd: Math.max(0.1, it.size[2] / 2 - shrink), rot: it.rot, y0: it.y, y1: it.y + it.size[1], enabled: true };
  }

  private resolve(it: PlacedItem, mat: string) { return mat.startsWith('@') ? it.roles[mat] ?? 'white' : mat; }

  private bucketKey(it: PlacedItem, mat: string, cast: boolean, lo = false) { return `${it.group}|${mat}|${cast ? 1 : 0}|${it.builtIn ? 'b' : 'l'}${lo ? '|lo' : ''}`; }

  /** The hi / lo detail groups for a level group (created on first use). */
  private lod(g: GroupKey) {
    let l = this.lodByGroup.get(g);
    if (!l) {
      const hi = new THREE.Group(), lo = new THREE.Group();
      hi.name = 'furniture:hi'; lo.name = 'furniture:lo'; lo.visible = false;
      this.groups.get(g)!.add(hi, lo);
      l = { hi, lo, box: new THREE.Box3(), far: false };
      this.lodByGroup.set(g, l); this.lods.push(l);
    }
    return l;
  }

  /**
   * Furniture LOD: each floor's furniture shows its low-detail twin while the camera is more than
   * ~50 ft from that floor's furniture (the lawn, the dock, the water), with 8 ft of hysteresis.
   * Same buckets either way, so the draw-call count does not change; only the triangles do.
   */
  updateLod(cam: THREE.Vector3) {
    for (let i = 0; i < this.lods.length; i++) {
      const l = this.lods[i], d = l.box.distanceToPoint(cam);
      const far = l.far ? d > LOD_FAR - 8 : d > LOD_FAR;
      if (far === l.far) continue;
      l.far = far; l.hi.visible = !far; l.lo.visible = far;
      this.shadowsDirty = true;
    }
  }

  private addPart(it: PlacedItem, p: PlacedItem['parts'][number], lo = false) {
    let mat = this.resolve(it, p.mat);
    // plain finishes share one vertex-colored material per floor (roles stay separate: staging swaps them)
    const flat = p.mat.startsWith('@') ? null : flatParams(mat);
    if (flat) {
      if (!p.geo.attributes.pbr) {
        const n = p.geo.attributes.position.count, col = new Float32Array(n * 3), pbr = new Float32Array(n * 2);
        for (let i = 0; i < n; i++) { col[i * 3] = flat.color.r; col[i * 3 + 1] = flat.color.g; col[i * 3 + 2] = flat.color.b; pbr[i * 2] = flat.rough; pbr[i * 2 + 1] = flat.metal; }
        p.geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        p.geo.setAttribute('pbr', new THREE.BufferAttribute(pbr, 2));
      }
      mat = '@flat';
    }
    const k = this.bucketKey(it, mat, p.cast, lo);
    let b = this.buckets.get(k);
    if (!b) { b = { group: it.group, mat, cast: p.cast, loose: !it.builtIn, lo, parts: [], mesh: null }; this.buckets.set(k, b); }
    b.parts.push(p.geo);
    return b;
  }

  private rebuild(b: Bucket) {
    if (b.mesh) { b.mesh.geometry.dispose(); b.mesh.parent?.remove(b.mesh); const i = this.looseMeshes.indexOf(b.mesh); if (i >= 0) this.looseMeshes.splice(i, 1); b.mesh = null; }
    if (!b.parts.length) return;
    const geo = mergeGeometries(b.parts, false)!;
    geo.computeBoundingSphere();
    const variant = b.group === 'site' ? 'ext' : 'int';
    const mat = b.mat === '@flat' ? flatMaterial(variant, b.loose ? 'loose' : 'arch') : material(b.mat, variant, b.loose ? 'loose' : 'arch');
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `furniture:${b.group}:${b.mat}${b.loose ? '' : ':builtin'}${b.lo ? ':lo' : ''}`;
    mesh.castShadow = b.cast && mat.userData.castShadow !== false;
    mesh.receiveShadow = true;
    if (mat.userData.depthMat) mesh.customDepthMaterial = mat.userData.depthMat;
    mesh.userData.furniture = true;
    mesh.visible = !b.loose || this.fade > 0;
    (b.lo ? this.lod(b.group).lo : this.lod(b.group).hi).add(mesh);
    if (b.loose) this.looseMeshes.push(mesh);
    b.mesh = mesh;
  }

  private buildProps(props: { kind: Prop['kind']; group: GroupKey; m: THREE.Matrix4; c: number }[]) {
    const book = new THREE.BoxGeometry(1, 1, 1);
    // a wine bottle: body, shoulder and neck, 3 in across and 12 in tall, standing on its base
    const bottle = mergeGeometries([
      new THREE.CylinderGeometry(0.125, 0.125, 0.75, 10).translate(0, 0.375, 0),
      new THREE.CylinderGeometry(0.045, 0.125, 0.18, 10).translate(0, 0.84, 0),
      new THREE.CylinderGeometry(0.045, 0.045, 0.3, 8).translate(0, 1.08, 0),
    ])!;
    const lying = bottle.clone().translate(0, -0.6, 0); // centered on its length, then laid along z by the matrix
    const groups = new Map<string, typeof props>();
    for (const p of props) { const k = p.group + '|' + (p.kind === 'book' ? 'book' : 'bottle'); (groups.get(k) ?? groups.set(k, []).get(k)!).push(p); }
    const col = new THREE.Color();
    for (const [k, list] of groups) {
      const [group, kind] = k.split('|') as [GroupKey, string];
      const isBook = kind === 'book';
      const mat = material(isBook ? 'bookcloth' : 'bottleGlass', group === 'site' ? 'ext' : 'int');
      const inst = new THREE.InstancedMesh(isBook ? book : list[0].kind === 'bottleLying' ? lying : bottle, mat, list.length);
      // lying and standing bottles can share a group: give each its own geometry by splitting
      const geoFor = (p: (typeof props)[number]) => (isBook ? book : p.kind === 'bottleLying' ? lying : bottle);
      const sameGeo = list.every((p) => geoFor(p) === geoFor(list[0]));
      if (!sameGeo) {
        const stand = list.filter((p) => p.kind === 'bottle'), lie = list.filter((p) => p.kind === 'bottleLying');
        inst.dispose();
        for (const [l, g] of [[stand, bottle], [lie, lying]] as const) if (l.length) this.addInstances(group, g, mat, l, BOTTLE_COLORS, col);
        continue;
      }
      inst.dispose();
      this.addInstances(group, geoFor(list[0]), mat, list, isBook ? BOOK_COLORS : BOTTLE_COLORS, col);
    }
  }

  private addInstances(group: GroupKey, geo: THREE.BufferGeometry, mat: THREE.Material, list: { m: THREE.Matrix4; c: number }[], pal: number[], col: THREE.Color) {
    const inst = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((p, i) => { inst.setMatrixAt(i, p.m); inst.setColorAt(i, col.setHex(pal[p.c % pal.length])); });
    inst.castShadow = false; inst.receiveShadow = true;
    inst.name = `furniture:${group}:instanced`;
    inst.computeBoundingSphere();
    this.groups.get(group)!.add(inst);
  }

  /* ---------------- staging ---------------- */

  /** 0 = empty, 1 = furnished; in between while fading. */
  get fadeLevel() { return this.fade; }

  /** Furnished ↔ Empty with a 400 ms fade. Built-ins never fade. */
  setFurnished(on: boolean, animate = true) {
    this.furnished = on;
    this.target = on ? 1 : 0;
    for (const it of this.items) if (!it.builtIn && it.blocker) it.blocker.enabled = on;
    if (!animate) { this.fade = this.target; this.applyFade(); }
    this.shadowsDirty = true;
  }

  update(dt: number) {
    if (this.fade === this.target) return;
    this.fade = this.target > this.fade ? Math.min(this.target, this.fade + dt / FADE_S) : Math.max(this.target, this.fade - dt / FADE_S);
    this.applyFade();
    if (this.fade === this.target) this.shadowsDirty = true;
  }

  private applyFade() {
    const t = this.fade, a = t * t * (3 - 2 * t);
    const partial = t > 0 && t < 1;
    for (const m of LOOSE_MATERIALS) { m.transparent = partial; m.opacity = partial ? a : 1; m.depthWrite = true; }
    for (const mesh of this.looseMeshes) mesh.visible = t > 0;
  }

  /** Cycles a sofa/bed/chair through Linen → Leather → Bouclé, or a rug through its three patterns. */
  cycle(it: PlacedItem): string | null {
    if (!it.staging) return null;
    const role = it.staging === 'rug' ? '@rug' : '@up';
    const list: readonly string[] = it.staging === 'rug' ? RUG_PATTERNS : UPHOLSTERY_FINISHES;
    const cur = it.roles[role];
    const next = list[(list.indexOf(cur) + 1) % list.length];
    // move this item's parts between merged buckets and rebuild just those
    const touched = new Set<ReturnType<Furniture['addPart']>>();
    for (const [ps, lo] of [[it.parts, false], [it.lo, true]] as const) for (const p of ps) {
      if (p.mat !== role) continue;
      const old = this.buckets.get(this.bucketKey(it, this.resolve(it, p.mat), p.cast, lo))!;
      old.parts.splice(old.parts.indexOf(p.geo), 1); touched.add(old);
    }
    it.roles[role] = next;
    if (it.model) {
      // a downloaded model: give its biggest surface the finish's color and texture
      let big: THREE.Mesh | null = null, area = 0;
      it.model.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { const s = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3()); const a = s.x * s.z + s.y * (s.x + s.z); if (a > area) { area = a; big = m; } } });
      const f = material(next, it.group === 'site' ? 'ext' : 'int') as THREE.MeshStandardMaterial, bm = big as THREE.Mesh | null;
      if (bm) { const m = bm.material as THREE.MeshStandardMaterial; m.color.copy(f.color); m.map = f.map; m.needsUpdate = true; }
    } else {
      for (const p of it.parts) if (p.mat === role) touched.add(this.addPart(it, p));
      for (const p of it.lo) if (p.mat === role) touched.add(this.addPart(it, p, true));
    }
    for (const b of touched) this.rebuild(b);
    this.shadowsDirty = true;
    return it.staging === 'rug' ? RUG_LABELS[next] : UPHOLSTERY_LABELS[next];
  }

  /** The nearest stageable item hit by a ray (tested against each item's oriented box). */
  pick(ray: THREE.Ray, maxDist: number): { item: PlacedItem; dist: number } | null {
    let best: { item: PlacedItem; dist: number } | null = null;
    const local = new THREE.Ray(), inv = new THREE.Matrix4(), hit = new THREE.Vector3(), box = new THREE.Box3();
    for (const it of this.items) {
      if (!it.staging || (!this.furnished && !it.builtIn)) continue;
      if (!this.groups.get(it.group)!.visible) continue;
      inv.makeRotationY(it.rot).setPosition(it.x, 0, it.z).invert();
      local.copy(ray).applyMatrix4(inv);
      box.min.set(-it.size[0] / 2, it.obb.y0, -it.size[2] / 2); box.max.set(it.size[0] / 2, Math.max(it.obb.y1, it.obb.y0 + 0.3), it.size[2] / 2);
      if (!local.intersectBox(box, hit)) continue;
      const d = hit.distanceTo(local.origin);
      if (d < maxDist && (!best || d < best.dist)) best = { item: it, dist: d };
    }
    return best;
  }

  /**
   * Swaps every stand-in that uses `file` (a downloaded glTF, see scripts/fetch-assets.ts) for the real
   * model, fitted to the item's size box like the stand-in was. Staging then recolors the model's
   * largest material with the chosen finish.
   */
  useModel(file: string, model: THREE.Object3D) {
    const touched = new Set<ReturnType<Furniture['addPart']>>();
    for (const it of this.items) {
      if (CATALOG[it.name]?.glb !== file || it.model) continue;
      for (const [ps, lo] of [[it.parts, false], [it.lo, true]] as const) for (const p of ps) {
        const b = this.buckets.get(this.bucketKey(it, p.geo.attributes.pbr ? '@flat' : this.resolve(it, p.mat), p.cast, lo));
        if (b) { b.parts.splice(b.parts.indexOf(p.geo), 1); touched.add(b); }
      }
      const obj = model.clone(true);
      _box.setFromObject(obj);
      const bw = _box.max.x - _box.min.x, bh = _box.max.y - _box.min.y, bd = _box.max.z - _box.min.z;
      const sx = it.size[0] / bw, sy = it.size[1] / bh, sz = it.size[2] / bd;
      const stretch = Math.max(sx, sy, sz) / Math.min(sx, sy, sz) - 1;
      if (stretch > 0.15) this.report.push(`${file} for ${it.name} in ${it.room}: needs ${(stretch * 100).toFixed(0)}% non-uniform scale — pick a better-proportioned model`);
      const inner = new THREE.Group(); inner.add(obj);
      obj.position.set(-(_box.min.x + _box.max.x) / 2, -_box.min.y, -(_box.min.z + _box.max.z) / 2);
      inner.scale.set(sx, sy, sz);
      const outer = new THREE.Group(); outer.add(inner);
      outer.position.set(it.x, it.y, it.z); outer.rotation.y = it.rot;
      outer.name = `furniture:${it.group}:model:${file}`;
      outer.userData.furniture = true;
      outer.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = true; m.receiveShadow = true;
        const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((x) => x.clone() as THREE.MeshStandardMaterial);
        m.material = Array.isArray(m.material) ? mats : mats[0];
        for (const x of mats) { if (!it.builtIn) LOOSE_MATERIALS.push(x); if (it.group !== 'site') INTERIOR_MATERIALS.push(x); }
      });
      this.groups.get(it.group)!.add(outer);
      if (!it.builtIn) this.looseMeshes.push(outer as unknown as THREE.Mesh);
      it.model = outer;
      it.stretch = stretch;
    }
    for (const b of touched) this.rebuild(b);
    this.shadowsDirty = true;
  }

  stats() {
    let tris = 0, meshes = 0, loTris = 0;
    for (const b of this.buckets.values()) if (b.mesh) { const t = b.mesh.geometry.attributes.position.count / 3; if (b.lo) loTris += t; else { tris += t; meshes++; } }
    return { items: this.items.length, meshes, tris, loTris, blockers: this.blockers.length, far: [...this.lodByGroup].filter(([, l]) => l.far).map(([g]) => g) };
  }
}
