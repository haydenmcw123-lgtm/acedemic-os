import { rng } from '../util/noise';
import { Kit } from './kit';

/**
 * Furniture catalog: every item name in `furnitureByRoom` maps to a parametric model, ported from
 * the reference prototype (whose builders the JSON sizes were measured from). Each builder works in
 * item-local feet (floor at y = 0, front toward +z); the placer then fits the result exactly to the
 * item's `size` box and logs any piece that needs more than 15% non-uniform scaling.
 *
 * These are the stand-ins the spec allows while the CC0 model hosts are blocked: a real glTF
 * dropped into assets/raw/ under the catalog's `glb` name replaces the parametric model.
 */
export type Staging = 'upholstery' | 'rug' | null;
export type Collide = 'box' | 'pot' | 'pole' | 'none';

export interface CatalogEntry {
  build(size: [number, number, number], seed: number): Kit;
  /** Default material for each role used by the builder. */
  roles?: Record<string, string>;
  staging?: Staging;
  collide?: Collide;
  /** File name a downloaded model would use in assets/raw/ (see scripts/fetch-assets.ts). */
  glb?: string;
}

const PI = Math.PI;

/* ------------------------------------------------------------------ seating */

function sofaParts(k: Kit, len: number, dep: number, o: { chaise?: number; legs?: string } = {}) {
  const arm = 0.55, seatY = 0.38, chaise = o.chaise ?? 0, legs = o.legs ?? 'walnut';
  k.rb('@up', len, 0.55, dep, 0, seatY - 0.08, 0, 0.12);
  if (chaise) k.rb('@up', 2.9, 0.55, chaise, len / 2 - arm - 1.45, seatY - 0.08, dep / 2 + chaise / 2 - 0.02, 0.12);
  const inner = len - 2 * arm, n = Math.max(1, Math.round(inner / 2.7)), cw = inner / n;
  for (let i = 0; i < n; i++) {
    const cx = -len / 2 + arm + cw * (i + 0.5);
    k.rb('@up', cw - 0.04, 0.5, dep - 0.95, cx, seatY + 0.44, 0.38, 0.16);
    k.rb('@up', cw - 0.08, 1.55, 0.72, cx, seatY + 0.44, -dep / 2 + 0.5, 0.22);
  }
  if (chaise) k.rb('@up', 2.85, 0.5, chaise + 0.1, len / 2 - arm - 1.45, seatY + 0.44, dep / 2 + chaise / 2 - 0.05, 0.16);
  k.rb('@up', len, 1.4, 0.5, 0, seatY + 0.3, -dep / 2 + 0.25, 0.1);
  for (const sx of [-1, 1]) k.rb('@up', arm, 1.15, dep, sx * (len / 2 - arm / 2), seatY + 0.1, 0, 0.16);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.cy(legs, 0.09, 0.07, seatY - 0.08, sx * (len / 2 - 0.3), 0, sz * (dep / 2 - 0.3), 8);
}
function pillow(k: Kit, x: number, y: number, z: number, ry: number) {
  const p = k.rb('@accent', 1.5, 1.5, 0.45, x, y, z, 0.2, ry); p.rotation.x = -0.25;
}
function sofa(len: number, dep: number, chaise = 0, legs = 'walnut') {
  const k = new Kit();
  sofaParts(k, len, dep, { chaise, legs });
  pillow(k, -len / 2 + 1.4, 0.95, -dep / 2 + 1.05, 0.3);
  pillow(k, len / 2 - 1.4, 0.95, -dep / 2 + 1.05, -0.3);
  return k;
}
function loungeChair() {
  const k = new Kit();
  k.rb('@up', 2.7, 0.55, 2.8, 0, 0.55, 0.05, 0.14);
  k.rb('@up', 2.7, 1.9, 0.5, 0, 0.8, -1.15, 0.2).rotation.x = -0.18;
  for (const sx of [-1, 1]) {
    k.rb('@up', 0.4, 0.8, 2.6, sx * 1.25, 0.75, 0, 0.12);
    k.bx('@wood', 0.14, 0.14, 2.8, sx * 1.25, 0.45, 0);
    for (const sz of [-1, 1]) k.cy('@wood', 0.07, 0.06, 0.5, sx * 1.2, 0, sz * 1.15, 8);
  }
  return k;
}
function diningChair() {
  const k = new Kit();
  k.rb('@up', 1.6, 0.3, 1.55, 0, 1.45, 0.05, 0.1);
  k.rb('@wood', 1.6, 1.3, 0.14, 0, 1.75, -0.68, 0.05).rotation.x = 0.1;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.bx('@wood', 0.14, 1.45, 0.14, sx * 0.68, 0, sz * 0.62);
  return k;
}
function stool(h: number) {
  const k = new Kit();
  k.cy('@up', 0.68, 0.62, 0.32, 0, h, 0, 20);
  k.rb('@up', 1.2, 0.8, 0.16, 0, h + 0.3, -0.55, 0.06);
  for (let i = 0; i < 4; i++) {
    const a = (i * PI) / 2 + PI / 4;
    const l = k.cy('steel', 0.045, 0.045, h, Math.cos(a) * 0.45, 0, Math.sin(a) * 0.45, 6);
    l.rotation.set(Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12);
  }
  k.torus('steel', 0.48, 0.035, 0, h * 0.35, 0, PI / 2);
  return k;
}
function bench(len: number, d: number) {
  const k = new Kit();
  k.rb('@up', len, 0.35, d, 0, 1.25, 0, 0.12);
  k.bx('walnut', len, 0.12, d - 0.1, 0, 1.13, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.bx('walnut', 0.14, 1.13, 0.14, sx * (len / 2 - 0.2), 0, sz * (d / 2 - 0.2));
  return k;
}
function officeChair() {
  const k = new Kit();
  k.rb('@up', 1.9, 0.35, 1.8, 0, 1.55, 0, 0.14);
  k.rb('@up', 1.85, 2.0, 0.35, 0, 1.95, -0.85, 0.14).rotation.x = -0.1;
  k.cy('chrome', 0.07, 0.07, 1.2, 0, 0.35, 0, 10);
  for (let i = 0; i < 5; i++) {
    const a = (i * PI * 2) / 5;
    k.bx('chrome', 1.1, 0.1, 0.14, Math.cos(a) * 0.55, 0.25, Math.sin(a) * 0.55, -a);
    k.sp('black', 0.1, Math.cos(a) * 1.05, 0.1, Math.sin(a) * 1.05, 1, 1, 1, 8);
  }
  for (const sx of [-1, 1]) k.bx('chrome', 0.1, 0.7, 1.2, sx * 0.95, 1.6, 0);
  return k;
}
function lounger() {
  const k = new Kit();
  k.bx('timber', 2.4, 0.25, 6.2, 0, 0.6, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.bx('timber', 0.2, 0.6, 0.2, sx, 0, sz * 2.8);
  k.rb('@up', 2.3, 0.35, 4.2, 0, 0.85, 1, 0.12);
  k.rb('@up', 2.3, 0.35, 2.2, 0, 1.4, -2.15, 0.12).rotation.x = 0.9;
  return k;
}
function adirondack() {
  const k = new Kit();
  for (let i = 0; i < 6; i++) k.bx('@wood', 2.2, 0.1, 0.35, 0, 1.2 - i * 0.08, 0.9 - i * 0.38);
  for (let i = 0; i < 5; i++) k.bx('@wood', 0.38, 3, 0.1, -0.85 + i * 0.42, 1.2, -1.4).rotation.x = -0.35;
  for (const sx of [-1, 1]) {
    k.bx('@wood', 0.5, 0.1, 2.8, sx * 1.25, 2.1, 0.2);
    k.bx('@wood', 0.15, 2.1, 0.15, sx * 1.25, 0, 1.3);
    k.bx('@wood', 0.15, 1.3, 2.8, sx * 1.1, 0, -0.1);
  }
  return k;
}

/* ------------------------------------------------------------------ beds and case goods */

function bed(w: number, len: number) {
  const k = new Kit();
  k.rb('@up', w + 0.3, 0.9, len, 0, 0.45, 0, 0.1);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.cy('walnut', 0.1, 0.08, 0.45, sx * (w / 2 - 0.1), 0, sz * (len / 2 - 0.3), 8);
  k.rb('white', w - 0.1, 0.85, len - 0.5, 0, 1.25, 0.1, 0.18); // mattress
  k.rb('@duvet', w + 0.05, 0.4, len - 2.2, 0, 1.85, 0.95, 0.18);
  k.rb('@duvet', w + 0.2, 0.9, 0.2, 0, 1.25, len / 2 - 0.05, 0.08);
  k.rb('@up', w - 0.2, 0.18, 1.6, 0, 2.2, len / 2 - 1.2, 0.08); // folded throw
  for (let i = 0; i < 2; i++) {
    const px = (i - 0.5) * (w / 2);
    k.rb('sheet', w / 2 - 0.25, 0.6, 1.4, px, 2.05, -len / 2 + 1.05, 0.24);
    k.rb('@duvet', w / 2 - 0.6, 0.55, 0.5, px, 2.4, -len / 2 + 1.55, 0.2).rotation.x = -0.35;
  }
  k.rb('@up', w + 0.6, 4.4, 0.45, 0, 0, -len / 2 + 0.2, 0.14); // headboard
  return k;
}
function nightstand() {
  const k = new Kit();
  k.rb('@wood', 2, 1.95, 1.6, 0, 0.25, 0, 0.04);
  k.bx('soot', 1.8, 0.02, 0.02, 0, 1.25, 0.81);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.cy('steel', 0.05, 0.05, 0.25, sx * 0.85, 0, sz * 0.65, 6);
  k.bx('brass', 0.3, 0.04, 0.04, 0, 1.6, 0.82);
  k.cy('ceramic', 0.3, 0.38, 0.9, 0.2, 2.2, -0.2, 16);
  k.cy('shade', 0.55, 0.7, 0.9, 0.2, 3.1, -0.2, 20);
  return k;
}
function dresser(w: number, d: number, h: number) {
  const k = new Kit();
  k.rb('@wood', w, h - 0.3, d, 0, 0.3, 0, 0.04);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.cy('steel', 0.06, 0.05, 0.3, sx * (w / 2 - 0.25), 0, sz * (d / 2 - 0.2), 6);
  const cols = Math.round(w / 2);
  for (let c = 0; c < cols; c++) for (let r = 0; r < 3; r++) {
    const x = -w / 2 + (w * (c + 0.5)) / cols, y = 0.3 + ((h - 0.3) * (r + 0.5)) / 3;
    k.bx('brass', 0.5, 0.05, 0.05, x, y, d / 2 + 0.02);
    if (c) k.bx('soot', 0.02, h - 0.4, 0.02, -w / 2 + (w * c) / cols, 0.35, d / 2 + 0.01);
  }
  return k;
}
function sideTable() {
  const k = new Kit();
  k.cy('@wood', 0.9, 0.9, 0.12, 0, 1.75, 0, 24);
  k.cy('steel', 0.08, 0.08, 1.75, 0, 0, 0, 8);
  k.cy('steel', 0.5, 0.55, 0.08, 0, 0, 0, 18);
  k.cy('ceramic', 0.22, 0.3, 0.7, 0.2, 1.87, 0, 12);
  return k;
}
function coffeeTable(len: number, wid: number) {
  const k = new Kit();
  k.rb('@wood', len, 0.3, wid, 0, 1.15, 0, 0.12);
  for (const sx of [-1, 1]) k.bx('steel', 0.2, 1.15, wid - 0.8, sx * (len / 2 - 0.9), 0, 0);
  k.rb('ceramic', 0.9, 0.7, 0.9, 0.6, 1.45, 0.2, 0.3);
  k.bx('paper', 1.2, 0.18, 0.9, -1.3, 1.45, -0.2);
  k.bx('soot', 1.1, 0.14, 0.8, -1.3, 1.63, -0.2);
  k.sp('plant', 0.45, 0.6, 2.4, 0.2, 1.4, 0.8, 1.2, 10); // a sprig in the vase
  return k;
}
function diningTable(len: number, wid: number) {
  const k = new Kit();
  k.rb('@wood', len, 0.25, wid, 0, 2.25, 0, 0.1);
  for (const sx of [-1, 1]) {
    k.bx('steel', 0.25, 2.25, 0.25, sx * (len / 2 - 1.3), 0, -wid / 2 + 0.7);
    k.bx('steel', 0.25, 2.25, 0.25, sx * (len / 2 - 1.3), 0, wid / 2 - 0.7);
    k.bx('steel', 0.25, 0.25, wid - 1.2, sx * (len / 2 - 1.3), 2.0, 0);
  }
  for (let i = 0; i < 3; i++) k.cy('ceramic', 0.25, 0.2, 0.7, -1.2 + i * 1.2, 2.5, 0, 12);
  return k;
}
function bookshelf(k: Kit, w: number, d: number, h: number, mat: string, seed: number) {
  k.rb(mat, w, h, d, 0, 0, 0, 0.02);
  const shelves = Math.max(3, Math.round(h / 1.35)), r = rng(seed);
  k.bx('soot', w - 0.3, h - 0.3, 0.05, 0, 0.15, -d / 2 + 0.12);
  for (let s = 1; s < shelves; s++) k.bx(mat, w - 0.1, 0.08, d - 0.1, 0, (h * s) / shelves, 0.05);
  for (let s = 0; s < shelves; s++) {
    const y0 = (h * s) / shelves + 0.1, sh = h / shelves - 0.3;
    let x = -w / 2 + 0.2;
    while (x < w / 2 - 0.3) {
      if (r() < 0.14) { x += 0.4 + r() * 0.6; continue; }
      const bw = 0.12 + r() * 0.14, bh = sh * (0.6 + r() * 0.4);
      k.props.push({ kind: 'book', x: x + bw / 2, y: y0, z: d * 0.05 + d / 2 - d * 0.35 - 0.02, w: bw, h: bh, d: d * 0.7, c: Math.floor(r() * 11) });
      x += bw + 0.01;
    }
  }
}
function bookcase(w: number, d: number, h: number, seed: number) { const k = new Kit(); bookshelf(k, w, d, h, '@wood', seed); return k; }
function art(w: number, h: number, i: number) {
  const k = new Kit();
  k.rb('walnut', w + 0.3, h + 0.3, 0.14, 0, 0, 0, 0.02);
  k.plane(`art${i % 4}`, w, h, 0, h / 2 + 0.15, 0.075);
  return k;
}
function tv(w: number, h: number, screen: string) {
  const k = new Kit();
  k.bx('black', w + 0.1, h + 0.1, 0.2, 0, 0, 0);
  k.plane(screen, w, h, 0, h / 2 + 0.05, 0.105);
  return k;
}
function rug(w: number, d: number) { const k = new Kit(); k.rb('@rug', w, 0.05, d, 0, 0, 0, 0.02).userData.uv = 'fit'; return k; }
function plant(h: number, seed: number) {
  const k = new Kit();
  k.cy('potDark', 0.9, 0.7, 1.6, 0, 0, 0, 20);
  k.cy('soot', 0.85, 0.85, 0.05, 0, 1.55, 0, 16);
  k.cy('timber', 0.05, 0.08, h - 1.6, 0, 1.6, 0, 6);
  const r = rng(seed), n = Math.round(10 + h * 3);
  for (let i = 0; i < n; i++) {
    const a = r() * 6.28, rr = 0.2 + r() * 0.55, y = 1.6 + (h - 1.6) * (0.35 + r() * 0.62);
    k.plane('foliage', 1.5, 1.5, Math.cos(a) * rr, y, Math.sin(a) * rr, a + r(), -0.4 - r() * 0.9, 'keep', true);
  }
  return k;
}

/* ------------------------------------------------------------------ kitchens, baths, built-ins */

function cabinetRun(len: number, depth: number, h: number, top = 'quartz', body = '@wood') {
  const k = new Kit();
  k.rb('soot', len - 0.1, 0.35, depth - 0.2, 0, 0, -0.1, 0);
  k.rb(body, len, h - 0.45, depth, 0, 0.35, 0, 0.02);
  const n = Math.max(1, Math.round(len / 1.8));
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + (len * (i + 0.5)) / n;
    k.bx('brass', 0.04, 0.04, 0.9, x + len / n / 2 - 0.25, h - 0.7, depth / 2 + 0.03);
    if (i) k.bx('soot', 0.015, h - 0.5, 0.02, -len / 2 + (len * i) / n, 0.4, depth / 2 + 0.01);
  }
  k.bx('soot', len - 0.05, 0.015, 0.02, 0, h - 1.05, depth / 2 + 0.01);
  k.rb(top, len + 0.1, 0.12, depth + 0.1, 0, h - 0.1, 0.05, 0.015);
  return k;
}
function uppers(len: number, h: number, d: number, body = '@wood') {
  const k = new Kit();
  k.rb(body, len, h, d, 0, 0, 0, 0.02);
  const n = Math.max(1, Math.round(len / 1.8));
  for (let i = 1; i < n; i++) k.bx('soot', 0.015, h - 0.1, 0.02, -len / 2 + (len * i) / n, 0.05, d / 2 + 0.01);
  for (let i = 0; i < n; i++) k.bx('brass', 0.04, 0.5, 0.04, -len / 2 + (len * (i + 0.5)) / n + len / n / 2 - 0.25, 0.2, d / 2 + 0.03);
  k.bx('bulb', len - 0.2, 0.02, 0.1, 0, -0.01, d / 2 - 0.2);
  return k;
}
function island(len: number, wid: number, overhang: number, sink: boolean) {
  const k = new Kit(), bw = wid - overhang;
  k.rb('soot', len - 0.3, 0.35, bw - 0.3, 0, 0, -overhang / 2, 0);
  k.rb('@wood', len, 2.55, bw, 0, 0.35, -overhang / 2, 0.03);
  const n = Math.round(len / 2);
  for (let i = 1; i < n; i++) k.bx('soot', 0.02, 2.4, 0.02, -len / 2 + (len * i) / n, 0.4, -overhang / 2 + bw / 2 + 0.01);
  k.rb('quartz', len + 0.15, 0.14, wid + 0.1, 0, 2.9, 0, 0.02);
  if (overhang) for (const sx of [-1, 1]) k.rb('quartz', 0.14, 2.9, wid + 0.1, sx * (len / 2 + 0.05), 0, 0, 0.01);
  if (sink) {
    k.bx('stainless', 1.6, 0.02, 1.2, -1.5, 3.03, 0);
    k.cyc('brass', 0.04, 1.1, -1.5, 3.55, -0.75, 'y');
    k.torus('brass', 0.35, 0.04, -1.5, 4.1, -0.4, 0, PI / 2, PI);
  }
  return k;
}
function range() {
  const k = new Kit();
  k.rb('stainless', 3, 3, 2.1, 0, 0, 0, 0.04);
  k.bx('black', 2.9, 0.05, 1.9, 0, 3, 0);
  for (let i = 0; i < 6; i++) k.cy('black', 0.25, 0.25, 0.08, -1 + (i % 3), 3.04, -0.45 + ((i / 3) | 0) * 0.9, 12);
  k.bx('glassDark', 2.2, 1.3, 0.02, 0, 0.7, 1.06);
  k.bx('stainless', 2.2, 0.07, 0.07, 0, 2.2, 1.12);
  for (let i = 0; i < 6; i++) k.cyc('black', 0.09, 0.12, -1.1 + i * 0.44, 2.6, 1.1, 'z', 10);
  return k;
}
function hood() {
  const k = new Kit();
  const m = k.cy('plaster', 1.3, 2.4, 2.6, 0, 0, 0, 4);
  m.geometry.rotateY(PI / 4); m.scale.set(1, 1, 0.55); // a four-sided taper, flattened against the wall
  k.bx('plaster', 1.9, 2.6, 1.15, 0, 2.6, -0.4);
  k.bx('walnut', 3.5, 0.35, 1.85, 0, -0.1, 0);
  return k;
}
function fridge() {
  const k = new Kit();
  k.rb('@wood', 3, 8, 2.1, 0, 0, 0, 0.02);
  k.bx('soot', 0.02, 7.8, 0.02, 0, 0.1, 1.06);
  for (const sx of [-1, 1]) k.cyc('brass', 0.04, 2.6, sx * 0.25, 4.6, 1.17, 'y');
  return k;
}
function tallCabinet(w: number, h: number, d: number, doors: number) {
  const k = new Kit();
  k.rb('@wood', w, h, d, 0, 0, 0, 0.02);
  for (let i = 1; i < doors; i++) k.bx('soot', 0.02, h - 0.2, 0.02, -w / 2 + (w * i) / doors, 0.1, d / 2 + 0.01);
  return k;
}
function vanity(len: number, sinks: number) {
  const k = new Kit();
  k.rb('@wood', len, 1.6, 1.9, 0, 1.25, 0, 0.03);
  k.rb('quartz', len + 0.1, 0.12, 2, 0, 2.85, 0.02, 0.02);
  for (let i = 0; i < sinks; i++) {
    const x = -len / 2 + (len * (i + 0.5)) / sinks;
    k.cy('ceramic', 0.75, 0.55, 0.42, x, 2.97, 0.15, 24);
    k.cy('brass', 0.04, 0.04, 1.2, x, 2.97, -0.75, 6);
    k.cyc('brass', 0.035, 0.55, x, 4.1, -0.5, 'z', 6);
    const mr = k.cy('mirror', 1.15, 1.15, 0.06, x, 6.4, -0.93, 36); mr.rotation.x = PI / 2; mr.position.set(x, 6.4, -0.93);
    k.torus('brass', 1.15, 0.05, x, 6.4, -0.9);
    const sx = x + (i ? 1.5 : -1.5);
    k.bx('brass', 0.25, 0.5, 0.1, sx, 6.35, -0.9);
    k.cy('shade', 0.22, 0.26, 0.6, sx, 6.5, -0.6, 12);
  }
  return k;
}
function toilet() {
  const k = new Kit();
  const b = k.cy('ceramic', 0.7, 0.55, 1.3, 0, 0, 0.25, 20); b.scale.set(1, 1, 1.25);
  k.rb('ceramic', 1.5, 1.3, 0.65, 0, 1.2, -0.75, 0.12);
  k.rb('ceramic', 1.45, 0.1, 1.85, 0, 1.3, 0.2, 0.05);
  return k;
}
function tub(len: number, w: number) {
  const k = new Kit();
  const m = k.cy('ceramic', 1, 0.62, 2, 0, 0, 0, 32); m.scale.set(w / 2, 1, len / 2);
  const water = k.cy('ceramic', 0.9, 0.9, 0.02, 0, 1.9, 0, 32); water.scale.set(w / 2, 1, len / 2); water.userData.mat = 'white';
  k.cy('brass', 0.06, 0.06, 3.2, 0, 0, -len / 2 - 0.4, 8);
  k.cyc('brass', 0.05, 0.6, 0, 3.15, -len / 2 - 0.15, 'z', 6);
  return k;
}
function showerGlass(len: number, h: number) {
  const k = new Kit();
  k.plane('glass', len, h, 0, h / 2 + 0.05, 0, 0, 0, 'box');
  k.bx('bronze', len, 0.1, 0.1, 0, h, 0);
  k.bx('bronze', 0.1, h, 0.1, -len / 2, 0, 0);
  return k;
}
function wardrobe(len: number, d: number, seed: number) {
  const k = new Kit(), r = rng(seed);
  k.rb('lightwood', len, 0.12, d, 0, 7.4, 0, 0.01);
  k.rb('lightwood', len, 0.12, d, 0, 4.0, 0, 0.01);
  for (const sx of [-1, 1]) k.bx('lightwood', 0.1, 8, d, (sx * len) / 2, 0, 0);
  k.cyc('brass', 0.04, len - 0.2, 0, 7.15, 0.15, 'x');
  k.cyc('brass', 0.04, len - 0.2, 0, 3.75, 0.15, 'x');
  const pal = ['charcoal', 'linen', 'leather', 'sheet', 'accent', 'canvas'];
  for (const [yt, hh] of [[7.1, 2.6], [3.7, 2.4]]) {
    let x = -len / 2 + 0.3;
    while (x < len / 2 - 0.3) {
      const w = 0.12 + r() * 0.1;
      k.rb(pal[Math.floor(r() * pal.length)], w + 0.06, hh * (0.7 + r() * 0.3), 1.6, x, yt - hh, 0.15, 0.07);
      x += w + 0.05;
    }
  }
  for (let i = 0; i < 4; i++) k.rb('leather', 0.9, 0.5, 0.6, -len / 2 + 0.8 + i * 1.1, 7.55, 0, 0.1);
  return k;
}
function desk(len: number, d: number) {
  const k = new Kit();
  k.rb('@wood', len, 0.18, d, 0, 2.4, 0, 0.03);
  for (const sx of [-1, 1]) k.bx('steel', 0.2, 2.4, d - 0.4, sx * (len / 2 - 0.4), 0, 0);
  k.rb('leather', 2.4, 0.02, 1.5, 0, 2.58, 0.2, 0.01);
  k.cy('brass', 0.25, 0.3, 0.08, len / 2 - 0.6, 2.58, -0.6, 12);
  k.cy('brass', 0.03, 0.03, 1.6, len / 2 - 0.6, 2.6, -0.6, 6);
  k.cy('brass', 0.2, 0.3, 0.3, len / 2 - 0.9, 4.0, -0.3, 12);
  k.bx('black', 0.9, 0.04, 0.6, -1.1, 2.6, 0.3);
  k.bx('paper', 0.8, 0.1, 1.1, 1, 2.6, 0.2);
  return k;
}
function wineRack(len: number, h: number, d: number) {
  const k = new Kit();
  k.rb('walnut', len, h, d, 0, 0, 0, 0.01);
  const cols = Math.floor(len / 0.42), rows = Math.floor((h - 0.3) / 0.42);
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) k.props.push({ kind: 'bottleLying', x: -len / 2 + 0.21 + (c * len) / cols, y: 0.2 + (r * (h - 0.3)) / rows, z: d / 2 - 0.25, w: 0, h: 0, d: 0, c: c * 7 + r });
  k.bx('bulb', len - 0.2, 0.03, 0.1, 0, h - 0.1, d / 2 - 0.05);
  return k;
}
function barBack(len: number) {
  const k = new Kit();
  k.rb('cabinetPaint', len, 3, 2, 0, 0, 0, 0.02);
  k.rb('quartz', len + 0.1, 0.12, 2.1, 0, 3, 0, 0.02);
  k.bx('glassDark', 2, 2.3, 0.05, -len / 2 + 1.4, 0.4, 1.01);
  k.bx('glassDark', 2, 2.3, 0.05, -len / 2 + 3.6, 0.4, 1.01);
  for (let s = 0; s < 3; s++) {
    const y = 4.6 + s * 1.3;
    k.bx('walnut', len - 1, 0.15, 1, 0, y, -0.4);
    for (let i = 0; i < 14; i++) k.props.push({ kind: 'bottle', x: -len / 2 + 1 + (i * (len - 2)) / 13, y: y + 0.15, z: -0.4, w: 0, h: 0, d: 0, c: i + s * 3 });
  }
  k.bx('bulb', len - 1.2, 0.02, 0.1, 0, 4.58, -0.75);
  return k;
}

