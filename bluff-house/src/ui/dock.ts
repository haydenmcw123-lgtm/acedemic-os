import { fmtClock } from '../lighting/sun';
import { PRESETS, TIME_RANGE } from '../lighting/timeofday';

export type Quality = 'auto' | 'high' | 'medium' | 'low';

export interface DockHandlers {
  onTour(): void;
  onTime(h: number): void;
  onSizes(): void;
  onMeasure(): void;
  onFurnished(): void;
  onQuality(q: Quality): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

/** Smoked-glass control dock at the bottom center, plus the shortcut card (H) and toasts. */
export class Dock {
  readonly root = el('div', 'dock');
  private tourBtn = el('button', 'btn tour');
  private time = el('input') as HTMLInputElement;
  private timeVal = el('span', 'time-val');
  private sizesBtn = el('button', 'btn toggle');
  private measureBtn = el('button', 'btn toggle');
  private furnBtn = el('button', 'btn toggle');
  private quality = el('select', 'quality') as HTMLSelectElement;
  private hint = el('div', 'hint');
  private toastEl = el('div', 'toast');
  private toastTimer = 0;

  constructor(h: DockHandlers) {
    this.root.setAttribute('role', 'toolbar');
    this.root.setAttribute('aria-label', 'Walkthrough controls');
    this.tourBtn.addEventListener('click', h.onTour);

    const timeBox = el('div', 'time');
    const head = el('div', 'time-head');
    head.append(el('span', 'lab', 'Time of day'), this.timeVal);
    Object.assign(this.time, { type: 'range', min: String(TIME_RANGE.min), max: String(TIME_RANGE.max), step: '0.05' });
    this.time.setAttribute('aria-label', 'Time of day');
    this.time.addEventListener('input', () => h.onTime(parseFloat(this.time.value)));
    const presets = el('div', 'presets');
    for (const [name, hr] of PRESETS) {
      const b = el('button', 'btn preset', name);
      b.addEventListener('click', () => h.onTime(hr));
      presets.append(b);
    }
    timeBox.append(head, this.time, presets);

    this.sizesBtn.innerHTML = 'Room sizes <kbd>L</kbd>';
    this.measureBtn.innerHTML = 'Measure <kbd>M</kbd>';
    this.furnBtn.innerHTML = 'Furnished <kbd>F</kbd>';
    this.furnBtn.title = 'Furnished ↔ Empty · click a sofa, bed, chair or rug to change its finish';
    this.furnBtn.setAttribute('aria-pressed', 'true');
    this.sizesBtn.addEventListener('click', h.onSizes);
    this.measureBtn.addEventListener('click', h.onMeasure);
    this.furnBtn.addEventListener('click', h.onFurnished);
    const toggles = el('div', 'toggles');
    toggles.append(this.sizesBtn, this.measureBtn, this.furnBtn);

    for (const [v, label] of [['auto', 'Auto'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']] as const) {
      const o = el('option'); o.value = v; o.textContent = label; this.quality.append(o);
    }
    this.quality.setAttribute('aria-label', 'Quality');
    this.quality.addEventListener('change', () => h.onQuality(this.quality.value as Quality));
    const q = el('label', 'q');
    q.append(el('span', 'lab', 'Quality'), this.quality);

    this.root.append(this.tourBtn, el('div', 'sep'), timeBox, el('div', 'sep'), toggles, el('div', 'sep'), q);

    this.hint.innerHTML = `<div class="hint-title">Shortcuts</div>
      <div class="keys">
        <div><kbd>Space</kbd> pause tour · walk</div><div><kbd>W A S D</kbd> move</div>
        <div><kbd>Shift</kbd> sprint</div><div><kbd>R</kbd> resume tour</div>
        <div><kbd>L</kbd> room sizes</div><div><kbd>M</kbd> measure</div>
        <div><kbd>F</kbd> furnished · empty</div><div><kbd>Click</kbd> sofa/bed/rug finish</div><div><kbd>T</kbd> next time of day</div>
        <div><kbd>H</kbd> this card</div><div><kbd>Esc</kbd> release mouse · cancel</div>
      </div>`;
    this.hint.hidden = true;
    document.body.append(this.root, this.hint, this.toastEl);
  }

  setTour(playing: boolean) {
    this.tourBtn.innerHTML = playing ? '<span class="ico">❚❚</span> Pause tour' : '<span class="ico">▶</span> Resume tour';
    this.tourBtn.setAttribute('aria-pressed', String(playing));
  }
  setTime(h: number) { this.time.value = String(h); this.timeVal.textContent = fmtClock(h); }
  setSizes(on: boolean) { this.sizesBtn.setAttribute('aria-pressed', String(on)); }
  setMeasure(on: boolean) { this.measureBtn.setAttribute('aria-pressed', String(on)); }
  setFurnished(on: boolean) { this.furnBtn.setAttribute('aria-pressed', String(on)); }
  setQuality(q: Quality) { this.quality.value = q; }
  toggleHint() { this.hint.hidden = !this.hint.hidden; }

  toast(msg: string, ms = 2600) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('on');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('on'), ms);
  }
}
