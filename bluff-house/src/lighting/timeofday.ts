import * as THREE from 'three';
import { house } from '../data/house';
import type { RenderRig } from '../render/renderer';
import { sunDay, sunPosition, type SunState } from './sun';

const [Y, M, D] = house.location.date.split('-').map(Number);
const { lat, lon } = house.location;
/** America/New_York on Oct 15 is EDT. */
export const UTC_OFFSET = -4;
export const DAY = sunDay(Y, M, D, lat, lon, UTC_OFFSET);

export const PRESETS: [string, number][] = [['Morning', 8], ['Noon', 12.5], ['Golden', 17.75], ['Sunset', 18.75], ['Night', 20.5]];
export const TIME_RANGE = { min: 6.5, max: 21 };

const DAY_SKY = new THREE.Color(0xbcd0dc), DUSK_SKY = new THREE.Color(0xd9a58a), NIGHT_SKY = new THREE.Color(0x0d1320);
const SUN_NOON = new THREE.Color(0xfff4e6), SUN_LOW = new THREE.Color(0xffb36b);
const sstep = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * Stage 2 time of day: the sun follows NOAA for Oct 15 at Lake Lure and the clay lighting follows it.
 * Stage 3 replaces the flat sky color with a physical sky + PMREM, fog and interior lights.
 */
export class TimeOfDay {
  hour = 17.75;
  sun!: SunState;
  private shadowTimer = 0;
  private shadowDirty = true;
  onChange: (h: number) => void = () => {};

  constructor(private rig: RenderRig, private target = new THREE.Vector3(30, 10, 45)) {}

  set(h: number) {
    this.hour = THREE.MathUtils.clamp(h, TIME_RANGE.min, TIME_RANGE.max);
    const s = (this.sun = sunPosition(Y, M, D, this.hour, lat, lon, UTC_OFFSET));
    const { sun, hemi, scene, renderer } = this.rig;
    const el = s.elevation;
    const day = sstep(-6, 8, el); // 0 at night, 1 in daylight
    const low = 1 - sstep(4, 25, el); // warm near the horizon
    sun.position.copy(this.target).addScaledVector(new THREE.Vector3(...s.dir), 300);
    sun.target.position.copy(this.target);
    sun.intensity = 3.0 * sstep(-1, 6, el);
    sun.color.copy(SUN_NOON).lerp(SUN_LOW, low);
    hemi.intensity = 0.15 + 1.0 * day;
    const sky = new THREE.Color().copy(NIGHT_SKY).lerp(DUSK_SKY, sstep(-8, 2, el)).lerp(DAY_SKY, sstep(2, 18, el));
    (scene.background as THREE.Color).copy(sky);
    if (scene.fog) (scene.fog as THREE.Fog).color.copy(sky);
    renderer.toneMappingExposure = 0.85 + 0.35 * (1 - day);
    this.shadowDirty = true;
    this.onChange(this.hour);
  }

  /** Shadows re-render at most every 250 ms while the time is changing. */
  tick(dt: number) {
    this.shadowTimer -= dt;
    if (this.shadowDirty && this.shadowTimer <= 0) {
      this.rig.renderer.shadowMap.needsUpdate = true;
      this.shadowDirty = false;
      this.shadowTimer = 0.25;
    }
  }

  nextPreset() {
    const i = PRESETS.findIndex(([, h]) => h > this.hour + 0.01);
    this.set(PRESETS[i < 0 ? 0 : i][1]);
  }
}