/* ------------------------------------------------------------------ vehicles, gym, games */

function car(kind: 'suv' | 'coupe') {
  const k = new Kit(), suv = kind === 'suv';
  const L = suv ? 16 : 14.5, W = 6.4, H = suv ? 2.6 : 1.9;
  k.rb('@paint', L, H, W, 0, 1.2, 0, 0.55);
  k.rb('glassDark', L * (suv ? 0.58 : 0.45), suv ? 2.1 : 1.6, W - 0.6, suv ? -1 : -0.8, 1.2 + H - 0.4, 0, 0.5);
  k.rb('@paint', L * (suv ? 0.56 : 0.43), 0.18, W - 0.5, suv ? -1 : -0.8, 1.2 + H + (suv ? 1.6 : 1.1), 0, 0.08);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    k.cyc('black', 1.25, 0.9, sx * L * 0.32, 1.25, sz * (W / 2 - 0.35), 'z', 22);
    k.cyc('stainless', 0.7, 0.92, sx * L * 0.32, 1.25, sz * (W / 2 - 0.35), 'z', 14);
  }
  for (const sz of [-1, 1]) { k.bx('opal', 0.1, 0.3, 1.2, L / 2 + 0.02, 2.6, sz * 2.1); k.bx('ember', 0.1, 0.3, 1.4, -L / 2 - 0.02, 2.7, sz * 2.1); }
  return k;
}
function boat(onTrailer: boolean) {
  const k = new Kit(), L = 21, W = 8, H = 3, y0 = onTrailer ? 1.5 : 0;
  // hull: a rounded box with a tapered bow, built from three blocks
  k.rb('@paint', L - 4, H * 0.6, W, -2, y0, 0, 0.5);
  const bow = k.rb('@paint', 4.5, H * 0.6, W * 0.7, L / 2 - 2.4, y0, 0, 0.5); bow.rotation.y = 0;
  k.rb('white', L - 1, H * 0.4, W - 0.2, -0.5, y0 + H * 0.6, 0, 0.3);
  k.rb('leather', 10, 0.7, W - 2, -2.5, y0 + H - 0.1, 0, 0.2);
  k.rb('glassDark', 0.2, 1.2, W - 1.8, 2.8, y0 + H + 0.2, 0, 0.05);
  for (const sz of [-1, 1]) { const a = k.bx('stainless', 0.25, 6, 0.25, -0.5, y0 + H, sz * (W / 2 - 0.7)); a.rotation.x = sz * 0.12; }
  k.bx('stainless', 0.3, 0.3, W - 1.2, -0.5, y0 + H + 5.6, 0);
  if (onTrailer) {
    for (const sz of [-1, 1]) k.bx('steel', 22, 0.3, 0.3, 0, 0.2, sz * 2.4);
    for (const sz of [-1, 1]) k.cyc('black', 1.1, 0.7, -2, 1.1, sz * 3.4, 'z', 18);
  }
  return k;
}
function rack() {
  const k = new Kit();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.bx('steel', 0.25, 7.6, 0.25, sx * 2, 0, sz * 1.9);
  for (const sx of [-1, 1]) { k.bx('steel', 0.25, 0.25, 4, sx * 2, 7.35, 0); k.bx('steel', 0.25, 0.25, 4, sx * 2, 0, 0); }
  k.bx('steel', 4.2, 0.25, 0.25, 0, 7.35, -1.9); k.bx('steel', 4.2, 0.25, 0.25, 0, 7.35, 1.9);
  k.cyc('chrome', 0.06, 7.2, 0, 4.6, 1.9, 'x', 8);
  for (const sx of [-1, 1]) for (let i = 0; i < 2; i++) k.cyc('black', 1.5 - i * 0.35, 0.2, sx * (2.6 + i * 0.22), 4.6, 1.9, 'x', 24);
  k.rb('leather', 1.1, 0.35, 4, 0, 1.3, 0, 0.1);
  k.bx('steel', 0.25, 1.3, 2.8, 0, 0, 0);
  return k;
}
function dumbbells(len: number) {
  const k = new Kit();
  for (const y of [1.4, 2.6]) k.bx('steel', len, 0.12, 1.2, 0, y, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.bx('steel', 0.12, 2.8, 0.12, sx * (len / 2 - 0.1), 0, sz * 0.5);
  for (let i = 0; i < 8; i++) for (const [y, s] of [[1.75, 0.26 + i * 0.02], [2.95, 0.2 + i * 0.015]]) {
    const x = -len / 2 + 0.6 + (i * (len - 1.2)) / 7;
    k.cyc('chrome', 0.05, 0.9, x, y, 0, 'z', 6);
    for (const dz of [-0.42, 0.42]) k.cyc('black', s, 0.2, x, y, dz, 'z', 8);
  }
  return k;
}
function treadmill() {
  const k = new Kit();
  k.rb('steel', 3, 0.7, 7, 0, 0, 0, 0.1);
  k.bx('black', 2.2, 0.05, 6, 0, 0.7, 0.2);
  for (const sx of [-1, 1]) k.bx('steel', 0.2, 4.2, 0.25, sx * 1.3, 0.5, -3.1).rotation.x = -0.2;
  k.rb('black', 2.8, 1, 0.4, 0, 4.3, -3.6, 0.1);
  return k;
}
function bike() {
  const k = new Kit();
  k.bx('steel', 1.8, 0.2, 4, 0, 0, 0);
  k.cyc('chrome', 1, 0.3, 0, 1.4, 1.2, 'x', 24);
  k.bx('steel', 0.3, 3.4, 0.3, 0, 0.2, -0.8).rotation.x = 0.25;
  k.rb('black', 0.7, 0.25, 1.1, 0, 3.4, -1.3, 0.1);
  k.bx('steel', 0.3, 3.2, 0.3, 0, 0.2, 1.4).rotation.x = -0.2;
  k.bx('black', 1.6, 0.15, 0.3, 0, 3.6, 1.95);
  return k;
}
function rower() {
  const k = new Kit();
  k.bx('steel', 0.5, 0.3, 8, 0, 0.9, 0);
  for (const sz of [-1, 1]) k.bx('steel', 1.8, 0.2, 0.3, 0, 0, sz * 3.6);
  k.bx('steel', 0.3, 0.9, 0.3, 0, 0, -3.6);
  k.cyc('black', 1.1, 0.7, 0, 1.6, 3.5, 'x', 24);
  k.rb('black', 1.1, 0.25, 1.2, 0, 1.2, -1.2, 0.1);
  k.bx('black', 2, 0.12, 0.5, 0, 1.3, 2.4);
  return k;
}
function poolTable() {
  const k = new Kit();
  k.rb('walnut', 8.6, 0.9, 4.9, 0, 1.9, 0, 0.06);
  k.rb('@felt', 7.9, 0.12, 4.2, 0, 2.75, 0, 0.02);
  for (const sx of [-1, 1]) { k.rb('walnut', 8.6, 0.32, 0.38, 0, 2.7, sx * 2.28, 0.06); k.rb('walnut', 0.38, 0.32, 4.9, sx * 4.12, 2.7, 0, 0.06); }
  for (const sx of [-1, 0, 1]) for (const sz of [-1, 1]) k.cy('soot', 0.16, 0.16, 0.2, sx * 3.95, 2.7, sz * 2.1, 10);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.rb('walnut', 0.55, 1.9, 0.55, sx * 3.6, 0, sz * 1.85, 0.06);
  const balls = ['brass', 'cabinetPaint', 'accent', 'black', 'ceramic'];
  balls.forEach((m, i) => k.sp(m, 0.095, -1.5 + (i % 3) * 0.2, 2.97, -0.3 + ((i / 3) | 0) * 0.2, 1, 1, 1, 10));
  k.cyc('oak', 0.04, 4.8, 0.5, 2.9, 1.2, 'x', 6);
  return k;
}
function hotTub() {
  const k = new Kit();
  k.rb('siding', 7, 3, 7, 0, 0, 0, 0.1);
  k.rb('timber', 7.2, 0.2, 7.2, 0, 3, 0, 0.05);
  k.plane('water', 6.2, 6.2, 0, 3.05, 0, 0, -PI / 2, 'box');
  k.rb('timber', 3, 1.2, 1.4, 0, 0, 4.1, 0.05);
  return k;
}
function outdoorKitchen(len: number) {
  const k = new Kit();
  k.rb('stone', len, 3, 2.4, 0, 0, 0, 0.02);
  k.rb('quartz', len + 0.2, 0.15, 2.6, 0, 3, 0, 0.02);
  k.rb('stainless', 3.4, 0.5, 2.2, -len / 2 + 3, 3.15, -0.1, 0.05);
  k.rb('stainless', 3.4, 0.7, 1.2, -len / 2 + 3, 3.65, -0.6, 0.2);
  k.bx('stainless', 3.6, 2, 0.1, -len / 2 + 3, 0.6, 1.21);
  k.bx('stainless', 2, 2, 0.1, len / 2 - 2, 0.6, 1.21);
  return k;
}
function umbrella() {
  const k = new Kit();
  k.cy('stone', 0.8, 0.9, 0.4, 0, 0, 0, 16);
  k.cy('oak', 0.07, 0.07, 8, 0, 0.4, 0, 8);
  k.cy('@up', 0, 5, 1.4, 0, 7.5, 0, 8); // canopy (closed underneath)
  return k;
}

/* ------------------------------------------------------------------ the catalog */

export const CATALOG: Record<string, CatalogEntry> = {
  'Sectional': { build: (s) => sofa(s[0], 3.4, Math.max(0, s[2] - 3.4)), roles: { '@up': 'linen' }, staging: 'upholstery', glb: 'sectional.glb' },
  'Media sectional': { build: (s) => sofa(s[0], 3.5, Math.max(0, s[2] - 3.5)), roles: { '@up': 'charcoal' }, staging: 'upholstery', glb: 'sectional.glb' },
  'Loft sofa': { build: (s) => sofa(s[0], s[2]), roles: { '@up': 'boucle' }, staging: 'upholstery', glb: 'sofa.glb' },
  'Outdoor sofa': { build: (s) => sofa(s[0], s[2], 0, 'timber'), roles: { '@up': 'canvas', '@accent': 'accent' }, glb: 'outdoor_sofa.glb' },
  'Lounge chair': { build: () => loungeChair(), roles: { '@up': 'leather', '@wood': 'walnut' }, staging: 'upholstery', glb: 'lounge_chair.glb' },
  'Dining chair': { build: () => diningChair(), roles: { '@up': 'leather', '@wood': 'oak' }, staging: 'upholstery', glb: 'dining_chair.glb' },
  'Desk chair': { build: () => officeChair(), roles: { '@up': 'leather' }, staging: 'upholstery', glb: 'office_chair.glb' },
  'Stool': { build: (s) => stool(s[1] - 1.1), roles: { '@up': 'leather' }, staging: 'upholstery', glb: 'bar_stool.glb' },
  'Bench': { build: (s) => bench(s[0], s[2]), roles: { '@up': 'linen' }, staging: 'upholstery', glb: 'bench.glb' },
  'Lounger': { build: () => lounger(), roles: { '@up': 'canvas' }, glb: 'lounger.glb' },
  'Adirondack chair': { build: () => adirondack(), roles: { '@wood': 'oak' }, glb: 'adirondack_chair.glb' },
  'Bed': { build: (s) => bed(s[0] - 0.6, s[2]), roles: { '@up': 'linen', '@duvet': 'duvet' }, staging: 'upholstery', glb: 'bed_king.glb' },
  'Queen bed': { build: (s) => bed(s[0] - 0.6, s[2]), roles: { '@up': 'linen', '@duvet': 'duvet' }, staging: 'upholstery', glb: 'bed_queen.glb' },
  'Nightstand': { build: () => nightstand(), roles: { '@wood': 'oak' }, glb: 'nightstand.glb' },
  'Dresser': { build: (s) => dresser(s[0], s[2], s[1]), roles: { '@wood': 'walnut' }, glb: 'dresser.glb' },
  'Side table': { build: () => sideTable(), roles: { '@wood': 'oak' }, glb: 'side_table.glb' },
  'Coffee table': { build: (s) => coffeeTable(s[0], s[2]), roles: { '@wood': 'walnut' }, glb: 'coffee_table.glb' },
  'Dining table': { build: (s) => diningTable(s[0], s[2]), roles: { '@wood': 'walnut' }, glb: 'dining_table.glb' },
  'Tasting table': { build: (s) => { const k = new Kit(); k.cy('@wood', 1, 1, 0.14, 0, s[1] - 0.14, 0, 24); k.cy('steel', 0.1, 0.1, s[1] - 0.14, 0, 0, 0, 8); k.cy('steel', 0.6, 0.7, 0.1, 0, 0, 0, 18); return k; }, roles: { '@wood': 'walnut' } },
  'Console': { build: (s) => { const k = new Kit(); k.rb('@wood', s[0], 0.18, s[2], 0, 2.6, 0, 0.03); for (const sx of [-1, 1]) k.bx('steel', 0.15, 2.6, s[2] - 0.2, sx * (s[0] / 2 - 0.3), 0, 0); k.cy('ceramic', 0.5, 0.35, 1.4, -1.8, 2.78, 0, 16); k.bx('paper', 1.2, 0.2, 0.9, 1.5, 2.78, 0); return k; }, roles: { '@wood': 'walnut' }, glb: 'console_table.glb' },
  'Desk': { build: (s) => desk(s[0], s[2]), roles: { '@wood': 'walnut' }, glb: 'desk.glb' },
  'Rug': { build: (s) => rug(s[0], s[2]), roles: { '@rug': 'rug0' }, staging: 'rug', collide: 'none' },
  'Art': { build: (s, seed) => art(s[0] - 0.3, s[1] - 0.3, seed), collide: 'none' },
  'Plant': { build: (s, seed) => plant(s[1], seed), collide: 'pot', glb: 'potted_plant.glb' },
  'Umbrella': { build: () => umbrella(), roles: { '@up': 'canvas' }, collide: 'pole', glb: 'patio_umbrella.glb' },
  'TV': { build: (s) => tv(s[0] - 0.1, s[1] - 0.1, s[1] > 6 ? 'screenGolf' : 'screenGame'), collide: 'none' },
  'Media console': { build: (s) => { const k = new Kit(); k.rb('@wood', s[0], s[1], s[2], 0, 0, 0, 0.03); return k; }, roles: { '@wood': 'walnut' } },
  'Pool table': { build: () => poolTable(), roles: { '@felt': 'felt' }, glb: 'pool_table.glb' },
  'Power rack': { build: () => rack(), glb: 'power_rack.glb' },
  'Dumbbells': { build: (s) => dumbbells(s[0]), glb: 'dumbbell_rack.glb' },
  'Treadmill': { build: () => treadmill(), glb: 'treadmill.glb' },
  'Spin bike': { build: () => bike(), glb: 'exercise_bike.glb' },
  'Rower': { build: () => rower(), glb: 'rowing_machine.glb' },
  'SUV': { build: () => car('suv'), roles: { '@paint': 'carPaint' }, glb: 'suv.glb' },
  'Coupe': { build: () => car('coupe'), roles: { '@paint': 'coupePaint' }, glb: 'coupe.glb' },
  // the boat in the garage sits on its trailer (taller box)
  'Wake boat': { build: (s) => boat(s[1] > 10), roles: { '@paint': 'hull' }, glb: 'wake_boat.glb' },
  // built-ins (always present)
  'Bookcase': { build: (s, seed) => bookcase(s[0], s[2], s[1], seed), roles: { '@wood': 'oak' } },
  // base runs: the countertop overhangs 0.1 ft and the pulls stand proud of the doors
  'Cabinetry': { build: (s) => (s[1] > 3.6 || s[2] < 1.6 ? uppers(s[0], s[1], s[2]) : cabinetRun(s[0] - 0.1, s[2] - 0.48, 3)), roles: { '@wood': 'oak' } },
  'Island': { build: (s) => (s[0] > 10 ? island(s[0], s[2], 1.3, false) : island(s[0], s[2], 0, true)), roles: { '@wood': 'oak' } },
  'Refrigerator': { build: () => fridge(), roles: { '@wood': 'oak' } },
  'Pantry wall': { build: (s) => tallCabinet(s[0], s[1], s[2], 4), roles: { '@wood': 'oak' } },
  'Pantry cabinets': { build: (s) => tallCabinet(s[0], s[1], s[2], 2), roles: { '@wood': 'oak' } },
  'Range': { build: () => range() },
  'Hood': { build: () => hood(), collide: 'none' },
  'Espresso machine': { build: () => { const k = new Kit(); k.rb('stainless', 1.4, 1.4, 1.2, 0, 0, 0, 0.1); k.cy('black', 0.12, 0.12, 0.3, -0.3, 0.4, 0.7, 8); return k; }, collide: 'none' },
  'Lockers': {
    build: (s) => {
      const k = new Kit(), n = 5, w = s[0] / n;
      for (let i = 0; i <= n; i++) k.bx('@wood', 0.1, s[1], s[2] - 0.1, -s[0] / 2 + i * w, 0, 0);
      for (let i = 0; i < n; i++) { const x = -s[0] / 2 + w * (i + 0.5); for (const hy of [5.2, 5.9]) k.cyc('brass', 0.04, 0.4, x, hy, 0.3, 'z', 6); k.rb('leather', w - 0.5, 0.8, 1.1, x, 6.7, 0, 0.1); }
      k.rb('@wood', s[0], 0.2, s[2], 0, 1.5, 0.05, 0.02); k.bx('@wood', s[0], 0.2, s[2] - 0.1, 0, s[1] - 0.2, 0);
      return k;
    }, roles: { '@wood': 'oak' },
  },
  'Laundry': {
    build: (s) => {
      const k = new Kit();
      k.rb('oak', s[0], 3, s[2] - 0.15, 0, 0, 0, 0.02); k.rb('quartz', s[0] + 0.1, 0.12, s[2], 0, 3, 0.05, 0.02);
      for (const x of [-3.6, -1.2]) { k.rb('white', 2.3, 2.7, 0.1, x, 0.1, s[2] / 2 - 0.05, 0.05); k.cyc('glassDark', 0.7, 0.05, x, 1.4, s[2] / 2 + 0.02, 'z', 22); k.cyc('chrome', 0.78, 0.03, x, 1.4, s[2] / 2 + 0.01, 'z', 22); }
      k.bx('stainless', 1.8, 0.03, 1.4, 2.6, 3.06, 0);
      return k;
    },
  },
  'Dog wash': { build: (s) => { const k = new Kit(); k.rb('tile', s[0], 2, s[2], 0, 0, 0, 0.02); k.bx('slate', s[0] - 0.6, 0.1, s[2] - 0.6, 0, 1.9, 0); k.cy('brass', 0.05, 0.05, 2, 0, 2, -s[2] / 2 + 0.2, 6); return k; } },
  'Vanity': { build: (s) => vanity(s[0] > 4.5 ? s[0] - 0.9 : s[0], s[0] > 4.5 ? 2 : 1), roles: { '@wood': 'oak' } },
  'Toilet': { build: () => toilet() },
  'Tub': { build: (s) => tub(s[2] - 0.46, s[0]) },
  'Shower glass': { build: (s) => showerGlass(s[0], s[1] - 0.1), collide: 'box' },
  'Closet system': { build: (s, seed) => wardrobe(s[0], s[2], seed) },
  'Wine racks': { build: (s) => wineRack(s[0], s[1], s[2]) },
  'Back bar': { build: (s) => barBack(s[0]) },
  'Bar counter': { build: (s) => { const k = new Kit(); k.rb('@wood', s[0] - 0.2, s[1] - 0.14, 1.6, 0, 0, -0.3, 0.03); k.rb('quartz', s[0], 0.14, s[2], 0, s[1] - 0.14, 0, 0.02); k.bx('brass', s[0] - 0.2, 0.06, 0.06, 0, 0.7, 0.65); return k; }, roles: { '@wood': 'walnut' } },
  'Hitting mat': { build: (s) => { const k = new Kit(); k.rb('turf', s[0], 0.25, s[2], 0, 0, 0, 0.05); k.sp('ceramic', 0.08, 0, 0.33, -1, 1, 1, 1, 10); return k; }, collide: 'none' },
  'Outdoor kitchen': { build: (s) => outdoorKitchen(s[0]) },
  'Hot tub': { build: () => hotTub() },
};

/** Default finish cycle for the staging click. */
export const UPHOLSTERY_FINISHES = ['linen', 'leather', 'boucle'] as const;
export const UPHOLSTERY_LABELS: Record<string, string> = { linen: 'Linen', leather: 'Leather', boucle: 'Bouclé', charcoal: 'Charcoal wool', canvas: 'Canvas' };
export const RUG_PATTERNS = ['rug0', 'rug1', 'rug2'] as const;
export const RUG_LABELS: Record<string, string> = { rug0: 'Natural wool', rug1: 'Flat-weave stripe', rug2: 'Kilim' };
