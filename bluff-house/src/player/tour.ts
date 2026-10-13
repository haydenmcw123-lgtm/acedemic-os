import * as THREE from 'three';
import type { TourStop } from '../data/types';

const sstep = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

export const TOUR = {
  speed: 4.4, // ft/s walking pace
  minSpeedFrac: 0.15, // speed right at a dwell stop, as a fraction of walking pace
  easeDist: 3.2, // ft over which we slow into / speed out of a dwell
  lead: 7, // ft ahead along the path the camera looks while walking
  lookRate: 2.6, // 1/s, how fast the view turns toward its target
  maxTurn: 1.7, // rad/s cap, so doubling back is a calm turn rather than a whip-pan
  stride: 2.6, // ft per step, for head-bob
  bobY: 0.04, // ft
  bobRollDeg: 0.15,
  resumeBlend: 1.0, // s
};

export interface TourPose { x: number; z: number; lookX: number; lookZ: number; lookY: number | null; lookWeight: number; speed: number; dwelling: boolean }

/**
 * Guided tour: a centripetal Catmull-Rom spline through the stops, re-sampled by arc length so
 * speed is uniform. Dwell stops slow the walk to a near stop, hold, then ease out again.
 */
export class Tour {
  readonly samples: { x: number; z: number; s: number }[] = [];
  readonly stopS: number[] = [];
  readonly dwellIdx: number[];
  readonly total: number;
  s = 0;
  dwell = 0;
  dwellStop = -1;
  done = false;
  playing = true;
  /** Time multiplier (tests run faster than real time). */
  mult = 1;

  constructor(readonly stops: TourStop[]) {
    const pts = stops.map((p) => new THREE.Vector3(p.x, 0, p.z));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
    const n = pts.length - 1;
    let s = 0;
    let prev: THREE.Vector3 | null = null;
    const p = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      this.stopS[i] = s;
      const steps = Math.max(6, Math.ceil(pts[i].distanceTo(pts[i + 1]) / 0.2));
      for (let k = 0; k < steps; k++) {
        curve.getPoint((i + k / steps) / n, p);
        if (prev) s += p.distanceTo(prev);
        this.samples.push({ x: p.x, z: p.z, s });
        prev = (prev ?? new THREE.Vector3()).copy(p);
      }
    }
    curve.getPoint(1, p);
    s += p.distanceTo(prev!);
    this.samples.push({ x: p.x, z: p.z, s });
    this.stopS[n] = s;
    this.total = s;
    this.dwellIdx = stops.map((st, i) => (st.dwellSec ? i : -1)).filter((i) => i >= 0);
  }

  /** Point on the path at arc length s (binary search + lerp). */
  at(s: number): { x: number; z: number; i: number } {
    const S = this.samples;
    s = Math.min(this.total, Math.max(0, s));
    let lo = 0, hi = S.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m].s < s) lo = m; else hi = m; }
    const a = S[lo], b = S[hi];
    const t = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, i: lo };
  }

  private nextDwell(s: number) { for (const i of this.dwellIdx) if (this.stopS[i] > s + 1e-3) return i; return -1; }
  private prevDwell(s: number) { let r = -1; for (const i of this.dwellIdx) if (this.stopS[i] <= s + 1e-3) r = i; return r; }

  /** Advances the tour by dt seconds and returns where the camera should be and look. */
  update(dt: number): TourPose {
    const d = dt * this.mult;
    let speed = 0;
    if (this.playing && !this.done) {
      if (this.dwell > 0) {
        this.dwell -= d;
        if (this.dwell <= 0) { this.s += 1e-3; this.dwellStop = -1; }
      } else {
        const nd = this.nextDwell(this.s), pd = this.prevDwell(this.s);
        const toNext = nd >= 0 ? this.stopS[nd] - this.s : this.total - this.s;
        const fromPrev = pd >= 0 ? this.s - this.stopS[pd] : this.s;
        const ramp = Math.min(toNext, fromPrev) / TOUR.easeDist;
        speed = TOUR.speed * (TOUR.minSpeedFrac + (1 - TOUR.minSpeedFrac) * sstep(0, 1, ramp));
        const ds = speed * d;
        if (nd >= 0 && this.s + ds >= this.stopS[nd]) {
          this.s = this.stopS[nd]; this.dwell = this.stops[nd].dwellSec!; this.dwellStop = nd;
        } else this.s = Math.min(this.total, this.s + ds);
        if (this.s >= this.total - 1e-3 && nd < 0) this.done = true;
      }
    }
    return this.pose(speed);
  }

  /** Camera target for the current arc position, without advancing. */
  pose(speed = 0): TourPose {
    const p = this.at(this.s);
    const ahead = this.at(this.s + TOUR.lead);
    let lookX = ahead.x, lookZ = ahead.z;
    if (Math.hypot(lookX - p.x, lookZ - p.z) < 0.5) { // at the very end: keep the last heading
      const back = this.at(this.s - TOUR.lead); lookX = p.x + (p.x - back.x); lookZ = p.z + (p.z - back.z);
    }
    // blend toward the dwell stop's look-at target as we approach it, hold through the dwell, release after
    let lookWeight = 0, lookY: number | null = null;
    const nd = this.dwellStop >= 0 ? this.dwellStop : this.nextDwell(this.s);
    const pd = this.prevDwell(this.s);
    const near = (i: number) => (i >= 0 ? 1 - sstep(0, TOUR.easeDist * 2, Math.abs(this.stopS[i] - this.s)) : 0);
    const wN = this.dwellStop >= 0 ? 1 : near(nd), wP = near(pd);
    const pick = wN >= wP ? nd : pd;
    const w = Math.max(wN, wP);
    const st = pick >= 0 ? this.stops[pick] : null;
    if (st?.lookAt && w > 0) {
      lookWeight = w;
      lookX = lookX + (st.lookAt[0] - lookX) * w;
      lookZ = lookZ + (st.lookAt[1] - lookZ) * w;
      lookY = st.lookAt[2];
    }
    return { x: p.x, z: p.z, lookX, lookZ, lookY, lookWeight, speed, dwelling: this.dwell > 0 };
  }

  /** Arc length of the path point nearest (x, z), optionally limited to samples whose feet match. */
  nearest(x: number, z: number, accept?: (sampleIndex: number) => boolean): number {
    let best = Infinity, bs = 0;
    this.samples.forEach((p, i) => {
      if (accept && !accept(i)) return;
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < best) { best = d; bs = p.s; }
    });
    return bs;
  }

  restart() { this.s = 0; this.dwell = 0; this.dwellStop = -1; this.done = false; this.playing = true; }

  /** Total walking + dwelling time at normal speed (s), measured by simulation. */
  durationSec(dt = 1 / 30) {
    const saved = { s: this.s, dwell: this.dwell, dwellStop: this.dwellStop, done: this.done, playing: this.playing, mult: this.mult };
    this.restart(); this.mult = 1;
    let t = 0;
    while (!this.done && t < 3600) { this.update(dt); t += dt; }
    Object.assign(this, saved);
    return t;
  }
}
