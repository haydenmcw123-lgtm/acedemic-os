import * as THREE from 'three';
import { textureSet } from './procedural';

/**
 * One place for every material. Keys come from the geometry builders (wall/floor kinds from the
 * JSON, plus trim, steel, glass…). Each key has an interior and an exterior variant: interior
 * surfaces take less of the sky environment, since nothing yet occludes it indoors (Stage 5's
 * baked lighting and box-projected probes replace this).
 */
export type Variant = 'int' | 'ext';

interface Spec {
  tex?: string; // procedural texture set key
  color?: number; // tint (multiplies the texture) or flat color
  rough?: number; // roughness (scales the roughness map when textured)
  metal?: number;
  clearcoat?: number;
  clearcoatRough?: number;
  sheen?: number;
  env?: number; // envMapIntensity before the interior factor
  normalScale?: number;
  emissive?: number;
  side?: THREE.Side;
  shadow?: boolean; // casts shadows (glass doesn't)
}

/** Roughness is never below 0.11: lower values overflow half-float specular and bloom turns them into black squares. */
const MIN_ROUGH = 0.11;
export const INTERIOR_ENV = 1;

const SPECS: Record<string, Spec> = {
  // floors
  hickory: { tex: 'hickory', rough: 1, clearcoat: 0.3, clearcoatRough: 0.2, env: 1, normalScale: 0.6 },
  tile: { tex: 'tile', rough: 1, env: 1 },
  slate: { tex: 'slate', rough: 1, normalScale: 1 },
  rubber: { tex: 'rubber', rough: 1, env: 0.4 },
  turf: { tex: 'turf', rough: 1, env: 0.3 },
  concrete: { tex: 'concrete', rough: 1, env: 0.8 },
  // walls
  plaster: { tex: 'plaster', rough: 1, env: 0.6, normalScale: 0.5 },
  drywall: { tex: 'plaster', rough: 1, env: 0.6, normalScale: 0.3 },
  ceil: { tex: 'ceil', rough: 1, env: 0.5, normalScale: 0.3 },
  slabEdge: { tex: 'plaster', rough: 1, env: 0.6 },
  tilewall: { tex: 'tile', rough: 1, env: 1 },
  stone: { tex: 'stone', rough: 1, normalScale: 1.4, env: 0.6 },
  stoneExt: { tex: 'stone', rough: 1, normalScale: 1.4, env: 0.6 },
  paneling: { tex: 'walnut', rough: 1, clearcoat: 0.15, clearcoatRough: 0.4, env: 0.8 },
  theater: { tex: 'theater', rough: 1, env: 0.3 },
  siding: { tex: 'siding', rough: 1, normalScale: 1.2, env: 0.5 },
  sill: { tex: 'oak', rough: 1, env: 0.9 },
  trim: { color: 0xebe5da, rough: 0.55, env: 0.8 },
  // openings and hardware
  steel: { color: 0x1c1d1f, rough: 0.38, metal: 0.55, env: 1 },
  bronze: { color: 0x3b3029, rough: 0.4, metal: 0.8, env: 1 },
  brass: { color: 0xb38e58, rough: 0.28, metal: 1, env: 1.1 },
  slot: { color: 0x0e0e0e, rough: 0.9, env: 0.1 },
  leaf: { tex: 'oak', rough: 1, env: 0.8 },
  door: { tex: 'timber', color: 0x8a6a52, rough: 0.9, env: 0.6 },
  gdoor: { tex: 'timber', color: 0xb08e70, rough: 1, env: 0.6 },
  bookcaseWood: { tex: 'walnut', rough: 1, clearcoat: 0.2, clearcoatRough: 0.3 },
  books: { color: 0x6d5a4b, rough: 0.85, env: 0.4 },
  // structure
  oak: { tex: 'oak', rough: 1, env: 0.9 },
  walnut: { tex: 'walnut', rough: 1, clearcoat: 0.2, clearcoatRough: 0.3 },
  timber: { tex: 'timber', rough: 1, normalScale: 1.2, env: 0.6 },
  soot: { color: 0x141110, rough: 1, env: 0.1 },
  roof: { tex: 'roof', color: 0xffffff, rough: 1, metal: 0.7, env: 1 },
  soffit: { tex: 'oak', color: 0xd8c8b4, rough: 1, env: 0.7 },
  fascia: { color: 0x2f2a26, rough: 0.45, metal: 0.6, env: 1 },
  // site
  deck: { tex: 'deck', rough: 1, env: 0.7 },
  pavers: { tex: 'pavers', rough: 1, env: 0.6 },
  coping: { tex: 'pavers', color: 0xf0ece4, rough: 0.8, env: 0.6 },
  poolTile: { tex: 'poolTile', rough: 1, env: 1 },
  terrain: { tex: 'grass', rough: 1, env: 0.35 },
  lake: { color: 0x163036, rough: 0.12, metal: 0.05, env: 1.25 },
};

