import * as THREE from 'three';
import type { MeshBVH } from 'three-mesh-bvh';

/** 14.6 → "14′ 7″" (rounded to the nearest inch). */
export function feetInches(ft: number): string {
  let inches = Math.round(ft * 12);
  const f = Math.floor(inches / 12);
  inches -= f * 12;
  return `${f}′ ${inches}″`;
}

/**
 * Measuring (M): click two points on any surface; a line and a feet-inches label stay until the
 * next measurement. Esc cancels. With the mouse captured, the crosshair (screen center) picks.
 */
export class Measure {
  on = false;
  private a: THREE.Vector3 | null = null;
  private hover: THREE.Vector3 | null = null;
  private group = new THREE.Group();
  private line: THREE.Line;
  private dots: THREE.Mesh[] = [];
  private label = document.createElement('div');
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private cross = document.getElementById('cross')!;
  /** Finished measurement (tests read it). */
  last: { a: THREE.Vector3; b: THREE.Vector3; ft: number; text: string } | null = null;

  constructor(scene: THREE.Scene, private bvh: MeshBVH) {
    const lm = new THREE.LineBasicMaterial({ color: 0xe9b77a, depthTest: false, transparent: true });
    this.line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), lm);
    this.line.renderOrder = 10;
    const dm = new THREE.MeshBasicMaterial({ color: 0xe9b77a, depthTest: false });
    for (let i = 0; i < 2; i++) { const d = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), dm); d.renderOrder = 10; this.dots.push(d); this.group.add(d); }
    this.group.add(this.line);
    this.group.visible = false;
    scene.add(this.group);
    this.label.className = 'meas';
    this.label.hidden = true;
    document.getElementById('labels')!.append(this.label);
  }

  toggle() { this.on = !this.on; if (!this.on) this.cancel(); this.cross.classList.toggle('on', this.on); return this.on; }

  cancel() { this.a = null; this.hover = null; this.group.visible = false; this.label.hidden = true; }

  /** Surface point under normalized device coords (−1..1), or null. */
  pick(cam: THREE.Camera, nx: number, ny: number): THREE.Vector3 | null {
    this.ndc.set(nx, ny);
    cam.updateMatrixWorld();
    this.ray.setFromCamera(this.ndc, cam);
    const hit = this.bvh.raycastFirst(this.ray.ray, THREE.DoubleSide, 0.2, 400);
    return hit ? hit.point.clone() : null;
  }

  move(cam: THREE.Camera, nx: number, ny: number) { if (this.on && this.a) this.hover = this.pick(cam, nx, ny); }

  click(cam: THREE.Camera, nx: number, ny: number) {
    if (!this.on) return;
    const p = this.pick(cam, nx, ny);
    if (!p) return;
    if (!this.a) { this.a = p; this.hover = p; this.last = null; }
    else {
      const ft = this.a.distanceTo(p);
      this.last = { a: this.a, b: p, ft, text: feetInches(ft) };
      this.hover = p; this.a = null;
    }
  }

  update(cam: THREE.Camera) {
    const a = this.a ?? this.last?.a, b = this.a ? this.hover : this.last?.b;
    if (!this.on || !a || !b) { this.group.visible = false; this.label.hidden = true; return; }
    this.group.visible = true;
    const pos = this.line.geometry.attributes.position as THREE.BufferAttribute;
    pos.setXYZ(0, a.x, a.y, a.z); pos.setXYZ(1, b.x, b.y, b.z); pos.needsUpdate = true;
    this.line.geometry.computeBoundingSphere();
    this.dots[0].position.copy(a); this.dots[1].position.copy(b);
    cam.updateMatrixWorld();
    const mid = a.clone().add(b).multiplyScalar(0.5).project(cam);
    if (mid.z > 1) { this.label.hidden = true; return; }
    this.label.hidden = false;
    this.label.textContent = feetInches(a.distanceTo(b));
    this.label.style.left = `${(mid.x * 0.5 + 0.5) * innerWidth}px`;
    this.label.style.top = `${(-mid.y * 0.5 + 0.5) * innerHeight}px`;
  }
}
