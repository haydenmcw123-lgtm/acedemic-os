import * as THREE from 'three';
import { BlendFunction, BloomEffect, Effect, EffectComposer, EffectPass, HueSaturationEffect, NoiseEffect, RenderPass, SMAAEffect, SMAAPreset, ToneMappingEffect, ToneMappingMode, VignetteEffect } from 'postprocessing';
// n8ao ships without type declarations
// @ts-expect-error untyped module
import { N8AOPostPass } from 'n8ao';

/** Scene-referred exposure, applied before tone mapping (photographic "stops" as a multiplier). */
class ExposureEffect extends Effect {
  constructor() {
    super('ExposureEffect', /* glsl */ `
      uniform float exposure;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        outputColor = vec4(min(inputColor.rgb * exposure, vec3(64.0)), inputColor.a);
      }`, { uniforms: new Map([['exposure', new THREE.Uniform(1)]]) });
  }
  get exposure() { return this.uniforms.get('exposure')!.value as number; }
  set exposure(v: number) { this.uniforms.get('exposure')!.value = v; }
}

/**
 * Display-referred S-curve: adds midtone contrast but, unlike a linear contrast control, keeps
 * black at 0 and white at 1 with a soft shoulder, so bright glass is never pushed into clipping.
 */
class SCurveEffect extends Effect {
  constructor(amount: number) {
    super('SCurveEffect', /* glsl */ `
      uniform float amount;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = clamp(inputColor.rgb, 0.0, 1.0);
        outputColor = vec4(mix(c, c * c * (3.0 - 2.0 * c), amount), inputColor.a);
      }`, { uniforms: new Map([['amount', new THREE.Uniform(amount)]]) });
  }
}

export type ToneMap = 'agx' | 'aces';

export interface PostSettings { ao: boolean; aoHalfRes: boolean; aoSamples: number; bloom: boolean; smaa: boolean }
export const POST_PRESETS: Record<'high' | 'medium' | 'low', PostSettings> = {
  high: { ao: true, aoHalfRes: true, aoSamples: 16, bloom: true, smaa: true },
  medium: { ao: true, aoHalfRes: true, aoSamples: 8, bloom: true, smaa: true },
  low: { ao: false, aoHalfRes: true, aoSamples: 8, bloom: false, smaa: true },
};

/**
 * HDR post chain (pmndrs postprocessing, half-float buffers):
 *   render → N8AO (world-space radius, half res) → exposure → bloom → tone map → vignette + grain → SMAA.
 * Bloom only catches what is brighter than 1.0 after exposure: the sun, bulbs, bright glass.
 */
export class Post {
  readonly composer: EffectComposer;
  readonly ao: any;
  readonly exposure = new ExposureEffect();
  readonly bloom: BloomEffect;
  readonly tone: ToneMappingEffect;
  private grade: EffectPass;
  private aa: EffectPass;
  settings: PostSettings = POST_PRESETS.high;
  /** Draw calls of the last main scene pass (without the mirror pass, AO and post). */
  sceneCalls = 0;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, toneMap: ToneMap = 'agx') {
    renderer.toneMapping = THREE.NoToneMapping; // the composer tone maps
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    const scenePass = new RenderPass(scene, camera);
    // count the main scene pass's draw calls on their own (the perf report's budget figure)
    const draw = scenePass.render.bind(scenePass);
    scenePass.render = (...args: Parameters<RenderPass['render']>) => {
      const info = renderer.info.render, c0 = info.calls;
      draw(...args);
      this.sceneCalls = renderer.info.autoReset ? info.calls : info.calls - c0;
    };
    this.composer.addPass(scenePass);
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.ao = new N8AOPostPass(scene, camera, size.x, size.y);
    Object.assign(this.ao.configuration, {
      aoRadius: 4, // ft: corners and furniture contacts, not whole rooms
      distanceFalloff: 1.0,
      intensity: 4,
      aoSamples: 16,
      denoiseSamples: 8,
      denoiseRadius: 10,
      halfRes: true,
      depthAwareUpsampling: true,
      screenSpaceRadius: false, // world-space radius: distant ridges get no AO (no dark ridge lines)
      gammaCorrection: false, // linear HDR in, tone mapping happens later
      color: new THREE.Color(0, 0, 0),
    });
    // glass is the only transparency and N8AO's transparency-aware mode would cost two full-screen
    // half-float buffers, a depth copy and a second render of every pane each frame (≈ 40 MB at 1080p),
    // plus a whole-scene traversal per frame to auto-detect it: off
    this.ao.autoDetectTransparency = false;
    this.ao.configuration.transparencyAware = false;
    this.composer.addPass(this.ao);
    this.bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 1.1, luminanceSmoothing: 0.25, intensity: 0.55, radius: 0.7 });
    this.tone = new ToneMappingEffect({ mode: toneMap === 'agx' ? ToneMappingMode.AGX : ToneMappingMode.ACES_FILMIC });
    const vignette = new VignetteEffect({ offset: 0.32, darkness: 0.42 });
    const noise = new NoiseEffect({ premultiply: true, blendFunction: BlendFunction.SCREEN });
    noise.blendMode.opacity.value = 0.02; // ≤ 2% grain
    // AgX is gentle on highlights (the windows stay readable) but flat; a soft S-curve and a little
    // saturation after it bring back some of ACES's punch without its blown-out glass
    const contrast = new SCurveEffect(0.3);
    const saturation = new HueSaturationEffect({ saturation: 0.08 });
    this.grade = new EffectPass(camera, this.exposure, this.bloom, this.tone, contrast, saturation, vignette, noise);
    this.composer.addPass(this.grade);
    this.aa = new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.HIGH }));
    this.composer.addPass(this.aa);
  }

  setToneMap(t: ToneMap) { this.tone.mode = t === 'agx' ? ToneMappingMode.AGX : ToneMappingMode.ACES_FILMIC; }

  apply(s: PostSettings) {
    this.settings = s;
    this.ao.enabled = s.ao;
    this.ao.configuration.halfRes = s.aoHalfRes;
    this.ao.configuration.aoSamples = s.aoSamples;
    this.bloom.blendMode.opacity.value = s.bloom ? 1 : 0;
    this.aa.enabled = s.smaa;
  }

  /** Runs before the chain each frame (the lake's mirror pass), never inside it. */
  beforeRender: ((dt: number) => void) | null = null;
  setSize(w: number, h: number) { this.composer.setSize(w, h); }
  render(dt?: number) { this.beforeRender?.(dt ?? 0); this.composer.render(dt); }
}
