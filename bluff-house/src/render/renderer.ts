import * as THREE from 'three';

export interface RenderRig {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  resize(): void;
  /** Extra resize listeners (the post composer). */
  onResize: ((w: number, h: number) => void)[];
}

/**
 * The sun's shadow map, allocated here rather than by three: three's default render target carries
 * an RGBA8 color buffer that the depth-only shadow pass never reads (64 MB at 4096²). This one has a
 * 1-byte color buffer and a 16-bit depth texture for PCF (hardware comparison).
 */
export function allocShadowMap(sun: THREE.DirectionalLight, size: number, depthType: THREE.TextureDataType = THREE.UnsignedShortType) {
  sun.shadow.mapSize.set(size, size);
  if (sun.shadow.map) { sun.shadow.map.depthTexture?.dispose(); sun.shadow.map.dispose(); }
  const rt = new THREE.WebGLRenderTarget(size, size, { format: THREE.RedFormat, type: THREE.UnsignedByteType, generateMipmaps: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  // 16-bit depth: the sun's camera is orthographic (depth is linear), so 550 ft of range still
  // resolves 0.1 in — half the memory of three's 32-bit default
  const d = new THREE.DepthTexture(size, size, depthType);
  d.format = THREE.DepthFormat;
  d.compareFunction = THREE.LessEqualCompare;
  d.minFilter = d.magFilter = THREE.LinearFilter;
  d.name = 'sun.shadowMap';
  rt.depthTexture = d;
  sun.shadow.map = rt;
  // three refreshes the shadow camera's projection only when it creates the map itself
  sun.shadow.camera.updateProjectionMatrix();
}

/** House center the sun's shadow camera is fitted around (ft). */
export const SHADOW_TARGET = new THREE.Vector3(33, 10, 46);

/**
 * Renderer + scene + the sun. Tone mapping happens in the post chain, so the renderer outputs
 * linear HDR into half-float targets. The sun's 4096 shadow map only re-renders on request
 * (time of day changes, the bookcase door moves), never every frame.
 */
export function createRenderer(container: HTMLElement, test: boolean): RenderRig {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: test, stencil: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xbfcbd0, 0.0004);

  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, 12000);
  camera.rotation.order = 'YXZ';

  const hemi = new THREE.HemisphereLight(0xcfdde6, 0x5c4f40, 0.3);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3e2, 3.4);
  sun.position.copy(SHADOW_TARGET).add(new THREE.Vector3(-150, 200, 150));
  sun.target.position.copy(SHADOW_TARGET);
  sun.castShadow = true;
  // tight ortho box around the house (±70 ft): ~2 px per inch of shadow resolution
  Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 100, far: 650 });
  allocShadowMap(sun, 4096); // after the camera box: it refreshes the shadow projection
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.045;
  sun.shadow.radius = 2.5;
  scene.add(sun, sun.target);

  const rig: RenderRig = {
    renderer, scene, camera, sun, hemi, onResize: [],
    resize: () => {
      renderer.setSize(innerWidth, innerHeight);
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      const s = renderer.getDrawingBufferSize(new THREE.Vector2());
      for (const f of rig.onResize) f(s.x, s.y);
    },
  };
  addEventListener('resize', rig.resize);
  renderer.shadowMap.needsUpdate = true;
  return rig;
}
