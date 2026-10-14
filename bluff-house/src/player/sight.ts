import * as THREE from 'three';
import type { MeshBVH } from 'three-mesh-bvh';

const _ray = new THREE.Ray();

/**
 * True if something opaque (wall, floor, terrain) sits between two points. Glass and rails don't
 * block. The collider is non-indexed, so triangle i owns vertices 3i..3i+2 even after the BVH
 * reorders its index buffer.
 */
export function sightBlocked(bvh: MeshBVH, opaque: Uint8Array, from: THREE.Vector3, to: THREE.Vector3, margin = 0.3): boolean {
  _ray.origin.copy(from);
  _ray.direction.subVectors(to, from);
  const dist = _ray.direction.length();
  if (dist < 1e-3) return false;
  _ray.direction.divideScalar(dist);
  const hits = bvh.raycast(_ray, THREE.DoubleSide, 0, dist - margin);
  for (const h of hits) if (h.face && opaque[Math.floor(h.face.a / 3)]) return true;
  return false;
}
