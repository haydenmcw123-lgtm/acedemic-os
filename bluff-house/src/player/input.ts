import type { MoveInput } from './controller';

/** Keyboard + pointer-lock mouse look. Holds state; the render loop reads it each frame. */
export class Input {
  private keys = new Set<string>();
  readonly move: MoveInput = { forward: 0, right: 0, sprint: false };
  lookDX = 0;
  lookDY = 0;
  locked = false;
  private handlers = new Map<string, () => void>();

  constructor(el: HTMLElement) {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.handlers.get(e.code)?.();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    el.addEventListener('click', () => { if (!this.locked) el.requestPointerLock?.(); });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === el; });
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.lookDX += e.movementX; this.lookDY += e.movementY;
    });
  }

  /** Register a one-shot key action (e.g. 'KeyL'). */
  on(code: string, fn: () => void) { this.handlers.set(code, fn); }

  update() {
    const k = this.keys;
    this.move.forward = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    this.move.right = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    this.move.sprint = k.has('ShiftLeft') || k.has('ShiftRight');
  }

  consumeLook(): [number, number] {
    const d: [number, number] = [this.lookDX, this.lookDY];
    this.lookDX = this.lookDY = 0;
    return d;
  }
}
