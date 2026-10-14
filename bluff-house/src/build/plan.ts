import type { Axis, HouseData, LevelIndex, OpenSpan, Room } from '../data/types';

/** One straight wall (or rail) between two owners along a grid line. */
export interface WallRun {
  level: LevelIndex;
  axis: Axis;
  at: number;
  /** Start/end along the run (z for axis 'x', x for axis 'z'). */
  s: number;
  e: number;
  /** Owner on the low side (x < at or z < at): room index, or -1 for outside. */
  a: number;
  /** Owner on the high side. */
  b: number;
  rail: boolean;
}

/**
 * Plan model: rasterizes rooms onto a 1-ft ownership grid per level, then derives walls.
 * Ported from the v3 prototype. A wall goes on every grid edge where the owner changes
 * (including room-to-outside); collinear edges with the same owners merge into runs;
 * `opens` spans are removed (or become rails).
 */
export class Plan {
  readonly gx0: number;
  readonly gz0: number;
  readonly gw: number;
  readonly gh: number;
  readonly own: Int16Array[];
  readonly rooms: Room[];
  readonly runs: WallRun[] = [];

  constructor(readonly data: HouseData) {
    this.rooms = data.rooms;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const r of data.rooms) for (const [a, b, c, d] of r.rects) { x0 = Math.min(x0, a); z0 = Math.min(z0, b); x1 = Math.max(x1, c); z1 = Math.max(z1, d); }
    this.gx0 = x0 - 2; this.gz0 = z0 - 2;
    this.gw = x1 - x0 + 4; this.gh = z1 - z0 + 4;
    this.own = [0, 1, 2].map(() => new Int16Array(this.gw * this.gh).fill(-1));
    data.rooms.forEach((r, idx) => {
      for (const [a, b, c, d] of r.rects) for (let i = a; i < c; i++) for (let j = b; j < d; j++) this.own[r.level][(j - this.gz0) * this.gw + (i - this.gx0)] = idx;
    });
    for (const L of [0, 1, 2] as LevelIndex[]) this.buildRuns(L);
  }

  /** Room index owning the 1-ft cell whose min corner is (i, j), or -1. */
  ownerAt(L: number, i: number, j: number): number {
    if (i < this.gx0 || j < this.gz0 || i >= this.gx0 + this.gw || j >= this.gz0 + this.gh) return -1;
    return this.own[L][(j - this.gz0) * this.gw + (i - this.gx0)];
  }

  /** Room containing plan point (x, z) on level L, if any. */
  roomAt(L: number, x: number, z: number): Room | null {
    const o = this.ownerAt(L, Math.floor(x), Math.floor(z));
    return o >= 0 ? this.rooms[o] : null;
  }

  private openAt(L: number, axis: Axis, at: number, t: number): OpenSpan | undefined {
    return this.data.opens.find((o) => o.level === L && o.axis === axis && o.at === at && t >= o.from && t < o.to);
  }

  private buildRuns(L: LevelIndex) {
    const { gx0, gz0, gw, gh } = this;
    type Cur = { s: number; k: string; a: number; b: number; rail: boolean } | null;
    const edge = (axis: Axis, line: number, t: number, a: number, b: number) => {
      if (a === b || (a < 0 && b < 0)) return null;
      const op = this.openAt(L, axis, line, t);
      if (op && !op.rail) return null;
      return { k: (op ? 'R' : '') + a + ':' + b, a, b, rail: !!op };
    };
    // vertical grid lines x = i (walls run along z)
    for (let i = gx0 + 1; i < gx0 + gw; i++) {
      let cur: Cur = null;
      for (let j = gz0; j <= gz0 + gh; j++) {
        const key = j < gz0 + gh ? edge('x', i, j, this.ownerAt(L, i - 1, j), this.ownerAt(L, i, j)) : null;
        if (cur && (!key || key.k !== cur.k)) { this.runs.push({ level: L, axis: 'x', at: i, s: cur.s, e: j, a: cur.a, b: cur.b, rail: cur.rail }); cur = null; }
        if (key && !cur) cur = { s: j, ...key };
      }
    }
    // horizontal grid lines z = j (walls run along x)
    for (let j = gz0 + 1; j < gz0 + gh; j++) {
      let cur: Cur = null;
      for (let i = gx0; i <= gx0 + gw; i++) {
        const key = i < gx0 + gw ? edge('z', j, i, this.ownerAt(L, i, j - 1), this.ownerAt(L, i, j)) : null;
        if (cur && (!key || key.k !== cur.k)) { this.runs.push({ level: L, axis: 'z', at: j, s: cur.s, e: i, a: cur.a, b: cur.b, rail: cur.rail }); cur = null; }
        if (key && !cur) cur = { s: i, ...key };
      }
    }
  }
}
