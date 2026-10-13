import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

/** Clamp the sky's HDR output before it reaches the PMREM (half-float overflow → black squares). */
const SKY_CLAMP = 24;

function clampSky(s: Sky) {
  const m = s.material as THREE.ShaderMaterial;
  // clamp the top (PMREM safety) and give the night sky a deep-blue floor instead of pure black
  m.fragmentShader = m.fragmentShader.replace('gl_FragColor = vec4( texColor, 1.0 );',
    `gl_FragColor = vec4( clamp( texColor, vec3( 0.0011, 0.0017, 0.0034 ), vec3( ${SKY_CLAMP.toFixed(1)} ) ), 1.0 );`);
  if (!m.fragmentShader.includes('clamp( texColor')) console.warn('sky: clamp patch did not apply');
  m.needsUpdate = true;
}

/**
 * Preetham sky (three's Sky shader) for the backdrop, plus a second copy in its own scene that is
 * baked into a PMREM environment whenever the sun moves (throttled to every 250 ms while dragging).
 */
export class SkyRig {
  readonly sky = new Sky();
  private envScene = new THREE.Scene();
  private envSky = new Sky();
  private ground: THREE.Mesh;
  private pmrem: THREE.PMREMGenerator;
  private rt: THREE.WebGLRenderTarget | null = null;
  private pending = false;
  private cooldown = 0;
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  private stars: THREE.Points;

  constructor(renderer: THREE.WebGLRenderer, private scene: THREE.Scene) {
    for (const s of [this.sky, this.envSky]) {
      clampSky(s);
      const u = (s.material as THREE.ShaderMaterial).uniforms;
      u.turbidity.value = 3.0; u.rayleigh.value = 1.3; u.mieCoefficient.value = 0.003; u.mieDirectionalG.value = 0.76;
      u.cloudCoverage.value = 0.3; u.cloudDensity.value = 0.35; // a clear October day with fair-weather cumulus
    }
    // the sun itself comes from the directional light; a sun disc in the environment map would
    // only add a tiny over-bright texel to every reflection
    (this.envSky.material as THREE.ShaderMaterial).uniforms.showSunDisc.value = 0;
    this.sky.scale.setScalar(9000);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    scene.add(this.sky);
    this.envSky.scale.setScalar(900);
    this.envScene.add(this.envSky);
    // dark wooded ground below the horizon, so floors and lower glass don't reflect a glowing void
    this.ground = new THREE.Mesh(new THREE.CircleGeometry(800, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x1f2418 }));
    this.ground.position.y = -40;
    this.envScene.add(this.ground);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    // stars for the night presets (fade in after dusk)
    const n = 2600, a = new Float32Array(n * 3), seed = { v: 7 };
    const r = () => { seed.v = (seed.v * 16807) % 2147483647; return seed.v / 2147483647; };
    for (let i = 0; i < n; i++) {
      const u = r(), th = r() * Math.PI * 2, y = 0.05 + 0.95 * u, s = Math.sqrt(1 - y * y);
      a[i * 3] = s * Math.cos(th) * 8000; a[i * 3 + 1] = y * 8000; a[i * 3 + 2] = s * Math.sin(th) * 8000;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(a, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xdfe6ff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.stars.frustumCulled = false; this.stars.renderOrder = -9; this.stars.name = 'stars';
    scene.add(this.stars);
  }

  /** Point the sun; the environment map follows on the next update (throttled). */
  setSun(dir: THREE.Vector3, nightFactor: number) {
    this.sunDir.copy(dir);
    for (const s of [this.sky, this.envSky]) (s.material as THREE.ShaderMaterial).uniforms.sunPosition.value.copy(dir);
    (this.ground.material as THREE.MeshBasicMaterial).color.setRGB(0.13, 0.15, 0.1).multiplyScalar(0.06 + 0.94 * (1 - nightFactor));
    (this.stars.material as THREE.PointsMaterial).opacity = Math.max(0, nightFactor - 0.6) * 2.2;
    this.pending = true;
  }

  update(dt: number, force = false) {
    (this.sky.material as THREE.ShaderMaterial).uniforms.time.value += dt;
    this.cooldown -= dt;
    if (!this.pending || (!force && this.cooldown > 0)) return false;
    this.pending = false; this.cooldown = 0.25;
    const rt = this.pmrem.fromScene(this.envScene, 0, 1, 2000);
    this.rt?.dispose();
    this.rt = rt;
    this.scene.environment = rt.texture;
    return true;
  }
}
