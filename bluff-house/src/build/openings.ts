import * as THREE from 'three';
import { WALL_T } from '../data/house';
import type { Opening } from '../data/types';
import { faceGroup, type BuildContext, type DynamicBlocker } from './context';
import type { GroupKey } from './geom';

type V3 = [number, number, number];
const T2 = WALL_T / 2;

/** Bookcase door: rests ajar at this angle and swings wide as you approach so the 2-ft capsule fits through. */
export const BOOKCASE_REST_DEG = 25;
export const BOOKCASE_OPEN_DEG = 92;

/**
 * Dresses an opening cut in a wall run: frames, glass, casings, leaves, and their collision.
 * Local frame: t runs along the wall (z for axis 'x', x for axis 'z'); n is the offset across it,
 * positive toward side b (the higher-coordinate side).
 */
export function dressOpening(ctx: BuildContext, o: Opening, a: number, b: number, base: number, ia: number, ib: number) {
  const { axis, at, kind } = o;
  const y0 = base + (o.sill ?? 0), y1 = base + (o.head ?? 7.33);
  const w = b - a;
  const exterior = ia < 0 || ib < 0;
  const grp: GroupKey = exterior ? 'shell' : faceGroup(ctx, o.level, ib >= 0 ? ib : ia);
  const g = ctx.geo;

  // local → world box helpers
  const lbox = (t0: number, t1: number, yy0: number, yy1: number, n0: number, n1: number, mat: string, group: GroupKey = grp, cast = true) => {
    const min: V3 = axis === 'x' ? [at + n0, yy0, t0] : [t0, yy0, at + n0];
    const max: V3 = axis === 'x' ? [at + n1, yy1, t1] : [t1, yy1, at + n1];
    g.solid(min, max, mat, group, cast);
  };
  const lcol = (t0: number, t1: number, yy0: number, yy1: number, n0: number, n1: number) => {
    const min: V3 = axis === 'x' ? [at + n0, yy0, t0] : [t0, yy0, at + n0];
    const max: V3 = axis === 'x' ? [at + n1, yy1, t1] : [t1, yy1, at + n1];
    ctx.col.box(min, max);
  };
  const world = (t: number, n: number): [number, number] => (axis === 'x' ? [at + n, t] : [t, at + n]);

  const FW = 0.17; // steel frame face width (2")
  const frame = (t0: number, t1: number, yy0: number, yy1: number, bottom: boolean) => {
    lbox(t0, t0 + FW, yy0, yy1, -0.12, 0.12, 'steel');
    lbox(t1 - FW, t1, yy0, yy1, -0.12, 0.12, 'steel');
    lbox(t0, t1, yy1 - FW, yy1, -0.12, 0.12, 'steel');
    if (bottom) lbox(t0, t1, yy0, yy0 + FW, -0.12, 0.12, 'steel');
  };
  const mullions = (t0: number, t1: number, yy0: number, yy1: number, spacing = 4) => {
    const n = Math.max(1, Math.round((t1 - t0) / spacing));
    for (let k = 1; k < n; k++) { const t = t0 + ((t1 - t0) * k) / n; lbox(t - 0.07, t + 0.07, yy0, yy1, -0.1, 0.1, 'steel'); }
  };
  const pane = (t0: number, t1: number, yy0: number, yy1: number, n = 0) => lbox(t0, t1, yy0, yy1, n - 0.02, n + 0.02, 'glass', grp, false);
  const casing = () => {
    const cw = 0.3, ct = 0.06;
    for (const side of [-1, 1]) {
      const n0 = side > 0 ? T2 : -T2 - ct, n1 = side > 0 ? T2 + ct : -T2;
      lbox(a - cw, a, y0, y1 + cw, n0, n1, 'trim');
      lbox(b, b + cw, y0, y1 + cw, n0, n1, 'trim');
      lbox(a - cw, b + cw, y1, y1 + cw, n0, n1, 'trim');
    }
  };

  switch (kind) {
    case 'window':
    case 'glass': {
      const bottom = (o.sill ?? 0) > 0 || kind === 'glass';
      frame(a, b, y0, y1, bottom);
      mullions(a, b, y0, y1, 4);
      pane(a + FW, b - FW, y0 + (bottom ? FW : 0), y1 - FW);
      ctx.col.transparent(() => lcol(a, b, y0, y1, -0.15, 0.15));
      if ((o.sill ?? 0) > 1.5) {
        // interior stool on the room side
        const n = ib >= 0 ? 1 : -1;
        lbox(a - 0.15, b + 0.15, y0 - 0.1, y0, n > 0 ? T2 - 0.02 : -T2 - 0.35, n > 0 ? T2 + 0.35 : -T2 + 0.02, 'trim', faceGroup(ctx, o.level, ib >= 0 ? ib : ia));
      }
      break;
    }
    case 'slide': {
      // three panels; the two operable ones are stacked open behind the fixed panel at the `to` end
      frame(a, b, y0, y1, true);
      const pw = w / 3;
      for (const n of [0, -0.18, 0.18]) {
        const t1 = b - 0.05, t0 = t1 - pw;
        lbox(t0, t0 + FW, y0, y1 - FW, n - 0.06, n + 0.06, 'steel');
        lbox(t1 - FW, t1, y0, y1 - FW, n - 0.06, n + 0.06, 'steel');
        pane(t0 + FW, t1 - FW, y0 + FW, y1 - FW, n);
      }
      ctx.col.transparent(() => lcol(b - pw - 0.1, b, y0, y1, -0.3, 0.3));
      break;
    }
    case 'fold': {
      // 17-ft folding glass wall, folded open into a zig-zag stack outside at the `to` end
      frame(a, b, y0, y1, false);
      const n = 6, pw = w / n, outSide = ia < 0 ? -1 : 1;
      for (let k = 0; k < n; k++) {
        const t = b - 0.25 - k * 0.3;
        const ang = (k % 2 ? 1 : -1) * 0.12;
        const [cx, cz] = world(t, outSide * (T2 + pw / 2 + 0.05));
        const rot = axis === 'x' ? ang : Math.PI / 2 + ang;
        g.orientedBox(cx, cz, y0 + 0.08, y1 - 0.12, pw / 2, 0.03, rot, 'glass', 'shell', false);
        g.orientedBox(cx, cz, y1 - 0.25, y1 - 0.12, pw / 2, 0.06, rot, 'steel', 'shell');
        g.orientedBox(cx, cz, y0 + 0.02, y0 + 0.14, pw / 2, 0.06, rot, 'steel', 'shell');
      }
      const s0 = b - 0.25 - n * 0.3 - 0.1;
      ctx.col.transparent(() => lcol(s0, b, y0, y1, outSide > 0 ? T2 : -(T2 + pw + 0.2), outSide > 0 ? T2 + pw + 0.2 : -T2));
      break;
    }
    case 'glassdoor': {
      // frameless glass door into the wine room, held open against its hinge jamb
      frame(a, b, y0, y1, false);
      const into = ib >= 0 ? 1 : -1;
      const len = w - 0.2;
      const [cx, cz] = world(a + 0.12, into * (T2 + len / 2));
      g.orientedBox(cx, cz, y0 + 0.05, y1 - 0.2, axis === 'x' ? len / 2 : 0.03, axis === 'x' ? 0.03 : len / 2, 0, 'glass', grp, false);
      const [px, pz] = world(a + 0.12, into * (T2 + len - 0.4));
      g.orientedBox(px, pz, y0 + 3.2, y0 + 4.2, 0.04, 0.04, 0, 'brass', grp);
      const c0 = into > 0 ? T2 : -(T2 + len), c1 = into > 0 ? T2 + len : -T2;
      ctx.col.transparent(() => lcol(a, a + 0.25, y0, y1, c0, c1));
      break;
    }
    case 'door':
    case 'open': {
      casing();
      // threshold
      lbox(a, b, y0, y0 + 0.03, -T2, T2, 'trim');
      if (kind === 'door') {
        // pocket door: an open slot in the jamb on the `from` side, leaf hidden in the wall
        const slot = 0.12;
        const s0 = -slot / 2, s1 = slot / 2;
        lbox(a - 0.002, a + 0.001, y0, y1 - 0.02, s0, s1, 'slot', grp, false);
        // the leaf's edge, just visible in the slot
        lbox(a - 0.02, a + 0.08, y0 + 0.05, y1 - 0.05, -0.05, 0.05, 'leaf', grp);
      }
      break;
    }
    case 'front': {
      // 9-ft timber pivot doors, both swung in 90° around pins 6" from the outer jambs, plus glazed sidelights handled as 'glass'
      casing();
      const into = ia >= 0 && ib < 0 ? -1 : 1; // swing toward the room side
      const half = w / 2, th = 0.25, pin = 0.5;
      for (const side of [0, 1]) {
        const tp = side === 0 ? a + pin : b - pin;
        // leaf runs perpendicular to the wall from n = -pin*into to (half - pin)*into
        const nc = into * (half / 2 - pin);
        const [cx, cz] = world(tp, nc);
        const hw = axis === 'x' ? half / 2 : th / 2, hd = axis === 'x' ? th / 2 : half / 2;
        g.orientedBox(cx, cz, y0 + 0.02, y1 - 0.05, hw, hd, 0, 'door', grp);
        const n0 = Math.min(-pin * into, (half - pin) * into), n1 = Math.max(-pin * into, (half - pin) * into);
        lcol(tp - th / 2, tp + th / 2, y0, y1, n0, n1);
        // tall bronze pull
        const [hx, hz] = world(tp + (side === 0 ? th / 2 + 0.06 : -th / 2 - 0.06), into * (half - pin - 0.45));
        g.orientedBox(hx, hz, y0 + 2.2, y0 + 6.2, 0.05, 0.05, 0, 'bronze', grp);
      }
      break;
    }
    case 'gdoor': {
      // closed insulated carriage door (wood-look), slightly recessed
      const out = ia < 0 ? -1 : 1;
      lbox(a, b, y0, y1, out > 0 ? 0.05 : -0.2, out > 0 ? 0.2 : -0.05, 'gdoor');
      lbox(a - 0.2, b + 0.2, y1, y1 + 0.3, out > 0 ? T2 : -T2 - 0.15, out > 0 ? T2 + 0.15 : -T2, 'bronze');
      lcol(a, b, y0, y1, -0.2, 0.2);
      break;
    }
    case 'bookcase':
      casing();
      lbox(a, b, y0, y0 + 0.03, -T2, T2, 'trim');
      bookcaseDoor(ctx, o, a, b, y0, y1, ia);
      break;
    case 'fireplace':
      break;
  }
}