const cache = new Map<string, THREE.Material>();
/** Interior-variant materials: they reflect the interior environment instead of the sky. */
export const INTERIOR_MATERIALS: THREE.MeshStandardMaterial[] = [];
/** Materials whose emissive follows the electric lights (tests and the light rig read this). */
export const EMISSIVE_FIXTURES: THREE.MeshStandardMaterial[] = [];

export function material(key: string, variant: Variant = 'ext'): THREE.Material {
  const ck = key + '|' + variant;
  let m = cache.get(ck);
  if (m) return m;
  m = make(key, variant);
  m.name = ck;
  if (variant === 'int' && (m as THREE.MeshStandardMaterial).isMeshStandardMaterial) INTERIOR_MATERIALS.push(m as THREE.MeshStandardMaterial);
  cache.set(ck, m);
  return m;
}

function make(key: string, variant: Variant): THREE.Material {
  if (key === 'glass') return glassMaterial(variant);
  if (key === 'water') return waterMaterial();
  if (key === 'bulb') {
    const b = new THREE.MeshStandardMaterial({ color: 0xfff3e2, emissive: new THREE.Color(0xffb46b), emissiveIntensity: 0, roughness: 0.4 });
    EMISSIVE_FIXTURES.push(b);
    return b;
  }
  const s = SPECS[key];
  if (!s) { console.warn('material: unknown key', key); return new THREE.MeshStandardMaterial({ color: 0xff00ff }); }
  const physical = !!(s.clearcoat || s.sheen);
  const opts: THREE.MeshPhysicalMaterialParameters = {
    color: s.color ?? 0xffffff,
    roughness: Math.max(MIN_ROUGH, s.rough ?? 0.8),
    metalness: s.metal ?? 0,
    side: s.side ?? THREE.FrontSide,
  };
  const t = s.tex ? textureSet(s.tex) : null;
  if (t) {
    for (const tx of [t.map, t.normalMap, t.ormMap]) tx.repeat.set(1 / t.tileU, 1 / t.tileV);
    opts.map = t.map;
    opts.normalMap = t.normalMap;
    opts.normalScale = new THREE.Vector2(s.normalScale ?? 1, s.normalScale ?? 1);
    opts.roughnessMap = t.ormMap; // G channel
    opts.aoMap = t.ormMap; // R channel, indirect light only
    opts.aoMapIntensity = 1;
  }
  const mat = physical
    ? new THREE.MeshPhysicalMaterial({ ...opts, clearcoat: s.clearcoat ?? 0, clearcoatRoughness: Math.max(MIN_ROUGH, s.clearcoatRough ?? 0.2), sheen: s.sheen ?? 0 })
    : new THREE.MeshStandardMaterial(opts);
  mat.envMapIntensity = (s.env ?? 0.8) * (variant === 'int' ? INTERIOR_ENV : 1);
  mat.userData.castShadow = s.shadow !== false;
  return mat;
}

/**
 * Architectural glass without a transmission pass: the pane lets ~90% of the view through
 * (premultiplied blending), adds a faint green body tint that grows at grazing angles, and
 * reflects the sky environment with full Fresnel strength instead of having it dimmed by alpha.
 */
function glassMaterial(variant: Variant) {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0x000000, roughness: MIN_ROUGH, metalness: 0, ior: 1.52, specularIntensity: 1,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  m.envMapIntensity = variant === 'int' ? 1.0 : 1.2;
  m.blending = THREE.CustomBlending;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendEquation = THREE.AddEquation;
  m.userData.castShadow = false;
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', /* glsl */ `
      float glassNdV = clamp(dot(normalize(vViewPosition), normal), -1.0, 1.0);
      float glassGraze = pow(1.0 - abs(glassNdV), 3.0);
      vec3 glassTint = vec3(0.10, 0.16, 0.13) * (0.12 + 0.5 * glassGraze);
      float glassAlpha = 0.08 + 0.5 * glassGraze;
      vec3 glassSpec = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
      gl_FragColor = vec4(glassTint * glassAlpha + glassSpec, glassAlpha);
    `);
  };
  m.customProgramCacheKey = () => 'arch-glass';
  return m;
}

function waterMaterial() {
  const m = new THREE.MeshPhysicalMaterial({ color: 0x2a9db0, roughness: 0.12, metalness: 0, transparent: true, opacity: 0.78, depthWrite: false });
  m.envMapIntensity = 1.2;
  m.userData.castShadow = false;
  return m;
}
