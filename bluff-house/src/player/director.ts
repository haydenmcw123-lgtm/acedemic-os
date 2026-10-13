import * as THREE from 'three';
import { PLAYER, type MoveInput, type PlayerController } from './controller';
import { Tour, TOUR } from './tour';

export type Mode = 'tour' | 'walk';

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const sstep = (t: number) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };

/**
 * Owns the camera: either the guided tour drives it, or free walk does.
 * Space hands the tour's exact pose to free walk; R (or Space again) resumes the tour from the
 * nearest point on the path at the same level, blending the camera there over ~1 s.
 */
export class Director {
  mode: Mode = 'tour';
  /** Head-bob phase (radians) and amplitude (0..1, scales with walking speed). */
  private bobPhase = 0;
  private bobAmp = 0;
  /** Resume blend: time left and the pose we started from. */
  private blendT = 0;
  private blendFrom = { x: 0, z: 0, camFeet: 0, yaw: 0, pitch: 0 };
  private blendX = 0; private blendZ = 0; private blendFeet = 0; private blendYaw = 0; private blendPitch = 0;
  /** Ground height along every tour sample, so "nearest point" can stay on your floor. */
  readonly sampleFeet: Float32Array;
  onModeChange: (m: Mode) => void = () => {};
  onTourDone: () => void = () => {};

  constructor(readonly player: PlayerController, readonly tour: Tour) {
    // walk the path once to know the floor under each sample (stairs included)
    this.sampleFeet = new Float32Array(tour.samples.length);
    let f = player.groundAt(tour.samples[0].x, tour.samples[0].z, 200, 400) ?? 0;
    tour.samples.forEach((p, i) => {
      const g = player.groundAt(p.x, p.z, f, 20);
      if (g !== null) f = g;
      this.sampleFeet[i] = f;
    });
    this.placeAtTourStart();
  }

  placeAtTourStart() {
    const p = this.tour.pose();
    this.player.x = p.x; this.player.z = p.z;
    this.player.feet = this.player.camFeet = this.sampleFeet[0];
    this.player.camVel = 0;
    this.player.yaw = Math.atan2(-(p.lookX - p.x), -(p.lookZ - p.z));
    this.player.pitch = -0.02;
  }

  /** Space: pause into free walk at this exact spot, or resume if already walking. */
  toggle() { if (this.mode === 'tour') this.pause(); else this.resume(); }

  pause() {
    if (this.mode === 'walk') return;
    this.mode = 'walk';
    this.tour.playing = false;
    this.player.vx = this.player.vz = 0;
    this.blendT = 0;
    this.onModeChange(this.mode);
  }

  /** R: resume from the nearest path point on this level, blending over TOUR.resumeBlend seconds. */
  resume() {
    const pl = this.player, tour = this.tour;
    if (tour.done) tour.restart();
    tour.s = tour.nearest(pl.x, pl.z, (i) => Math.abs(this.sampleFeet[i] - pl.feet) < 3);
    tour.dwell = 0; tour.dwellStop = -1; tour.playing = true; tour.done = false;
    this.blendFrom = { x: pl.x, z: pl.z, camFeet: pl.camFeet, yaw: pl.yaw, pitch: pl.pitch };
    this.blendX = pl.x; this.blendZ = pl.z; this.blendFeet = pl.camFeet; this.blendYaw = pl.yaw; this.blendPitch = pl.pitch;
    this.blendT = TOUR.resumeBlend;
    this.mode = 'tour';
    this.onModeChange(this.mode);
  }

  restart() { this.tour.restart(); this.placeAtTourStart(); this.blendT = 0; this.mode = 'tour'; this.onModeChange(this.mode); }

