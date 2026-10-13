import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { material } from '../materials/library';
import { kelvin } from './interior';

/**
 * A wood fire in each firebox: three split logs on a glowing ember bed, crossed flame cards drawn
 * by an animated noise shader (additive, HDR, so they bloom), and one shadowless point light that
 * flickers with the flames and warms the hearth and the room.
 */
export class Fire {
  readonly group = new THREE.Group();
  private flameMat: THREE.ShaderMaterial;
  private lights: THREE.PointLight[] = [];
  private t = 0;

  /** `boxes`: firebox floor center, the direction the opening faces (+1 = +x), and its width along z. */
  constructor(boxes: { x: number; y: number; z: number; width: number }[]) {
    this.group.name = 'fire';
    this.flameMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { time: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying float vSeed;
        void main() { vUv = uv; vSeed = position.x * 3.1 + position.z * 1.7; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float time; varying vec2 vUv; varying float vSeed;
        float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
        void main() {
          vec2 uv = vUv;
          float t = time * 1.7 + vSeed;
          float turb = n(vec2(uv.x * 5.0 + vSeed, uv.y * 3.0 - t * 1.6)) * 0.6 + n(vec2(uv.x * 11.0, uv.y * 7.0 - t * 2.6)) * 0.4;
          float w = (1.0 - uv.y * 0.9) * 0.48;                       // tongue narrows upward
          float d = abs(uv.x - 0.5 + (turb - 0.5) * 0.22 * uv.y) / max(w, 0.02);
          float body = smoothstep(1.0, 0.25, d + turb * 0.35) * smoothstep(1.0, 0.45, uv.y + turb * 0.35) * smoothstep(0.0, 0.08, uv.y);
          vec3 c = mix(vec3(1.0, 0.18, 0.02), vec3(1.0, 0.68, 0.28), body);
          gl_FragColor = vec4(c * body * 7.0, body);
        }`,
    });
    const logs: THREE.BufferGeometry[] = [], flames: THREE.BufferGeometry[] = [], embers: THREE.BufferGeometry[] = [];
    const warm = kelvin(1900);
    for (const b of boxes) {
      for (const [dz, ry, dy] of [[-0.45, 0.25, 0.22], [0.4, -0.2, 0.22], [0, 0.05, 0.55]]) {
        logs.push(new THREE.CylinderGeometry(0.22, 0.25, Math.min(2.6, b.width - 0.6), 9).rotateX(Math.PI / 2).rotateY(ry).translate(b.x, b.y + dy, b.z + dz * 0.6));
      }
      embers.push(new THREE.PlaneGeometry(1.4, Math.min(3, b.width - 0.4)).rotateX(-Math.PI / 2).translate(b.x, b.y + 0.04, b.z));
      for (let k = 0; k < 5; k++) {
        const g = new THREE.PlaneGeometry(1.1 + (k % 2) * 0.4, 1.5 + (k % 3) * 0.35).translate(0, 0.75 + (k % 3) * 0.17, 0);
        g.rotateY((k / 5) * Math.PI + 0.3).translate(b.x + ((k % 3) - 1) * 0.15, b.y + 0.35, b.z + (k - 2) * 0.42);
        flames.push(g);
      }
      const l = new THREE.PointLight(warm, 0, 22, 2);
      l.position.set(b.x + 0.9, b.y + 1.2, b.z); l.castShadow = false;
      this.lights.push(l); this.group.add(l);
    }
    const logMesh = new THREE.Mesh(mergeGeometries(logs.map((g) => g.toNonIndexed()))!, material('timber', 'int'));
    const emberMesh = new THREE.Mesh(mergeGeometries(embers)!, material('ember', 'int'));
    const flameMesh = new THREE.Mesh(mergeGeometries(flames)!, this.flameMat);
    flameMesh.renderOrder = 2; flameMesh.frustumCulled = false;
    this.group.add(logMesh, emberMesh, flameMesh);
  }

  update(dt: number) {
    this.t += dt;
    this.flameMat.uniforms.time.value = this.t;
    const f = 0.75 + 0.15 * Math.sin(this.t * 13.1) + 0.1 * Math.sin(this.t * 7.3 + 1.7) + 0.08 * Math.sin(this.t * 23.0);
    for (const l of this.lights) l.intensity = 9 * f;
  }
}
