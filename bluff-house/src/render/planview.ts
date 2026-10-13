import * as THREE from 'three';
import type { BuiltHouse } from '../build/house';
import type { RenderRig } from './renderer';
import { FLOOR_Y, WALL_T } from '../data/house';

/** Plan-view window in feet. The reference SVGs use 12 px per ft with x = 0 at 480 px and z = 0 at 168 px. */
export interface PlanWindow { x0: number; z0: number; w: number; h: number; pxPerFt: number }
export const PLAN_WINDOW: PlanWindow = { x0: -20, z0: -10, w: 110, h: 110, pxPerFt: 12 };
/** The window that matches an SVG viewBox in the reference drawings. */
export const windowFromViewBox = (vx: number, vy: number, vw: number, vh: number): PlanWindow =>
  ({ x0: (vx - 480) / 12, z0: (vy - 168) / 12, w: vw / 12, h: vh / 12, pxPerFt: 12 });
/** Height above each floor where the plan is cut (architectural convention: about 4 ft). */
export const PLAN_CUT = 4.5;

/**
 * Renders an orthographic top-down "clay" plan of one level, cut horizontally like an
 * architectural plan, with the cut walls filled dark (poché). The roof is always hidden.
 */
export function renderPlan(house: BuiltHouse, rig: RenderRig, level: number, opts: { win?: PlanWindow; pocheColor?: number } = {}): string {
  const { renderer, scene } = rig;
  const W = opts.win ?? PLAN_WINDOW;
  const pw = Math.round(W.w * W.pxPerFt), ph = Math.round(W.h * W.pxPerFt);
  const cut = FLOOR_Y[level] + PLAN_CUT;
  const cam = new THREE.OrthographicCamera(-W.w / 2, W.w / 2, W.h / 2, -W.h / 2, 1, 1000);
  cam.up.set(0, 0, -1);
  cam.position.set(W.x0 + W.w / 2, 400, W.z0 + W.h / 2);
  cam.lookAt(W.x0 + W.w / 2, 0, W.z0 + W.h / 2);
  cam.updateMatrixWorld();

  // poché: dark caps on every wall piece the cut plane passes through
  const poche = pocheMesh(house, level, cut, opts.pocheColor ?? 0x1f1d1a);
  scene.add(poche);

  const prev = {
    clip: renderer.clippingPlanes, roof: house.roof.visible, size: renderer.getSize(new THREE.Vector2()), pr: renderer.getPixelRatio(),
    fog: scene.fog, bg: scene.background,
  };
  renderer.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), cut)];
  house.roof.visible = false;
  scene.fog = null;
  scene.background = new THREE.Color(0xfbf9f5);
  renderer.setPixelRatio(1);
  renderer.setSize(pw, ph, false);
  renderer.shadowMap.needsUpdate = true;
  const restore = flatLights(rig);
  renderer.render(scene, cam);
  restore();
  const url = renderer.domElement.toDataURL('image/png');

  scene.remove(poche);
  disposeTree(poche);
  renderer.clippingPlanes = prev.clip;
  house.roof.visible = prev.roof;
  scene.fog = prev.fog; scene.background = prev.bg;
  renderer.setPixelRatio(prev.pr);
  renderer.setSize(prev.size.x, prev.size.y, false);
  renderer.shadowMap.needsUpdate = true;
  return url;
}

/** Bird's-eye perspective "clay" view of one level with everything above it removed. */
export function renderLevelAerial(house: BuiltHouse, rig: RenderRig, level: number, w = 1600, h = 1000): string {
  const { renderer, scene } = rig;
  const cut = FLOOR_Y[level] + 9.6;
  const cam = new THREE.PerspectiveCamera(38, w / h, 1, 3000);
  cam.position.set(-70, FLOOR_Y[level] + 150, 125);
  cam.lookAt(32, FLOOR_Y[level], 40);
  const prev = { clip: renderer.clippingPlanes, roof: house.roof.visible, size: renderer.getSize(new THREE.Vector2()), pr: renderer.getPixelRatio() };
  const caps = pocheMesh(house, level, cut, 0x46423d);
  scene.add(caps);
  renderer.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), cut)];
  house.roof.visible = false;
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  renderer.shadowMap.needsUpdate = true;
  const restore = flatLights(rig);
  renderer.render(scene, cam);
  restore();
  const url = renderer.domElement.toDataURL('image/png');
  scene.remove(caps); disposeTree(caps);
  renderer.clippingPlanes = prev.clip;
  house.roof.visible = prev.roof;
  renderer.setPixelRatio(prev.pr);
  renderer.setSize(prev.size.x, prev.size.y, false);
  renderer.shadowMap.needsUpdate = true;
  return url;
}

/**
 * Cut views can't use the sun's shadow map: shadow passes ignore clipping, so the floors
 * above the cut would still shade the level. Use shadowless key + fill light instead.
 */
function flatLights(rig: RenderRig): () => void {
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(-60, 120, 140); key.target.position.set(35, 0, 45);
  rig.scene.add(key, key.target);
  const prevSun = rig.sun.intensity, prevHemi = rig.hemi.intensity;
  rig.sun.intensity = 0; rig.hemi.intensity = 2.0;
  return () => { rig.scene.remove(key, key.target); rig.sun.intensity = prevSun; rig.hemi.intensity = prevHemi; };
}

/** Flat caps where a horizontal cut at height `cut` passes through the walls of `level`. */
function pocheMesh(house: BuiltHouse, level: number, cut: number, color: number): THREE.Object3D {
  const pos: number[] = [];
  const y = cut - 0.01, h = WALL_T / 2;
  for (const p of house.ctx.wallPieces) {
    if (p.level !== level || p.y0 > cut || p.y1 < cut) continue;
    const [x0, z0, x1, z1] = p.axis === 'x' ? [p.at - h, p.s, p.at + h, p.e] : [p.s, p.at - h, p.e, p.at + h];
    pos.push(x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z1, x1, y, z0, x0, y, z0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color }));
}

function disposeTree(o: THREE.Object3D) {
  o.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } });
}
