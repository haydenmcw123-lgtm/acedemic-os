import * as THREE from 'three';

/**
 * One place for every material. Stage 1 is "clay": neutral matte tones that only hint at the
 * final finishes so the geometry reads clearly. Stage 3 swaps these for PBR materials with
 * real-world tile sizes; the keys stay the same.
 */
const CLAY: Record<string, { color: number; roughness?: number; metalness?: number; opacity?: number }> = {
  // floors
  hickory: { color: 0xb9ada0 }, tile: { color: 0xc9c6c0 }, slate: { color: 0x9a9a98 }, rubber: { color: 0x77777a },
  turf: { color: 0x98a690 }, concrete: { color: 0xb3b1ad },
  // walls
  plaster: { color: 0xe4e1db }, tilewall: { color: 0xd8d6d1 }, stone: { color: 0xa9a49b }, paneling: { color: 0xb3a596 },
  theater: { color: 0x8d8a87 }, drywall: { color: 0xdedcd8 }, siding: { color: 0x8f8a84 }, stoneExt: { color: 0xa39e95 },
  ceil: { color: 0xeeebe6 }, slabEdge: { color: 0xcfcbc4 }, sill: { color: 0xd2c8bb }, trim: { color: 0xd5ccc0 },
  // openings
  steel: { color: 0x2b2c2e, roughness: 0.5, metalness: 0.4 }, glass: { color: 0x9fc4d0, roughness: 0.05, opacity: 0.18 },
  slot: { color: 0x1a1a1a }, leaf: { color: 0xc7bcae }, door: { color: 0x9c8a76 }, bronze: { color: 0x3b332d, metalness: 0.4 },
  brass: { color: 0xb09062, metalness: 0.5 }, gdoor: { color: 0xa08a72 }, bookcaseWood: { color: 0x8a7563 }, books: { color: 0x9b8f84 },
  // structure
  oak: { color: 0xcdbca6 }, walnut: { color: 0x6f5a48 }, timber: { color: 0x98846f }, soot: { color: 0x2a2725 },
  roof: { color: 0x55524f, roughness: 0.6, metalness: 0.3 }, soffit: { color: 0xc9bba8 }, fascia: { color: 0x4a4744 },
  // site
  deck: { color: 0xa18d7b }, pavers: { color: 0xc8c1b4 }, coping: { color: 0xd6d0c4 }, poolTile: { color: 0x7fa7ad },
  water: { color: 0x5aa0b0, roughness: 0.1, opacity: 0.7 }, lake: { color: 0x51707a, roughness: 0.3 }, terrain: { color: 0xa9ad98 },
};

const cache = new Map<string, THREE.Material>();

export function material(key: string): THREE.Material {
  let m = cache.get(key);
  if (m) return m;
  const c = CLAY[key] ?? { color: 0xff00ff };
  if (!CLAY[key]) console.warn('material: unknown key', key);
  const mat = new THREE.MeshStandardMaterial({ color: c.color, roughness: c.roughness ?? 0.85, metalness: c.metalness ?? 0 });
  if (c.opacity !== undefined) {
    mat.transparent = true; mat.opacity = c.opacity; mat.depthWrite = false; mat.side = THREE.DoubleSide;
  }
  // Floors at roughness ≥ 0.11 (half-float specular overflow rule) — clay is far above it already.
  mat.roughness = Math.max(mat.roughness, 0.11);
  mat.name = key;
  cache.set(key, mat);
  return mat;
}
