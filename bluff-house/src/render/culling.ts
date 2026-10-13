import type * as THREE from 'three';
import type { Plan } from '../build/plan';
import type { GroupKey } from '../build/geom';
import { levelOfFeet } from '../data/house';

/**
 * Level culling. Inside the house, interiors two levels away are hidden entirely
 * (upper floor hides the lower level and vice versa). Outdoors everything stays visible
 * because you can see into every level through the glass.
 */
export class LevelCuller {
  level = 1;
  inside = false;
  constructor(private groups: Map<GroupKey, THREE.Group>, private plan: Plan) {}

  update(x: number, z: number, feet: number) {
    const L = levelOfFeet(feet);
    const room = this.plan.roomAt(L, x, z);
    this.level = L;
    this.inside = !!room;
    for (const l of [0, 1, 2]) {
      const g = this.groups.get(`L${l}i` as GroupKey)!;
      g.visible = !this.inside || Math.abs(l - L) <= 1;
    }
  }

  showAll() { for (const l of [0, 1, 2]) this.groups.get(`L${l}i` as GroupKey)!.visible = true; }
}