/**
 * The hidden bookcase door into the Study: a full bookcase leaf on a pin at one jamb,
 * swinging into the room on side a. Rests ajar; opens wide when the player is near.
 */
function bookcaseDoor(ctx: BuildContext, o: Opening, a: number, b: number, y0: number, y1: number, ia: number) {
  const depth = 0.67, len = b - a - 0.08, hgt = y1 - y0 - 0.06; // 8" shelves leave a 2.3-ft clear passage
  const into = ia >= 0 ? -1 : 1; // the Study is on side a
  const up = new THREE.Vector3(0, 1, 0);
  const tDir = o.axis === 'x' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  const nDir = o.axis === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  // pivot frame: local +x along the wall away from the leaf, local +z from the pin toward the hall face
  const uz = nDir.clone().multiplyScalar(-into);
  const ux = tDir.clone();
  let pinT = b - 0.04;
  if (ux.clone().cross(up).dot(uz) < 0) { ux.negate(); pinT = a + 0.04; }
  const pivot = new THREE.Group();
  const leaf = new THREE.Group();
  pivot.add(leaf);
  const [px, pz] = axis2world(o.axis, o.at, pinT, into * (depth - T2));
  pivot.position.set(px, y0 + 0.03, pz);
  pivot.rotation.y = Math.atan2(-ux.z, ux.x);

  // leaf in local space: x in [-len, 0], z in [0, depth] (z = depth is the face seen from the hall)
  const mk = (sx: number, sy: number, sz: number, cx: number, cy: number, cz: number, mat: string) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz));
    m.position.set(cx, cy, cz); m.userData.matKey = mat; m.castShadow = true; m.receiveShadow = true; leaf.add(m);
  };
  mk(len, hgt, 0.06, -len / 2, hgt / 2, 0.03, 'bookcaseWood'); // back panel faces the Study
  mk(0.08, hgt, depth, -0.04, hgt / 2, depth / 2, 'bookcaseWood');
  mk(0.08, hgt, depth, -len + 0.04, hgt / 2, depth / 2, 'bookcaseWood');
  const shelves = 5;
  for (let k = 0; k <= shelves; k++) mk(len - 0.16, 0.07, depth - 0.06, -len / 2, (hgt * k) / shelves + 0.035, depth / 2 + 0.03, 'bookcaseWood');
  for (let k = 0; k < shelves; k++) {
    const bh = (hgt / shelves) * 0.72;
    mk(len - 0.4, bh, depth * 0.62, -len / 2, (hgt * k) / shelves + 0.07 + bh / 2, depth * 0.62, 'books');
  }

  const blocker: DynamicBlocker = { cx: 0, cz: 0, hw: len / 2, hd: depth / 2, rot: 0, y0, y1, enabled: true };
  const center = new THREE.Vector3();
  const [ox, oz] = axis2world(o.axis, o.at, (a + b) / 2, 0);
  let angle = BOOKCASE_REST_DEG;
  const apply = () => {
    leaf.rotation.y = -THREE.MathUtils.degToRad(angle); // free end swings toward local -z: into the Study
    pivot.updateMatrixWorld(true);
    center.set(-len / 2, 0, depth / 2).applyMatrix4(leaf.matrixWorld);
    const e = leaf.matrixWorld.elements;
    blocker.cx = center.x; blocker.cz = center.z; blocker.rot = Math.atan2(-e[2], e[0]);
  };
  apply();
  ctx.dynamic.push({
    object: pivot,
    blocker,
    update(x, z, feet, dt) {
      const dist = Math.abs(feet - y0) < 6 ? Math.hypot(x - ox, z - oz) : 99;
      const k = 1 - THREE.MathUtils.smoothstep(dist, 6, 12);
      const target = BOOKCASE_REST_DEG + (BOOKCASE_OPEN_DEG - BOOKCASE_REST_DEG) * k;
      angle += (target - angle) * Math.min(1, dt * 6);
      apply();
    },
  });
}

function axis2world(axis: 'x' | 'z', at: number, t: number, n: number): [number, number] {
  return axis === 'x' ? [at + n, t] : [t, at + n];
}
