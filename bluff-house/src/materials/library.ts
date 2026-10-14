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
  sheenColor?: number;
  sheenRough?: number;
  /** with `emissive`: `glow` is the intensity added when lamps are fully on, `glowDay` the constant part */
  glow?: number;
  glowDay?: number;
  emissiveMap?: boolean; // the albedo map doubles as the emissive map (screens)
  alphaTest?: number; // leaf cards
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
  // furniture: upholstery finishes (the staging click cycles linen → leather → bouclé)
  linen: { tex: 'fabric', color: 0xd6cab6, rough: 1, sheen: 0.6, sheenRough: 0.55, sheenColor: 0x8a8580, env: 0.3, normalScale: 0.5 },
  leather: { tex: 'leather', color: 0x8b5330, rough: 1, clearcoat: 0.25, clearcoatRough: 0.45, env: 0.8 },
  boucle: { tex: 'boucle', color: 0xf3ede2, rough: 1, sheen: 0.8, sheenRough: 0.6, sheenColor: 0xbab2a6, env: 0.25 },
  charcoal: { tex: 'fabric', color: 0x5a5b60, rough: 1, sheen: 0.5, sheenRough: 0.5, sheenColor: 0x6a6a70, env: 0.3, normalScale: 0.5 },
  canvas: { tex: 'fabric', color: 0xd9cdb5, rough: 1, sheen: 0.3, sheenRough: 0.7, sheenColor: 0x8a8580, env: 0.3, normalScale: 0.6 },
  sheet: { tex: 'fabric', color: 0xf1eee8, rough: 1, sheen: 0.7, sheenRough: 0.6, sheenColor: 0xbdb6ab, env: 0.25, normalScale: 0.4 },
  duvet: { tex: 'fabric', color: 0xe6e0d4, rough: 1, sheen: 0.7, sheenRough: 0.6, sheenColor: 0xbdb6ab, env: 0.25, normalScale: 0.4 },
  accent: { tex: 'fabric', color: 0x9c6a48, rough: 1, sheen: 0.6, sheenRough: 0.5, sheenColor: 0x8a6a50, env: 0.3, normalScale: 0.5 },
  felt: { tex: 'felt', color: 0x245a3c, rough: 1, env: 0.2 },
  rug0: { tex: 'rug0', rough: 1, env: 0.2 },
  rug1: { tex: 'rug1', rough: 1, env: 0.2 },
  rug2: { tex: 'rug2', rough: 1, env: 0.2 },
  // furniture: hard surfaces
  quartz: { tex: 'quartz', rough: 1, clearcoat: 0.5, clearcoatRough: 0.15, env: 1 },
  lightwood: { tex: 'lightwood', rough: 1, env: 0.8 },
  chrome: { color: 0xd8dade, rough: 0.12, metal: 1, env: 1.2 },
  stainless: { color: 0xbfc2c4, rough: 0.3, metal: 0.9, env: 1 },
  black: { color: 0x141414, rough: 0.5, env: 0.6 },
  white: { color: 0xece8e1, rough: 0.6, env: 0.7 },
  paper: { color: 0xe9e2d4, rough: 0.9, env: 0.4 },
  ceramic: { color: 0xf4f2ee, rough: 0.12, env: 1 },
  glassDark: { color: 0x1b2226, rough: 0.11, metal: 0.3, env: 1.2 },
  mirror: { color: 0x8d9497, rough: 0.11, metal: 1, env: 0.6 },
  potDark: { color: 0x2f2b28, rough: 0.7, env: 0.5 },
  cabinetPaint: { color: 0x47504a, rough: 0.5, env: 0.7 },
  carPaint: { color: 0x25402f, rough: 0.3, metal: 0.45, clearcoat: 1, clearcoatRough: 0.11, env: 1.3 },
  coupePaint: { color: 0x8f1d1d, rough: 0.3, metal: 0.45, clearcoat: 1, clearcoatRough: 0.11, env: 1.3 },
  hull: { color: 0x1f2b45, rough: 0.25, clearcoat: 1, clearcoatRough: 0.11, env: 1.3 },
  screenTV: { color: 0x0b0c0e, rough: 0.11, metal: 0.2, env: 1.2 },
  screenGame: { tex: 'screenGame', rough: 0.2, emissive: 0xffffff, glowDay: 0.9, emissiveMap: true, env: 0.3 },
  screenGolf: { tex: 'screenGolf', rough: 0.9, emissive: 0xffffff, glowDay: 1.0, emissiveMap: true, env: 0.2 },
  art0: { tex: 'art0', rough: 0.85, env: 0.4 },
  art1: { tex: 'art1', rough: 0.85, env: 0.4 },
  art2: { tex: 'art2', rough: 0.85, env: 0.4 },
  art3: { tex: 'art3', rough: 0.85, env: 0.4 },
  foliage: { tex: 'leafCard', rough: 1, env: 0.35, alphaTest: 0.5, side: THREE.DoubleSide },
  shade: { tex: 'fabric', color: 0xefe6d6, rough: 1, emissive: 0xffc98a, glow: 1.2, env: 0.3, side: THREE.DoubleSide },
  opal: { color: 0xf6f1e8, rough: 0.3, emissive: 0xffe0b0, glow: 3, env: 0.6 },
  plant: { color: 0x3d5a32, rough: 0.8, env: 0.4 },
  // landscape
  forest: { tex: 'canopy', rough: 1, env: 0.25, normalScale: 1.2 },
  ridge: { color: 0x2c3a34, rough: 1, env: 0.2 },
  bark: { tex: 'bark', rough: 1, env: 0.3, normalScale: 1.2 },
  rock: { tex: 'rock', rough: 1, env: 0.4, normalScale: 1.4 },
  leafOrange: { tex: 'leafOrange', rough: 1, env: 0.3, alphaTest: 0.5, side: THREE.DoubleSide },
  leafRed: { tex: 'leafRed', rough: 1, env: 0.3, alphaTest: 0.5, side: THREE.DoubleSide },
  leafGold: { tex: 'leafGold', rough: 1, env: 0.3, alphaTest: 0.5, side: THREE.DoubleSide },
  needles: { tex: 'needles', rough: 1, env: 0.3, alphaTest: 0.5, side: THREE.DoubleSide },
  heater: { color: 0x1a1414, rough: 0.6, emissive: 0xff3a10, glow: 3, glowDay: 0, env: 0.2 },
  poolGlow: { color: 0xdffaff, rough: 0.3, emissive: 0x7fe0ff, glow: 8, glowDay: 0, env: 0.3 },
  bookcloth: { color: 0xffffff, rough: 0.8, env: 0.4 },
  bottleGlass: { color: 0xffffff, rough: 0.12, metal: 0.1, clearcoat: 1, clearcoatRough: 0.11, env: 1.3 },
  ember: { color: 0x2a140a, rough: 0.9, emissive: 0xff5a14, glowDay: 2.5, env: 0.1 },
};

