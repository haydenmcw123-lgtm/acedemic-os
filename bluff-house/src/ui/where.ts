import type { Plan } from '../build/plan';
import { BLUFF_X } from '../build/terrain';
import { CEIL_H, house, LEVELS, levelOfFeet } from '../data/house';
import type { Rect, Room } from '../data/types';

export interface Where { key: string; name: string; level: string; meta: string; room: Room | null }

const inRect = ([x0, z0, x1, z1]: Rect, x: number, z: number, pad = 0) => x >= x0 - pad && x <= x1 + pad && z >= z0 - pad && z <= z1 + pad;
const ft = (v: number) => `${v}′`;

/** Dimension text for a room, e.g. "26′ × 26′" or, for L-shaped rooms, the main rect plus the total area. */
export function roomDims(r: Room): string {
  const [x0, z0, x1, z1] = r.rects[0];
  if (r.rects.length === 1) return `${ft(x1 - x0)} × ${ft(z1 - z0)}`;
  const area = r.rects.reduce((a, [a0, b0, a1, b1]) => a + (a1 - a0) * (b1 - b0), 0);
  return `${ft(x1 - x0)} × ${ft(z1 - z0)} + ${r.rects.slice(1).map(([a0, b0, a1, b1]) => `${ft(a1 - a0)} × ${ft(b1 - b0)}`).join(' + ')} · ${area} sq ft`;
}

/** Names the place at (x, z) at height `feet`: a room from the plan, or an outdoor area from the site data. */
export function whereAt(plan: Plan, x: number, z: number, feet: number): Where {
  if (feet > -2 && feet < 32) {
    const L = levelOfFeet(feet);
    let room = plan.roomAt(L, x, z);
    if (room?.void) room = house.rooms.find((r) => r.id === 'great') ?? room;
    if (room) {
      const meta = room.meta ?? `${roomDims(room)} · ${CEIL_H[room.level]}′ ceiling`;
      return { key: room.id, name: room.name, level: LEVELS[L].name, meta, room };
    }
  }
  const s = house.site, M = house.outdoorAreas;
  const out = (key: string, name: string): Where => ({ key, name, level: 'Outdoors', meta: M[key] ?? '', room: null });
  if (feet < s.dock.y + 3) return out('dock', 'Boat Dock');
  if (x < BLUFF_X) return out('bluff', 'Bluff Stairs');
  for (const d of s.decks) if (inRect(d.rect, x, z) && feet > d.y - 2) return out(d.id, d.name);
  if (inRect(s.terrace.rect, x, z, 2) && feet < 3) return out('terrace', 'Pool Terrace');
  if (inRect(s.entry.walk, x, z, 3) || inRect(s.entry.canopy, x, z, 1)) return out('entry', 'Front Entry');
  if (inRect(s.driveway.rect, x, z)) return out('drive', 'Motor Court');
  return out('grounds', 'The Grounds');
}
