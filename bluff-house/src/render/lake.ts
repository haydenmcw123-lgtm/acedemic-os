import * as THREE from 'three';
import { textureSet } from '../materials/procedural';

/**
 * The lake: a planar mirror rendered at half resolution, distorted by two scrolling ripple normal
 * maps (plus a slow swell), Fresnel-mixed with the deep water color, with a sun glint on top.
 *
 * The mirror pass is rendered once per frame from `render()` — before the post chain, so the AO pass
 * never triggers it — with the interior furniture hidden (it's barely visible in a rippled
 * reflection and would double its cost).
 */
export class Lake {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  enabled = true;
  /** Objects hidden during the mirror pass. */
  hideInReflection: THREE.Object3D[] = [];
  private rt: THREE.WebGLRenderTarget;
  private virtualCam = new THREE.PerspectiveCamera();
  private textureMatrix = new THREE.Matrix4();
  private time = 0;

  constructor(readonly y: number, size = { x0: -7000, x1: -30, z0: -7000, z1: 7000 }) {
    this.rt = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType, samples: 0 });
    this.rt.texture.generateMipmaps = false;
    const ripples = textureSet('waterRipples')!.normalMap;
    ripples.repeat.set(1, 1);
    this.material = new THREE.ShaderMaterial({
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        tReflect: { value: null }, tNormal: { value: null }, textureMatrix: { value: new THREE.Matrix4() },
        time: { value: 0 }, reflectOn: { value: 1 },
        sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunColor: { value: new THREE.Color(0, 0, 0) },
        deepColor: { value: new THREE.Color(0.012, 0.03, 0.035) }, skyColor: { value: new THREE.Color(0.5, 0.6, 0.7) },
      }]),
      vertexShader: /* glsl */ `
        uniform mat4 textureMatrix;
        varying vec4 vUvRefl;
        varying vec3 vWorld;
        #include <fog_pars_vertex>
        void main() {
          vec3 transformed = position;
          vUvRefl = textureMatrix * vec4(position, 1.0);
          vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tReflect;
        uniform sampler2D tNormal;
        uniform float time;
        uniform float reflectOn;
        uniform vec3 sunDir;
        uniform vec3 sunColor;
        uniform vec3 deepColor;
        uniform vec3 skyColor;
        varying vec4 vUvRefl;
        varying vec3 vWorld;
        #include <fog_pars_fragment>
        vec2 rip(vec2 p, float s, vec2 v) { return texture2D(tNormal, p / s + v * time).xy * 2.0 - 1.0; }
        void main() {
          vec2 p = vWorld.xz;
          vec2 t = rip(p, 41.0, vec2(0.010, 0.006)) * 0.55 + rip(p, 12.0, vec2(-0.017, 0.011)) * 0.35 + rip(p, 210.0, vec2(-0.003, 0.004)) * 0.6;
          float dist = length(cameraPosition - vWorld);
          t *= 1.0 - clamp(dist / 3000.0, 0.0, 0.85); // calmer far away (no shimmer)
          vec3 N = normalize(vec3(t.x, 1.0, t.y));
          vec3 V = normalize(cameraPosition - vWorld);
          float F = 0.02 + 0.98 * pow(1.0 - max(dot(V, N), 0.0), 5.0);
          vec2 uv = vUvRefl.xy / vUvRefl.w + t * 0.035 / (1.0 + dist * 0.004);
          vec3 refl = reflectOn > 0.5 ? texture2D(tReflect, uv).rgb : skyColor;
          vec3 col = mix(deepColor, refl, F);
          vec3 H = normalize(V + sunDir);
          col += sunColor * pow(max(dot(N, H), 0.0), 420.0) * 70.0 * F;
          gl_FragColor = vec4(min(col, vec3(24.0)), 1.0);
          #include <fog_fragment>
        }`,
    });
    this.material.uniforms.tNormal.value = ripples;
    this.material.uniforms.tReflect.value = this.rt.texture;
    const geo = new THREE.PlaneGeometry(size.x1 - size.x0, size.z1 - size.z0).rotateX(-Math.PI / 2).translate((size.x0 + size.x1) / 2, y, (size.z0 + size.z1) / 2);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'lake';
    this.mesh.receiveShadow = false;
  }

  setSize(w: number, h: number) { this.rt.setSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2))); }

  /** Water body color, the sky color used when reflections are off, and the sun for the glint. */
  setLight(deep: THREE.Color, sky: THREE.Color, sunDir: THREE.Vector3, sunColor: THREE.Color, sunIntensity: number) {
    const u = this.material.uniforms;
    u.deepColor.value.copy(deep); u.skyColor.value.copy(sky);
    u.sunDir.value.copy(sunDir); u.sunColor.value.copy(sunColor).multiplyScalar(sunIntensity);
  }

  private _p = new THREE.Vector3(); private _n = new THREE.Vector3(0, 1, 0); private _cam = new THREE.Vector3();
  private _rot = new THREE.Matrix4(); private _look = new THREE.Vector3(); private _target = new THREE.Vector3();
  private _plane = new THREE.Plane(); private _clip = new THREE.Vector4(); private _q = new THREE.Vector4();
  private _view = new THREE.Vector3(); private _vis: boolean[] = [];
  private _frustum = new THREE.Frustum(); private _pv = new THREE.Matrix4(); private _box = new THREE.Box3();
  /** Mirror passes rendered / skipped because no water was in view (perf report). */
  passes = 0; skipped = 0; lastCalls = 0;

  /** Advances the ripples and renders the mirror image for this frame (call before the post chain). */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, dt: number) {
    this.time += dt;
    this.material.uniforms.time.value = this.time;
    this.material.uniforms.reflectOn.value = this.enabled ? 1 : 0;
    if (!this.enabled) return;
    // this pass runs before the main render, which is where three would refresh the camera matrices
    camera.updateMatrixWorld();
    const p = this._p.set(0, this.y, 0), n = this._n, cam = this._cam.setFromMatrixPosition(camera.matrixWorld);
    if (cam.y < this.y + 0.05) return;
    // no water in the view frustum (facing away from the lake, looking at a floor): skip the pass
    this._pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    if (!this.mesh.geometry.boundingBox) this.mesh.geometry.computeBoundingBox();
    if (!this._frustum.setFromProjectionMatrix(this._pv).intersectsBox(this._box.copy(this.mesh.geometry.boundingBox!))) { this.skipped++; return; }
    this.passes++;
    // mirror the camera across the water plane (three's Reflector math)
    const view = this._view.copy(cam).sub(p).reflect(n).add(p); // the camera mirrored below the water
    this._rot.extractRotation(camera.matrixWorld);
    this._look.set(0, 0, -1).applyMatrix4(this._rot).add(cam);
    this._target.subVectors(p, this._look).reflect(n).negate().add(p);
    const vc = this.virtualCam;
    vc.position.copy(view);
    vc.up.set(0, 1, 0).applyMatrix4(this._rot).reflect(n);
    vc.lookAt(this._target);
    vc.far = camera.far;
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(camera.projectionMatrix);
    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse).multiply(this.mesh.matrixWorld);
    this.material.uniforms.textureMatrix.value.copy(this.textureMatrix);
    // oblique near plane = the water surface, so nothing below it shows up in the mirror
    this._plane.setFromNormalAndCoplanarPoint(n, p).applyMatrix4(vc.matrixWorldInverse);
    const c = this._clip.set(this._plane.normal.x, this._plane.normal.y, this._plane.normal.z, this._plane.constant);
    const e = vc.projectionMatrix.elements;
    this._q.set((Math.sign(c.x) + e[8]) / e[0], (Math.sign(c.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
    c.multiplyScalar(2 / c.dot(this._q));
    e[2] = c.x; e[6] = c.y; e[10] = c.z + 1; e[14] = c.w;

    this.mesh.visible = false;
    const hide = this.hideInReflection, vis = this._vis;
    for (let i = 0; i < hide.length; i++) { vis[i] = hide[i].visible; hide[i].visible = false; }
    // the shadow map must not be refreshed here: with the interiors and furniture hidden it would lose
    // their shadows (sun through walls). A pending update waits for the main pass.
    const prevTarget = renderer.getRenderTarget(), prevShadow = renderer.shadowMap.autoUpdate, pending = renderer.shadowMap.needsUpdate;
    renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false;
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    const c0 = renderer.info.render.calls;
    renderer.render(scene, vc);
    this.lastCalls = renderer.info.render.calls - c0; // meaningful when info.autoReset is off (perf counting)
    renderer.setRenderTarget(prevTarget);
    renderer.shadowMap.autoUpdate = prevShadow; renderer.shadowMap.needsUpdate = pending;
    for (let i = 0; i < hide.length; i++) hide[i].visible = vis[i];
    this.mesh.visible = true;
  }
}
