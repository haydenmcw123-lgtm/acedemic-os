import * as THREE from 'three';
import type { MeshBVH } from 'three-mesh-bvh';
import { FLOOR_Y, house, levelOfFeet } from '../data/house';
import type { Room } from '../data/types';
import { PLAYER } from '../player/controller';
import { sightBlocked } from '../player/sight';
import { roomDims } from './where';

interface Label { room: Room; el: HTMLDivElement; p: THREE.Vector3; visible: boolean }

/**
 * Room-size labels (L): one per room on your level, floating at eye height over the room's
 * largest rectangle, hidden when a wall (not glass) is between you and it.
 */
export class RoomLabels {
  on = false;
  private labels: Label[] = [];
  private layer = document.getElementById('labels')!;
  private v = new THREE.Vector3();
  private losTimer = 0;

  constructor(private bvh: MeshBVH, private opaque: Uint8Array) {
    for (const room of house.rooms) {
      if (room.void || room.stair) continue;
      const big = [...room.rects].sort((a, b) => (b[2] - b[0]) * (b[3] - b[1]) - (a[2] - a[0]) * (a[3] - a[1]))[0];
      const el = document.createElement('div');
      el.className = 'dim';
      el.innerHTML = `<b>${room.name}</b>${roomDims(room).split(' · ')[0]}`;
      el.hidden = true;
      this.layer.append(el);
      this.labels.push({ room, el, p: new THREE.Vector3((big[0] + big[2]) / 2, FLOOR_Y[room.level] + PLAYER.eye, (big[1] + big[3]) / 2), visible: false });
    }
  }

  toggle() { this.on = !this.on; if (!this.on) for (const l of this.labels) l.el.hidden = true; return this.on; }

  update(cam: THREE.PerspectiveCamera, feet: number, dt: number) {
    if (!this.on) return;
    cam.updateMatrixWorld();
    const L = levelOfFeet(feet);
    this.losTimer -= dt;
    const checkLos = this.losTimer <= 0;
    if (checkLos) this.losTimer = 0.1;
    const W = innerWidth, H = innerHeight;
    for (const l of this.labels) {
      const dist = l.p.distanceTo(cam.position);
      let show = l.room.level === L && dist < 90 && dist > 5; // skip the label you're standing under
      if (show && checkLos) l.visible = !sightBlocked(this.bvh, this.opaque, cam.position, l.p);
      show = show && l.visible;
      if (show) {
        this.v.copy(l.p).project(cam);
        if (this.v.z > 1 || Math.abs(this.v.x) > 1.05 || Math.abs(this.v.y) > 1.05) show = false;
        else { l.el.style.left = `${(this.v.x * 0.5 + 0.5) * W}px`; l.el.style.top = `${(-this.v.y * 0.5 + 0.5) * H}px`; }
      }
      l.el.hidden = !show;
    }
  }

  /** Room ids whose labels are currently shown (tests). */
  shown() { return this.labels.filter((l) => !l.el.hidden).map((l) => l.room.id); }
}