/**
 * Plain (untextured, opaque, non-emissive, standard) finishes can share one "flat" material whose
 * color, roughness and metalness ride on the vertices instead: furniture merges all of them into a
 * single draw call per floor. Returns null for anything that needs its own material.
 */
export function flatParams(key: string): { color: THREE.Color; rough: number; metal: number } | null {
  const s = SPECS[key];
  if (!s || s.tex || s.emissive !== undefined || s.alphaTest || s.clearcoat || s.sheen || s.side !== undefined) return null;
  return { color: new THREE.Color(s.color ?? 0xffffff), rough: Math.max(MIN_ROUGH, s.rough ?? 0.8), metal: s.metal ?? 0 };
}

/** The shared vertex-colored material for flat finishes (one per variant and pool). */
export function flatMaterial(variant: Variant, pool: Pool): THREE.MeshStandardMaterial {
  const ck = '@flat|' + variant + '|' + pool;
  let m = cache.get(ck) as THREE.MeshStandardMaterial | undefined;
  if (m) return m;
  m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1 });
  m.name = '@flat|' + variant;
  m.envMapIntensity = 0.8 * (variant === 'int' ? INTERIOR_ENV : 1);
  m.userData.castShadow = true;
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 pbr;\nvarying vec2 vPbr;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPbr = pbr;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vPbr;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vPbr.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vPbr.y;');
  };
  m.customProgramCacheKey = () => 'flat-pbr';
  if (variant === 'int') INTERIOR_MATERIALS.push(m);
  if (pool === 'loose') LOOSE_MATERIALS.push(m);
  cache.set(ck, m);
  return m;
}

