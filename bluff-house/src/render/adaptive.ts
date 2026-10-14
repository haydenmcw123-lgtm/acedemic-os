/**
 * Adaptive quality (Stage 6), active when Quality is "Auto".
 *
 * Watches a 2-second rolling average of the frame time:
 *   - over 20 ms → step down one tier (sharpness first, then AO, then lake reflections, then shadows);
 *   - under 12 ms for 10 s straight → step up one tier.
 * The 12–20 ms gap is the hysteresis band: nothing happens inside it.
 *
 * A 60 Hz display never shows a frame interval under 16.7 ms however light the scene is, so a
 * steady 60 Hz vsync lock (every frame 16–17.5 ms for 10 s) also counts as headroom — but only as
 * a *probe*: if that step up costs a step down within 30 s, the tier above is locked for the rest of
 * the session (until the window is resized or the quality is changed). A tier can fail at most
 * once, so the quality can never oscillate.
 *
 * Allocation-free: a fixed ring buffer of frame times.
 */
export interface Tier { label: string; pixelRatio: number; aoSamples: number; ao: boolean; lake: boolean; shadow: number }

export const TIERS: readonly Tier[] = [
  { label: 'full', pixelRatio: 1, ao: true, aoSamples: 16, lake: true, shadow: 4096 },
  { label: '0.85× res', pixelRatio: 0.85, ao: true, aoSamples: 16, lake: true, shadow: 4096 },
  { label: '0.75× res', pixelRatio: 0.75, ao: true, aoSamples: 16, lake: true, shadow: 4096 },
  { label: 'AO 8 samples', pixelRatio: 0.75, ao: true, aoSamples: 8, lake: true, shadow: 4096 },
  { label: 'AO off', pixelRatio: 0.75, ao: false, aoSamples: 8, lake: true, shadow: 4096 },
  { label: 'no lake reflection', pixelRatio: 0.75, ao: false, aoSamples: 8, lake: false, shadow: 4096 },
  { label: 'shadows 2k', pixelRatio: 0.75, ao: false, aoSamples: 8, lake: false, shadow: 2048 },
  { label: 'shadows 1k', pixelRatio: 0.75, ao: false, aoSamples: 8, lake: false, shadow: 1024 },
];

export const ADAPT = {
  windowMs: 2000, downMs: 20, upMs: 12, upHoldMs: 10_000, vsyncLo: 16, vsyncHi: 17.5, probeFailMs: 30_000,
  /** Gaps longer than this (a background tab, a breakpoint) are not frames: the window restarts. */
  gapMs: 250,
};

const CAP = 1024; // ≥ 2 s at 500 fps

export class AdaptiveQuality {
  tier = 0;
  /** Highest tier index (lowest quality) is TIERS.length - 1; tiers < ceiling are locked out. */
  ceiling = 0;
  changes = 0;
  readonly log: { t: number; from: number; to: number; avg: number; why: string }[] = [];
  private ring = new Float64Array(CAP);
  private head = 0; private n = 0; private sum = 0;
  private now = 0;
  private goodMs = 0; private vsyncMs = 0;
  private lastUp = -Infinity;

  constructor(private apply: (t: Tier, index: number) => void) {}

  /** Back to full quality with no locks (the user picked Auto again, or resized the window). */
  reset() {
    this.ceiling = 0; this.lastUp = -Infinity; this.clearWindow();
    if (this.tier !== 0) { this.tier = 0; this.apply(TIERS[0], 0); }
  }

  get average() { return this.n ? this.sum / this.n : 0; }
  get label() { return TIERS[this.tier].label; }

  private clearWindow() { this.head = 0; this.n = 0; this.sum = 0; this.goodMs = 0; this.vsyncMs = 0; }

  /** Feed one frame interval (ms, unclamped). Returns true if the tier changed. */
  sample(ms: number): boolean {
    if (!(ms > 0)) return false;
    if (ms > ADAPT.gapMs) { this.clearWindow(); return false; }
    this.now += ms;
    // push, then drop the oldest frames until the window spans 2 s
    const r = this.ring;
    r[(this.head + this.n) % CAP] = ms; this.sum += ms;
    if (this.n < CAP) this.n++; else { this.sum -= r[this.head]; this.head = (this.head + 1) % CAP; }
    while (this.n > 1 && this.sum - r[this.head] >= ADAPT.windowMs) { this.sum -= r[this.head]; this.head = (this.head + 1) % CAP; this.n--; }
    const full = this.sum >= ADAPT.windowMs * 0.95;
    const avg = this.sum / this.n;

    // headroom clocks: sustained fast frames, or a steady vsync lock with no dropped frames
    this.goodMs = avg < ADAPT.upMs ? this.goodMs + ms : 0;
    this.vsyncMs = ms >= ADAPT.vsyncLo && ms <= ADAPT.vsyncHi ? this.vsyncMs + ms : 0;

    if (full && avg > ADAPT.downMs && this.tier < TIERS.length - 1) {
      // a step up that failed within 30 s locks that tier out for good
      if (this.now - this.lastUp < ADAPT.probeFailMs) this.ceiling = Math.max(this.ceiling, this.tier + 1);
      return this.go(this.tier + 1, avg, 'avg > 20 ms');
    }
    if (this.tier > this.ceiling) {
      if (this.goodMs >= ADAPT.upHoldMs) return this.go(this.tier - 1, avg, 'avg < 12 ms for 10 s');
      if (this.vsyncMs >= ADAPT.upHoldMs) return this.go(this.tier - 1, avg, 'vsync-locked for 10 s (probe)');
    }
    return false;
  }

  private go(to: number, avg: number, why: string) {
    const from = this.tier;
    this.lastUp = to < from ? this.now : -Infinity; // a step down settles any open probe
    this.tier = to; this.changes++;
    this.log.push({ t: Math.round(this.now), from, to, avg: +avg.toFixed(1), why });
    this.clearWindow(); // the next decision is made on frames rendered at the new tier
    this.apply(TIERS[to], to);
    return true;
  }
}
