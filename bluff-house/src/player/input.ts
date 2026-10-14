import type { MoveInput } from './controller';

/** Keyboard + pointer-lock mouse look. Holds state; the render loop reads it each frame. */
export class Input {
  private keys = new Set<string>();
  readonly move: MoveInput = { forward: 0, right: 0, sprint: false };
  lookDX = 0;
  lookDY = 0;
  locked = false;
  /** Mouse in normalized device coords (−1..1); the screen center while the pointer is captured. */
  readonly mouse = { x: 0, y: 0 };
  private handlers = new Map<string, () => void>();
  /** Canvas click hook; return true to consume the click (e.g. measuring) instead of capturing the mouse. */
  onCanvasClick: (nx: number, ny: number) => boolean = () => false;
  onMouseMove: (nx: number, ny: number) => void = () => {};
  onUnlock: () => void = () => {};

  constructor(private el: HTMLElement) {
    addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'SELECT' || (e.target as HTMLElement)?.tagName === 'INPUT') {
        if (e.code !== 'Escape') return;
      }
      if (e.code === 'Space') e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.handlers.get(e.code)?.();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    el.addEventListener('click', (e) => {
      const [nx, ny] = this.locked ? [0, 0] : this.ndc(e);
      if (this.onCanvasClick(nx, ny)) return;
      if (!this.locked) el.requestPointerLock?.();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === el;
      if (!this.locked) this.onUnlock();
    });
    addEventListener('mousemove', (e) => {
      if (this.locked) { this.lookDX += e.movementX; this.lookDY += e.movementY; this.mouse.x = this.mouse.y = 0; }
      else [this.mouse.x, this.mouse.y] = this.ndc(e);
      this.onMouseMove(this.mouse.x, this.mouse.y);
    });
  }

  private ndc(e: MouseEvent): [number, number] {
    const r = this.el.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1];
  }

  /** Register a one-shot key action (e.g. 'KeyL'). */
  on(code: string, fn: () => void) { this.handlers.set(code, fn); }

  /** True if any movement key is held. */
  get moving() { return this.move.forward !== 0 || this.move.right !== 0; }

  update() {
    const k = this.keys;
    this.move.forward = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    this.move.right = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    this.move.sprint = k.has('ShiftLeft') || k.has('ShiftRight');
  }

  private look: [number, number] = [0, 0];
  /** The mouse look since the last call (a reused tuple: read it, don't keep it). */
  consumeLook(): [number, number] {
    const d = this.look;
    d[0] = this.lookDX; d[1] = this.lookDY;
    this.lookDX = this.lookDY = 0;
    return d;
  }
}