const cache = new Map<string, THREE.Material>();
/**
 * Materials in the "loose" pool belong only to movable furniture, so the Furnished toggle can fade
 * them without touching the architecture that shares the same finishes.
 */
export type Pool = 'arch' | 'loose' | 'baked';
export const LOOSE_MATERIALS: THREE.MeshStandardMaterial[] = [];
/** Interior-variant materials: they reflect the interior environment instead of the sky. */
export const INTERIOR_MATERIALS: THREE.MeshStandardMaterial[] = [];
/** Materials whose emissive follows the electric lights (tests and the light rig read this). */
export const EMISSIVE_FIXTURES: THREE.MeshStandardMaterial[] = [];

export function material(key: string, variant: Variant = 'ext', pool: Pool = 'arch'): THREE.Material {
  const ck = key + '|' + variant + (pool === 'arch' ? '' : '|' + pool);
  let m = cache.get(ck);
  if (m) return m;
  if (pool !== 'arch') {
    const src = material(key, variant);
    m = src.clone();
    // clone() deep-copies userData through JSON, which turns object references into plain data
    m.userData.depthMat = src.userData.depthMat;
  } else m = make(key, variant);
  m.name = pool === 'arch' ? ck : key + '|' + variant; // baked/loose copies keep the base name (key|variant)
  const std = (m as THREE.MeshStandardMaterial).isMeshStandardMaterial ? (m as THREE.MeshStandardMaterial) : null;
  if (std && variant === 'int') INTERIOR_MATERIALS.push(std);
  if (std && pool === 'loose') {
    LOOSE_MATERIALS.push(std);
    if (EMISSIVE_FIXTURES.includes(material(key, variant) as THREE.MeshStandardMaterial)) EMISSIVE_FIXTURES.push(std);
  }
  cache.set(ck, m);
  return m;
}

function make(key: string, variant: Variant): THREE.Material {
  if (key === 'glass') return glassMaterial(variant);
  if (key === 'water') return waterMaterial();
  if (key === 'bulb') {
    const b = new THREE.MeshStandardMaterial({ color: 0xfff3e2, emissive: new THREE.Color(0xffb46b), emissiveIntensity: 0, roughness: 0.4 });
    b.userData.glow = 28;
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
  if (t && s.emissiveMap) opts.emissiveMap = t.map;
  if (s.alphaTest) opts.alphaTest = s.alphaTest;
  const mat = physical
    ? new THREE.MeshPhysicalMaterial({
      ...opts, clearcoat: s.clearcoat ?? 0, clearcoatRoughness: Math.max(MIN_ROUGH, s.clearcoatRough ?? 0.2), sheen: s.sheen ?? 0,
      sheenRoughness: s.sheenRough ?? 0.5, sheenColor: new THREE.Color(s.sheenColor ?? 0xffffff),
    })
    : new THREE.MeshStandardMaterial(opts);
  mat.envMapIntensity = (s.env ?? 0.8) * (variant === 'int' ? INTERIOR_ENV : 1);
  mat.userData.castShadow = s.shadow !== false;
  if (s.emissive !== undefined) {
    mat.emissive.set(s.emissive);
    mat.emissiveIntensity = s.glowDay ?? 0;
    // lamps (shades, opal globes) follow the electric lights; screens and embers glow all the time
    if (s.glow) { mat.userData.glow = s.glow; mat.userData.glowDay = s.glowDay ?? 0; EMISSIVE_FIXTURES.push(mat); }
  }
  if (s.alphaTest && t) {
    // alpha-tested cards cast leaf-shaped shadows, not rectangles
    mat.userData.depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: t.map, alphaTest: s.alphaTest, side: THREE.DoubleSide });
  }
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
  // one pass for both faces: three's default two-pass draw of double-sided transparency flips
  // material.side (and bumps its version) twice per pane per frame, re-checking the shader each time
  m.forceSinglePass = true;
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
