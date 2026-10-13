import * as THREE from 'three';
import type { MeshBVH } from 'three-mesh-bvh';
import type { DynamicBlocker } from '../build/context';

export interface MoveInput { forward: number; right: number; sprint: boolean }

/** Capsule and movement tuning, in feet and seconds. */
export const PLAYER = {
  radius: 1.0,
  height: 5.75,
  eye: 5.5,
  stepUp: 0.65, // treads and thresholds up to this height are stepped onto
  maxDrop: 1.0, // ledges higher than this block you instead of letting you fall
  walkable: 0.7, // surfaces with normal.y above this are ground; below it they're walls
  walkSpeed: 4.6,
  sprint: 2,
  accel: 14, // how quickly velocity reaches the target (1/s)
  decel: 10,
  camSpring: 9, // critically damped camera height spring (rad/s): stairs feel like stairs
};

const _seg = new THREE.Line3();
const _box = new THREE.Box3();
const _triPt = new THREE.Vector3();
const _capPt = new THREE.Vector3();
const _n = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _ray = new THREE.Ray();
const _down = new THREE.Vector3(0, -1, 0);

/**
 * First-person capsule controller against a three-mesh-bvh collider.
 * Horizontal: the capsule (raised by the step height) is pushed out of every steep triangle.
 * Vertical: the feet follow the highest walkable surface under the capsule center, so the
 * invisible stair ramps carry you smoothly; drops over ~1 ft are refused (ledges, the pool, decks).
 */
export class PlayerController {
  x = 0; z = 0; feet = 0;
  camFeet = 0; camVel = 0;
  yaw = 0; pitch = 0;
  vx = 0; vz = 0;
  /** Distance walked, drives head-bob later. */
  walked = 0;

  constructor(private bvh: MeshBVH, private blockers: DynamicBlocker[]) {}

  teleport(x: number, z: number, feet?: number) {
    this.x = x; this.z = z;
    const g = this.groundAt(x, z, feet ?? 200, 400);
    this.feet = g ?? feet ?? 0;
    this.camFeet = this.feet; this.camVel = 0; this.vx = this.vz = 0;
  }

  /** Highest walkable surface at (x, z) at or below `fromFeet + stepUp`, searching `range` ft down. */
  groundAt(x: number, z: number, fromFeet: number, range = PLAYER.stepUp + PLAYER.maxDrop + 0.1): number | null {
    const top = fromFeet + PLAYER.stepUp + 0.02;
    _ray.origin.set(x, top, z); _ray.direction.copy(_down);
    const hits = this.bvh.raycast(_ray, THREE.DoubleSide, 0, range + PLAYER.stepUp);
    let best: number | null = null;
    for (const h of hits) {
      if (!h.face || h.face.normal.y < PLAYER.walkable) continue;
      const y = h.point.y;
      if (best === null || y > best) best = y;
    }
    return best;
  }

  /** True if the capsule at (x, z, feet) overlaps any wall-like geometry (used by tests). */
  overlaps(x: number, z: number, feet: number, r = PLAYER.radius): boolean {
    let hit = false;
    this.capsule(x, z, feet, r);
    this.bvh.shapecast({
      intersectsBounds: (b) => b.intersectsBox(_box),
      intersectsTriangle: (tri) => {
        tri.getNormal(_n);
        if (Math.abs(_n.y) > PLAYER.walkable) return false;
        if (tri.closestPointToSegment(_seg, _triPt, _capPt) < r - 1e-3) { hit = true; return true; }
        return false;
      },
    });
    if (!hit) for (const b of this.blockers) if (b.enabled && blockerPush(b, x, z, feet, r)) { hit = true; break; }
    return hit;
  }

  private capsule(x: number, z: number, feet: number, r: number) {
    _seg.start.set(x, feet + PLAYER.stepUp + r, z);
    _seg.end.set(x, feet + PLAYER.height - r, z);
    _box.makeEmpty(); _box.expandByPoint(_seg.start); _box.expandByPoint(_seg.end);
    _box.min.addScalar(-r); _box.max.addScalar(r);
  }

