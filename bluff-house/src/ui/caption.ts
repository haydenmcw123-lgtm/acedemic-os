import type { Where } from './where';

/** Room caption: fades in when you enter a room, holds 2.5 s, fades out. */
export class Caption {
  private root = document.getElementById('hud')!;
  private lv = document.getElementById('hudLevel')!;
  private nm = document.getElementById('hudRoom')!;
  private mt = document.getElementById('hudMeta')!;
  private current = '';
  private pending: { w: Where; t: number } | null = null;
  private hideTimer = 0;
  /** Every place the caption has announced, in order (tests read this). */
  readonly log: string[] = [];

  constructor(public holdMs = 2500) { this.root.classList.add('fade'); }

  /** Call every frame; a new place must persist for 0.25 s before it's announced (no flicker at doorways). */
  update(w: Where, dt: number) {
    if (w.key === this.current) { this.pending = null; return; }
    if (!this.pending || this.pending.w.key !== w.key) this.pending = { w, t: 0 };
    this.pending.t += dt;
    if (this.pending.t >= 0.25) { this.show(w); this.pending = null; }
  }

  show(w: Where) {
    this.current = w.key;
    this.log.push(w.key);
    this.lv.textContent = w.level;
    this.nm.textContent = w.name;
    this.mt.textContent = w.meta;
    this.root.classList.remove('fade');
    clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.root.classList.add('fade'), this.holdMs);
  }
}
