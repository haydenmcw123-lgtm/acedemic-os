import { CEIL_H, FLOOR_Y } from '../data/house';
import type { Rect } from '../data/types';
import { faceGroup, type BuildContext } from './context';
import { subtractRects, type StairLayout } from './stairs';

/**
 * Floors and ceilings per room. Floors are walkable collision surfaces. Floors that are
 * seen from below (the stair-hall pieces over the open well) get a full 1-ft slab.
 */
export function buildFloors(ctx: BuildContext, stair: StairLayout) {
  ctx.plan.rooms.forEach((R, idx) => {
    if (R.void) return;
    const L = R.level, y = FLOOR_Y[L];
    const grp = faceGroup(ctx, L, idx);
    const floorMat = R.floor ?? 'hickory';
    let rects: Rect[] = R.rects;
    if (R.stair && L > 0) rects = R.rects.flatMap((r) => subtractRects(r, stair.well));
    for (const [x0, z0, x1, z1] of rects) {
      if (R.stair && L > 0) {
        ctx.geo.box([x0, y - 1, z0], [x1, y, z1], { py: floorMat, ny: 'ceil', px: 'slabEdge', nx: 'slabEdge', pz: 'slabEdge', nz: 'slabEdge' }, grp);
      } else {
        ctx.geo.quad(grp, floorMat, [x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]);
      }
      ctx.col.floor(x0, z0, x1, z1, y);
    }
    if (!R.noCeil) {
      const cy = y + CEIL_H[L];
      for (const [x0, z0, x1, z1] of R.rects) ctx.geo.quad(grp, 'ceil', [x0, cy, z0], [x1, cy, z0], [x1, cy, z1], [x0, cy, z1]);
    }
  });
}
