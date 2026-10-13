import * as THREE from 'three';

export interface RenderRig {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  resize(): void;
}

/**
 * Stage 1 clay renderer: one shadowed sun + sky fill, ACES tone mapping.
 * Shadows only re-render when asked (shadowMap.autoUpdate = false).
 */
export function createRenderer(container: HTMLElement, test: boolean): RenderRig {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: test });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // r18x: PCFSoft was folded into PCF + shadow.radius
  renderer.shadowMap.autoUpdate = false;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xc9d6de);
  scene.fog = new THREE.Fog(0xc9d6de, 600, 4000);

  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, 12000);
  camera.rotation.order = 'YXZ';

  const hemi = new THREE.HemisphereLight(0xdfe8ee, 0x8a8170, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3e2, 2.6);
  // placeholder sun (mid-afternoon from the south-west); Stage 3 computes it from NOAA for Oct 15
  const az = THREE.MathUtils.degToRad(215), el = THREE.MathUtils.degToRad(36);
  const target = new THREE.Vector3(30, 10, 45);
  sun.position.copy(target).add(new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).multiplyScalar(300));
  sun.target.position.copy(target);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 100, far: 600 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.08;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);

  const resize = () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  };
  addEventListener('resize', resize);
  renderer.shadowMap.needsUpdate = true;
  return { renderer, scene, camera, sun, hemi, resize };
}