  /** Pushes (x, z) out of walls; returns the corrected position. */
  private resolve(x: number, z: number, feet: number): [number, number] {
    const r = PLAYER.radius;
    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      this.capsule(x, z, feet, r);
      this.bvh.shapecast({
        intersectsBounds: (b) => b.intersectsBox(_box),
        intersectsTriangle: (tri) => {
          tri.getNormal(_n);
          if (Math.abs(_n.y) > PLAYER.walkable) return false;
          const d = tri.closestPointToSegment(_seg, _triPt, _capPt);
          if (d < r) {
            _dir.subVectors(_capPt, _triPt); _dir.y = 0;
            let len = _dir.length();
            if (len < 1e-5) { _dir.set(_n.x, 0, _n.z); len = _dir.length() || 1; }
            _dir.divideScalar(len);
            const push = r - d + 1e-4;
            _seg.start.addScaledVector(_dir, push); _seg.end.addScaledVector(_dir, push);
            moved = true;
          }
          return false;
        },
      });
      x = _seg.start.x; z = _seg.start.z;
      for (const b of this.blockers) {
        if (!b.enabled) continue;
        const p = blockerPush(b, x, z, feet, r);
        if (p) { x += p[0]; z += p[1]; moved = true; }
      }
      if (!moved) break;
    }
    return [x, z];
  }

  /** Tries to move by (dx, dz). Returns false if a ledge or wall stopped it. */
  private tryMove(dx: number, dz: number): boolean {
    let [nx, nz] = this.resolve(this.x + dx, this.z + dz, this.feet);
    const g = this.groundAt(nx, nz, this.feet);
    if (g === null || this.feet - g > PLAYER.maxDrop) return false;
    // settle at the new height and make sure we still fit (stairs change feet)
    [nx, nz] = this.resolve(nx, nz, g);
    const g2 = this.groundAt(nx, nz, g);
    if (g2 === null || g - g2 > PLAYER.maxDrop) return false;
    this.walked += Math.hypot(nx - this.x, nz - this.z);
    this.x = nx; this.z = nz; this.feet = g2;
    return true;
  }

  /** Free-walk step: input is relative to yaw. */
  step(dt: number, input: MoveInput) {
    const speed = PLAYER.walkSpeed * (input.sprint ? PLAYER.sprint : 1);
    let fx = -Math.sin(this.yaw) * input.forward + Math.cos(this.yaw) * input.right;
    let fz = -Math.cos(this.yaw) * input.forward - Math.sin(this.yaw) * input.right;
    const fl = Math.hypot(fx, fz);
    if (fl > 1) { fx /= fl; fz /= fl; }
    const tx = fx * speed, tz = fz * speed;
    const rate = fl > 0.01 ? PLAYER.accel : PLAYER.decel;
    const k = 1 - Math.exp(-rate * dt);
    this.vx += (tx - this.vx) * k; this.vz += (tz - this.vz) * k;
    if (Math.hypot(this.vx, this.vz) < 0.02 && fl < 0.01) { this.vx = this.vz = 0; }

    const dx = this.vx * dt, dz = this.vz * dt;
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.35));
    for (let i = 0; i < n; i++) {
      const sx = dx / n, sz = dz / n;
      if (this.tryMove(sx, sz)) continue;
      // slide along whichever axis still works
      const okX = Math.abs(sx) > 1e-6 && this.tryMove(sx, 0);
      const okZ = Math.abs(sz) > 1e-6 && this.tryMove(0, sz);
      if (!okX) this.vx *= 0.2;
      if (!okZ) this.vz *= 0.2;
      if (!okX && !okZ) break;
    }
    this.updateCamFeet(dt);
  }

  /** Critically damped spring so the eye glides over steps instead of snapping. */
  updateCamFeet(dt: number) {
    const w = PLAYER.camSpring;
    const a = w * w * (this.feet - this.camFeet) - 2 * w * this.camVel;
    this.camVel += a * dt; this.camFeet += this.camVel * dt;
    if (Math.abs(this.feet - this.camFeet) > 3) { this.camFeet = this.feet; this.camVel = 0; }
  }

  applyCamera(cam: THREE.PerspectiveCamera) {
    cam.position.set(this.x, this.camFeet + PLAYER.eye, this.z);
    cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}

/** Circle (capsule cross-section) vs oriented box in plan. Returns the push-out vector or null. */
function blockerPush(b: DynamicBlocker, x: number, z: number, feet: number, r: number): [number, number] | null {
  if (b.y1 < feet + PLAYER.stepUp || b.y0 > feet + PLAYER.height) return null;
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  const wx = x - b.cx, wz = z - b.cz;
  // world → local is the inverse of local → world (x c + z s, -x s + z c)
  const lx = wx * c - wz * s, lz = wx * s + wz * c;
  const qx = Math.max(-b.hw, Math.min(b.hw, lx)), qz = Math.max(-b.hd, Math.min(b.hd, lz));
  let ddx = lx - qx, ddz = lz - qz;
  let d = Math.hypot(ddx, ddz);
  if (d >= r) return null;
  if (d < 1e-6) {
    // center inside the box: push out along the shallowest axis
    const px = b.hw - Math.abs(lx), pz = b.hd - Math.abs(lz);
    if (px < pz) { ddx = Math.sign(lx) || 1; ddz = 0; d = -px; } else { ddx = 0; ddz = Math.sign(lz) || 1; d = -pz; }
    const L = Math.hypot(ddx, ddz); ddx /= L; ddz /= L;
  } else { ddx /= d; ddz /= d; }
  const push = r - d + 1e-4;
  const plx = ddx * push, plz = ddz * push;
  return [plx * c + plz * s, -plx * s + plz * c];
}
