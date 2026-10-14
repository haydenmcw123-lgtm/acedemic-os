import * as THREE from 'three';
import { len2 } from '../util/noise';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import type { Plan } from '../build/plan';
import { levelOfFeet } from '../data/house';
import { EMISSIVE_FIXTURES, material } from '../materials/library';
import { fixtures, type LightPoint, type WindowLight } from './fixtures';

/** Correlated color temperature → linear RGB (Tanner Helland's fit), for 2700 K lamps. */
export function kelvin(k: number): THREE.Color {
  const t = k / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return new THREE.Color().setRGB(Math.min(255, Math.max(0, r)) / 255, Math.min(255, Math.max(0, g)) / 255, Math.min(255, Math.max(0, b)) / 255, THREE.SRGBColorSpace);
}

const POOL = 8; // shadowless point lights, re-assigned to the nearest fixtures around the camera
const WINDOWS = 4; // RectAreaLights in the nearest big glass walls
const LAMP = kelvin(2700);

/** Keeps the k smallest (d, i) pairs in sorted order, in preallocated arrays (no garbage). */
function pushNearest(d: number, i: number, k: number, ds: Float64Array, is: Int32Array, n: number): number {
  if (n === k && d >= ds[k - 1]) return n;
  let j = n < k ? n++ : k - 1;
  while (j > 0 && ds[j - 1] > d) { ds[j] = ds[j - 1]; is[j] = is[j - 1]; j--; }
  ds[j] = d; is[j] = i;
  return n;
}

/**
 * Interior light: a sky fill, daylight pouring through the nearest big glass walls (RectAreaLights),
 * and at night a pool of 2700 K point lights on the nearest room fixtures plus glowing recessed cans.
 * Light counts are fixed so shaders never recompile while walking; only positions and intensities change.
 */
export class InteriorLights {
  private pool: THREE.PointLight[] = [];
  private rects: THREE.RectAreaLight[] = [];
  private points: LightPoint[];
  private windows: WindowLight[];
  readonly cans: THREE.InstancedMesh;
  private timer = 0;
  private nd = new Float64Array(POOL); private ni = new Int32Array(POOL);
  private wd = new Float64Array(WINDOWS); private wi = new Int32Array(WINDOWS);
  /** 0 = daytime, 1 = lights fully on (sun below ~3°). */
  lightsOn = 0;
  /** Daylight strength 0..1 and its color, set by the time of day. */
  daylight = 1;
  readonly daylightColor = new THREE.Color(1, 1, 1);
  sunBoost = new THREE.Vector3();

  constructor(scene: THREE.Scene, plan: Plan, extra: LightPoint[] = []) {
    RectAreaLightUniformsLib.init();
    const f = fixtures(plan);
    this.points = [...f.points, ...extra];
    this.windows = f.windows;
    for (let i = 0; i < POOL; i++) {
      const l = new THREE.PointLight(LAMP, 0, 20, 2);
      l.castShadow = false;
      scene.add(l); this.pool.push(l);
    }
    for (let i = 0; i < WINDOWS; i++) {
      const r = new THREE.RectAreaLight(0xffffff, 0, 1, 1);
      scene.add(r); this.rects.push(r);
    }
    // recessed cans: an emissive lens in a white trim ring, all instanced
    const disc = new THREE.CircleGeometry(0.2, 20).rotateX(Math.PI / 2);
    // the cans get their own bulb material: three keeps one shader per material, and sharing it
    // between instanced and plain meshes would re-check that shader at every switch, every frame
    const canBulb = (material('bulb') as THREE.MeshStandardMaterial).clone();
    canBulb.name = 'bulb|cans';
    EMISSIVE_FIXTURES.push(canBulb);
    this.cans = new THREE.InstancedMesh(disc, canBulb, f.cans.length);
    const m = new THREE.Matrix4();
    f.cans.forEach((c, i) => this.cans.setMatrixAt(i, m.makeTranslation(c.x, c.y - 0.01, c.z)));
    this.cans.castShadow = false; this.cans.receiveShadow = false;
    this.cans.name = 'recessed-cans';
    scene.add(this.cans);
    const ring = new THREE.InstancedMesh(new THREE.RingGeometry(0.2, 0.29, 24).rotateX(Math.PI / 2), material('trim', 'int'), f.cans.length);
    f.cans.forEach((c, i) => ring.setMatrixAt(i, m.makeTranslation(c.x, c.y - 0.005, c.z)));
    ring.castShadow = false;
    scene.add(ring);
  }

  get counts() { return { cans: this.cans.count, clusters: this.points.length, windows: this.windows.length }; }

  /** Re-assigns the pools around the camera (at most ~4 times a second). */
  update(cam: THREE.Vector3, feet: number, inside: boolean, dt: number, force = false) {
    this.timer -= dt;
    if (this.timer > 0 && !force) return;
    this.timer = 0.25;
    const L = levelOfFeet(feet);

    // electric lights: nearest clusters on this level and the ones next to it
    let nn = 0;
    for (let i = 0; i < this.points.length; i++) {
      const p = this.points[i];
      if (Math.abs(p.level - L) <= 1) nn = pushNearest(len2(p.x - cam.x, p.z - cam.z) + Math.abs(p.level - L) * 18, i, POOL, this.nd, this.ni, nn);
    }
    for (let i = 0; i < this.pool.length; i++) {
      const l = this.pool[i];
      if (i >= nn || this.lightsOn <= 0.001) { l.intensity = 0; continue; }
      const p = this.points[this.ni[i]];
      l.position.set(p.x, p.y, p.z);
      l.distance = p.radius * 1.6;
      // candela from lumens (lm / 4π), in this scene's foot-based units
      l.intensity = (p.lumens / (4 * Math.PI)) * 0.075 * this.lightsOn;
    }

    // daylight through the nearest big glass walls on this level
    let nw = 0;
    for (let i = 0; i < this.windows.length; i++) {
      const w = this.windows[i];
      if (w.level === L || !inside) nw = pushNearest(len2(w.cx - cam.x, w.cz - cam.z) + Math.abs(w.level - L) * 30, i, WINDOWS, this.wd, this.wi, nw);
    }
    for (let i = 0; i < this.rects.length; i++) {
      const r = this.rects[i];
      if (i >= nw || this.daylight <= 0.001) { r.intensity = 0; continue; }
      const w = this.windows[this.wi[i]];
      r.width = w.w; r.height = w.h;
      r.position.set(w.cx + w.nx * 0.3, w.cy, w.cz + w.nz * 0.3);
      r.lookAt(w.cx + w.nx * 5, w.cy, w.cz + w.nz * 5);
      // brighter when the sun shines toward this glass (it faces outward along -n)
      const facing = Math.max(0, -(this.sunBoost.x * w.nx + this.sunBoost.z * w.nz));
      r.color.copy(this.daylightColor);
      r.intensity = this.daylight * (0.5 + 1.0 * facing);
    }
  }

  /** Emissive strength of the cans: they bloom at night. */
  setLightsOn(v: number) {
    this.lightsOn = v;
    const m = this.cans.material as THREE.MeshStandardMaterial;
    m.emissive.copy(LAMP);
    // every lamp-like emissive (cans, shades, globes) follows the switch, each at its own brightness
    for (let i = 0; i < EMISSIVE_FIXTURES.length; i++) { const f = EMISSIVE_FIXTURES[i]; f.emissiveIntensity = (f.userData.glowDay ?? 0) + (f.userData.glow ?? 28) * v; }
  }
}
