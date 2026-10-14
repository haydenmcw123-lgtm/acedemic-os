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
  private levels: THREE.Group[];
  constructor(groups: Map<GroupKey, THREE.Group>, private plan: Plan) {
    this.levels = ([0, 1, 2] as const).map((l) => groups.get(`L${l}i` as GroupKey)!);
  }

  update(x: number, z: number, feet: number) {
    const L = levelOfFeet(feet);
    const room = this.plan.roomAt(L, x, z);
    this.level = L;
    this.inside = !!room;
    for (let l = 0; l < 3; l++) this.levels[l].visible = !this.inside || Math.abs(l - L) <= 1;
  }

  showAll() { for (let l = 0; l < 3; l++) this.levels[l].visible = true; }
}