  update(dt: number, input: MoveInput, look: [number, number]) {
    const pl = this.player;
    if (this.mode === 'walk') {
      pl.yaw -= look[0] * 0.0022;
      pl.pitch = THREE.MathUtils.clamp(pl.pitch - look[1] * 0.0022, -1.35, 1.35);
      const before = pl.walked;
      pl.step(dt, input);
      const v = Math.hypot(pl.vx, pl.vz);
      this.bob(pl.walked - before, v / PLAYER.walkSpeed, dt);
      return;
    }

    // ---- tour ----
    const pose = this.tour.update(dt);
    const px = pl.x, pz = pl.z;
    // feet follow the walkable surface under the camera; the camera height is spring-smoothed
    const g = pl.groundAt(pose.x, pose.z, pl.feet, 20);
    pl.x = pose.x; pl.z = pose.z;
    if (g !== null) pl.feet = g;
    pl.updateCamFeet(dt);
    // look: along the path with a lead, eased toward the stop's look-at during dwells
    const dx = pose.lookX - pose.x, dz = pose.lookZ - pose.z;
    const tYaw = Math.atan2(-dx, -dz);
    let tPitch = -0.03;
    if (pose.lookY !== null) {
      const eye = pl.camFeet + PLAYER.eye, ty = pl.feet + pose.lookY;
      tPitch = THREE.MathUtils.lerp(-0.03, Math.atan2(ty - eye, Math.hypot(dx, dz)), pose.lookWeight);
    }
    const tdt = dt * this.tour.mult;
    const k = 1 - Math.exp(-TOUR.lookRate * tdt);
    const cap = TOUR.maxTurn * tdt;
    pl.yaw += THREE.MathUtils.clamp(wrap(tYaw - pl.yaw) * k, -cap, cap);
    pl.pitch += THREE.MathUtils.clamp((tPitch - pl.pitch) * k, -cap, cap);
    this.bob(Math.hypot(pl.x - px, pl.z - pz), pose.speed / TOUR.speed, dt);

    if (this.blendT > 0) {
      this.blendT = Math.max(0, this.blendT - dt);
      const w = sstep(1 - this.blendT / TOUR.resumeBlend), f = this.blendFrom;
      this.blendX = f.x + (pl.x - f.x) * w; this.blendZ = f.z + (pl.z - f.z) * w;
      this.blendFeet = f.camFeet + (pl.camFeet - f.camFeet) * w;
      this.blendYaw = f.yaw + wrap(pl.yaw - f.yaw) * w; this.blendPitch = f.pitch + (pl.pitch - f.pitch) * w;
    }
    if (this.tour.done) { this.pause(); this.onTourDone(); }
  }
  private bob(dist: number, speedFrac: number, dt: number) {
    this.bobPhase += (dist / TOUR.stride) * Math.PI;
    const target = Math.min(1, Math.max(0, speedFrac));
    this.bobAmp += (target - this.bobAmp) * Math.min(1, dt * 4);
  }

  /** Writes the final camera transform (including head-bob and the resume blend). */
  apply(cam: THREE.PerspectiveCamera) {
    const pl = this.player;
    let x = pl.x, z = pl.z, feet = pl.camFeet, yaw = pl.yaw, pitch = pl.pitch;
    if (this.mode === 'tour' && this.blendT > 0) { x = this.blendX; z = this.blendZ; feet = this.blendFeet; yaw = this.blendYaw; pitch = this.blendPitch; }
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 2 * TOUR.bobY - TOUR.bobY;
    const roll = Math.sin(this.bobPhase) * THREE.MathUtils.degToRad(TOUR.bobRollDeg);
    cam.position.set(x, feet + PLAYER.eye + bobY * this.bobAmp, z);
    cam.rotation.set(pitch, yaw, roll * this.bobAmp, 'YXZ');
  }

  /** Camera position as applied (for tests). */
  cameraPose() {
    const pl = this.player;
    if (this.mode === 'tour' && this.blendT > 0) return { x: this.blendX, z: this.blendZ, feet: this.blendFeet, yaw: this.blendYaw };
    return { x: pl.x, z: pl.z, feet: pl.camFeet, yaw: pl.yaw };
  }
}
