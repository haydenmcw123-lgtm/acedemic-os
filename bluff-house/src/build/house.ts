import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { HouseData } from '../data/types';
import { material } from '../materials/library';
import { makeContext, type BuildContext } from './context';
import { buildExterior, siteCuts } from './exterior';
import { buildFloors } from './floors';
import { GeoBuilder, type GroupKey } from './geom';
import { Plan } from './plan';
import { buildFireplace, buildRoof } from './roof';
import { buildStairs, stairLayout, type StairLayout } from './stairs';
import { buildTerrain, type TerrainFn } from './terrain';
import { buildWalls } from './walls';

export interface BuiltHouse {
  root: THREE.Group;
  groups: Map<GroupKey, THREE.Group>;
  roof: THREE.Group;
  ceilings: THREE.Mesh[];
  collider: THREE.Mesh;
  bvh: MeshBVH;
  /** Per collider triangle: 1 blocks sight lines, 0 is glass or a rail. */
  opaque: Uint8Array;
  ctx: BuildContext;
  plan: Plan;
  stair: StairLayout;
  terrain: TerrainFn;
  stats: { tris: number; buckets: number; colliderTris: number; ms: number };
}

/** Builds the entire house from data. Nothing here is hand-placed: change the JSON and rebuild. */
export function buildHouse(data: HouseData): BuiltHouse {
  const t0 = performance.now();
  const plan = new Plan(data);
  const ctx = makeContext(data, plan);
  const stair = stairLayout(ctx);

  buildFloors(ctx, stair);
  buildWalls(ctx);
  buildStairs(ctx, stair);
  buildFireplace(ctx);

  // roof goes in its own builder so it can be hidden for plan views
  const roofCtx: BuildContext = { ...ctx, geo: new GeoBuilder() };
  buildRoof(roofCtx);

  const terrain = buildTerrain(ctx, siteCuts(ctx));
  buildExterior(ctx, terrain.height);

  const groups = ctx.geo.build(material);
  const roofGroups = roofCtx.geo.build(material);
  const roof = new THREE.Group(); roof.name = 'roof';
  for (const g of roofGroups.values()) for (const m of [...g.children]) roof.add(m);

  const root = new THREE.Group(); root.name = 'house';
  for (const g of groups.values()) root.add(g);
  root.add(roof);

  // terrain
  if (ctx.terrainGeometry) {
    const t = new THREE.Mesh(ctx.terrainGeometry, material('terrain'));
    t.name = 'terrain'; t.receiveShadow = true; t.castShadow = false;
    groups.get('site')!.add(t);
    // terrain goes into the collider as plain triangles
    const pos = ctx.terrainGeometry.attributes.position, idx = ctx.terrainGeometry.index!;
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
      ctx.col.tri([pos.getX(a), pos.getY(a), pos.getZ(a)], [pos.getX(b), pos.getY(b), pos.getZ(b)], [pos.getX(c), pos.getY(c), pos.getZ(c)]);
    }
  }

  // moving parts (the bookcase door)
  for (const d of ctx.dynamic) {
    d.object.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = material(o.userData.matKey); });
    groups.get('L2i')!.add(d.object);
  }

  const ceilings: THREE.Mesh[] = [];
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.userData.mat === 'ceil') ceilings.push(o as THREE.Mesh); });

  const colGeo = ctx.col.geometry();
  const bvh = new MeshBVH(colGeo, { targetLeafSize: 8 });
  colGeo.boundsTree = bvh;
  const collider = new THREE.Mesh(colGeo, new THREE.MeshBasicMaterial({ wireframe: true, color: 0xff3366 }));
  collider.name = 'collider'; collider.visible = false;

  const st = ctx.geo.stats();
  return {
    root, groups, roof, ceilings, collider, bvh, opaque: Uint8Array.from(ctx.col.opaque), ctx, plan, stair, terrain,
    stats: { tris: st.tris + roofCtx.geo.stats().tris, buckets: st.buckets, colliderTris: ctx.col.pos.length / 9, ms: performance.now() - t0 },
  };
}
