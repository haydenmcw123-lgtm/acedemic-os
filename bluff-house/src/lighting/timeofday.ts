import * as THREE from 'three';
import { house } from '../data/house';
import { SHADOW_TARGET, type RenderRig } from '../render/renderer';
import type { InteriorLights } from './interior';
import type { InteriorEnv } from './interiorEnv';
import type { SkyRig } from './sky';
import { sunDay, sunPosition, type SunState } from './sun';

const [Y, M, D] = house.location.date.split('-').map(Number);
const { lat, lon } = house.location;
/** America/New_York on Oct 15 is EDT. */
export const UTC_OFFSET = -4;
export const DAY = sunDay(Y, M, D, lat, lon, UTC_OFFSET);

export const PRESETS: [string, number][] = [['Morning', 8], ['Noon', 12.5], ['Golden', 17.75], ['Sunset', 18.75], ['Night', 20.5]];
export const TIME_RANGE = { min: 6.5, max: 21 };

const sstep = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const SUN_HIGH = new THREE.Color(1.0, 0.96, 0.9), SUN_LOW = new THREE.Color(1.0, 0.62, 0.32);
// horizon haze color by sun elevation (linear RGB)
const HAZE: [number, THREE.Color][] = [
  [-12, new THREE.Color(0.006, 0.009, 0.016)], [-4, new THREE.Color(0.05, 0.05, 0.08)], [0, new THREE.Color(0.32, 0.22, 0.2)],
  [6, new THREE.Color(0.6, 0.48, 0.38)], [16, new THREE.Color(0.58, 0.63, 0.68)], [40, new THREE.Color(0.55, 0.64, 0.72)],
];
function haze(el: number, out: THREE.Color) {
  if (el <= HAZE[0][0]) return out.copy(HAZE[0][1]);
  for (let i = 1; i < HAZE.length; i++) if (el <= HAZE[i][0]) return out.copy(HAZE[i - 1][1]).lerp(HAZE[i][1], (el - HAZE[i - 1][0]) / (HAZE[i][0] - HAZE[i - 1][0]));
  return out.copy(HAZE[HAZE.length - 1][1]);
}

/**
 * Time of day: everything moves together — NOAA sun, the physical sky and its environment map,
 * the haze, the lake tint, interior daylight vs. electric lights (on below ~3° elevation) and the
 * exposure the "eye" adapts to (bright outdoors, opened up indoors and at night).
 */
export class TimeOfDay {
  hour = 17.75;
  sun!: SunState;
  /** Target exposures; the frame loop eases toward one of them. */
  exposureOutside = 1;
  exposureInside = 1.6;
  exposure = 1;
  private shadowTimer = 0;
  private shadowDirty = true;
  private dir = new THREE.Vector3();
  onChange: (h: number) => void = () => {};
  /** Outdoor consumers (the lake, tree impostors): deep water color, haze, sun and sky light. */
  outdoor: ((lake: THREE.Color, haze: THREE.Color, sunDir: THREE.Vector3, sunColor: THREE.Color, sunI: number, sky: THREE.Color, skyI: number) => void) | null = null;
  readonly lakeColor = new THREE.Color();

  private envArgs: Parameters<InteriorEnv['set']> | null = null;
  private envTimer = 0;

  constructor(private rig: RenderRig, private sky: SkyRig, private interior: InteriorLights, private interiorEnv: InteriorEnv) {}

  set(h: number) {
    this.hour = THREE.MathUtils.clamp(h, TIME_RANGE.min, TIME_RANGE.max);
    const s = (this.sun = sunPosition(Y, M, D, this.hour, lat, lon, UTC_OFFSET));
    const el = s.elevation;
    const day = sstep(-6, 10, el); // sky light
    const direct = sstep(-0.8, 6, el); // the sun disc clears the ridgeline
    const lightsOn = 1 - sstep(1, 5, el); // lamps on below ~3°
    const { sun, hemi, scene } = this.rig;
    this.dir.set(...s.dir);
    sun.position.copy(SHADOW_TARGET).addScaledVector(this.dir, 320);
    sun.target.position.copy(SHADOW_TARGET);
    sun.intensity = 3.4 * direct;
    sun.color.copy(SUN_LOW).lerp(SUN_HIGH, sstep(3, 30, el));
    this.sky.setSun(this.dir, 1 - day);
    hemi.intensity = 0.03 + 0.14 * day;
    const fog = scene.fog as THREE.FogExp2;
    haze(el, fog.color);
    fog.density = 0.00032 + 0.0003 * (1 - sstep(-2, 12, el)); // a little hazier at the ends of the day
    hemi.color.copy(fog.color).lerp(new THREE.Color(0.55, 0.68, 0.85), 0.5);
    this.lakeColor.setRGB(0.012, 0.03, 0.035).multiplyScalar(0.25 + 0.75 * day);
    this.outdoor?.(this.lakeColor, fog.color, this.dir, sun.color, sun.intensity, hemi.color, hemi.intensity);
    const it = this.interior;
    it.daylight = day;
    it.daylightColor.copy(fog.color).lerp(new THREE.Color(0.8, 0.86, 0.95), 0.5);
    it.sunBoost.copy(this.dir).multiplyScalar(direct);
    it.setLightsOn(lightsOn);
    const skyTint = new THREE.Color().copy(fog.color).lerp(new THREE.Color(0.62, 0.74, 0.9), 0.55 * day);
    this.envArgs = [day, skyTint, direct, sun.color.clone(), lightsOn];
    // exposure targets: open up as the light fades
    this.exposureOutside = 0.85 + 2.2 * (1 - day);
    this.exposureInside = 1.05 + 0.35 * (1 - day);
    this.shadowDirty = true;
    this.onChange(this.hour);
  }

  /** Shadows and the environment map re-render at most every 250 ms while the time is changing. */
  tick(dt: number, inside: boolean, force = false) {
    this.shadowTimer -= dt;
    if (this.shadowDirty && (this.shadowTimer <= 0 || force)) {
      this.rig.renderer.shadowMap.needsUpdate = true;
      this.shadowDirty = false;
      this.shadowTimer = 0.25;
    }
    this.sky.update(dt, force);
    this.envTimer -= dt;
    if (this.envArgs && (this.envTimer <= 0 || force)) { this.interiorEnv.set(...this.envArgs); this.envArgs = null; this.envTimer = 0.25; }
    const target = inside ? this.exposureInside : this.exposureOutside;
    this.exposure = force ? target : this.exposure + (target - this.exposure) * Math.min(1, dt * 1.8);
  }

  nextPreset() {
    const i = PRESETS.findIndex(([, h]) => h > this.hour + 0.01);
    this.set(PRESETS[i < 0 ? 0 : i][1]);
  }
}
