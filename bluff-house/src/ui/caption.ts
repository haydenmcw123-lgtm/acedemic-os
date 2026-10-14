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
  /**
   * Film mode (video recording): fades run on simulation time instead of wall-clock timers and
   * CSS transitions, so a frame-by-frame render shows the same fade it would live.
   */
  film = false;
  private shownFor = 1e9;

  constructor(public holdMs = 2500) { this.root.classList.add('fade'); }

  /** Call every frame; a new place must persist for 0.25 s before it's announced (no flicker at doorways). */
  update(w: Where, dt: number) {
    if (this.film) this.filmFade(dt);
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
    this.shownFor = 0;
    if (this.film) return;
    this.root.classList.remove('fade');
    clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.root.classList.add('fade'), this.holdMs);
  }

  private filmFade(dt: number) {
    this.shownFor += dt;
    const t = this.shownFor, hold = this.holdMs / 1000;
    const a = t < 0.35 ? t / 0.35 : t < 0.35 + hold ? 1 : Math.max(0, 1 - (t - 0.35 - hold) / 0.6);
    this.root.classList.remove('fade');
    this.root.style.transition = 'none';
    this.root.style.opacity = a.toFixed(3);
    this.root.style.transform = `translateY(${(-4 * (1 - a)).toFixed(2)}px)`;
  }
}
