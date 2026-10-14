import type * as THREE from 'three';
import type { HouseData } from '../data/types';
import { ColliderBuilder, GeoBuilder, interiorGroup, type GroupKey } from './geom';
import type { Plan } from './plan';

/** A moving part (the bookcase door) with an oriented-box blocker the controller checks each step. */
export interface DynamicBlocker { cx: number; cz: number; hw: number; hd: number; rot: number; y0: number; y1: number; enabled: boolean }
export interface DynamicPart {
  object: THREE.Object3D;
  blocker: DynamicBlocker;
  update(playerX: number, playerZ: number, playerFeet: number, dt: number): void;
}

/** A solid wall piece, kept for tests (every one must block the capsule). */
export interface WallPiece { level: number; axis: 'x' | 'z'; at: number; s: number; e: number; y0: number; y1: number; exterior: boolean }

export interface BuildContext {
  data: HouseData;
  plan: Plan;
  geo: GeoBuilder;
  col: ColliderBuilder;
  dynamic: DynamicPart[];
  wallPieces: WallPiece[];
  /** Walkable surfaces registered for tests and the tour (x0, z0, x1, z1 at y). */
  stairRamps: { x0: number; z0: number; x1: number; z1: number; axis: 'x' | 'z'; s0: number; s1: number; y0: number; y1: number }[];
  terrainGeometry?: THREE.BufferGeometry;
}

export function makeContext(data: HouseData, plan: Plan): BuildContext {
  return { data, plan, geo: new GeoBuilder(), col: new ColliderBuilder(), dynamic: [], wallPieces: [], stairRamps: [] };
}

/** Visibility group for a face that looks into room `idx` on level L (-1 = outdoors). */
export function faceGroup(ctx: BuildContext, L: number, idx: number): GroupKey {
  if (idx < 0) return 'shell';
  const r = ctx.plan.rooms[idx];
  if (r.stair) return 'stair';
  if (r.void) return 'L1i';
  return interiorGroup(L);
}
