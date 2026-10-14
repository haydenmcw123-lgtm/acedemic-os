import * as THREE from 'three';
import type { Plan } from '../build/plan';
import { CEIL_H, FLOOR_Y, house } from '../data/house';
import { INTERIOR_MATERIALS } from '../materials/library';

/**
 * Box-projected reflection probes (Stage 5): one cube probe per major room — great room, kitchen,
 * primary bedroom, foyer, game room and the stair hall — captured from the room's center at eye
 * height (with the baked lighting in place) and prefiltered for roughness with PMREM.
 *
 * Box projection: a reflection ray is intersected with the room's box and the probe is sampled
 * toward that hit point, so a glossy floor reflects the windows where they actually are rather
 * than as if they were infinitely far away.
 *
 * The probe of the room the camera is in drives all interior reflections (outside the probe rooms
 * the warm-room stand-in from Stage 3 stays). Probes re-capture when the time of day changes, the
 * active one first.
 */
interface Probe { id: string; rooms: string[]; pos: THREE.Vector3; min: THREE.Vector3; max: THREE.Vector3; tex: THREE.Texture | null; stale: boolean }

const SIZE = 256; // same as the stand-in PMREM, so switching never recompiles shaders

/** Shared uniforms: every interior material reads the same box. */
export const PROBE_UNIFORMS = {
  probeBoxMin: { value: new THREE.Vector3() },
  probeBoxMax: { value: new THREE.Vector3() },
  probePos: { value: new THREE.Vector3() },
  probeOn: { value: 0 },
};

export class Probes {
  readonly probes: Probe[] = [];
  active: Probe | null = null;
  private cubeRT = new THREE.WebGLCubeRenderTarget(SIZE, { type: THREE.HalfFloatType });
  private cubeCam = new THREE.CubeCamera(0.3, 3000, this.cubeRT);
  private pmrem: THREE.PMREMGenerator;
  private patched = new WeakSet<THREE.Material>();
  captures = 0;

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, plan: Plan) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    const spec: [string, string[]][] = [['great', ['great']], ['kitchen', ['kitchen']], ['primary', ['primary']], ['foyer', ['foyer']], ['game', ['game']], ['stair', ['stair0', 'stair1', 'stair2']]];
    const gableTop = FLOOR_Y[2] + CEIL_H[2] + 9; // the great room's void runs up into the gable
    for (const [id, rooms] of spec) {
      const rs = house.rooms.filter((r) => rooms.includes(r.id));
      if (!rs.length) continue;
      const xs = rs.flatMap((r) => r.rects.flatMap((q) => [q[0], q[2]])), zs = rs.flatMap((r) => r.rects.flatMap((q) => [q[1], q[3]]));
      const lv = rs.map((r) => r.level), y0 = FLOOR_Y[Math.min(...lv)];
      const top = Math.max(...rs.map((r) => (r.noCeil && !r.stair ? gableTop : FLOOR_Y[r.level] + CEIL_H[r.level])));
      const min = new THREE.Vector3(Math.min(...xs), y0, Math.min(...zs)), max = new THREE.Vector3(Math.max(...xs), top, Math.max(...zs));
      // the probe sits at the room's center, at eye height on its main floor
      const main = rs.find((r) => r.level === 1) ?? rs[0];
      const [x0, z0, x1, z1] = main.rects[0];
      const pos = new THREE.Vector3((x0 + x1) / 2, FLOOR_Y[main.level] + 5.5, (z0 + z1) / 2);
      this.probes.push({ id, rooms, pos, min, max, tex: null, stale: true });
    }
    void plan;
  }

  /** Adds box projection to every interior material (idempotent; call again after new materials appear). */
  patchMaterials() {
    for (const m of INTERIOR_MATERIALS) {
      if (this.patched.has(m)) continue;
      this.patched.add(m);
      const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey.bind(m);
      m.onBeforeCompile = (sh, r) => {
        prev.call(m, sh, r);
        Object.assign(sh.uniforms, PROBE_UNIFORMS);
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vProbeWorld;')
          .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n{ vec4 pw = vec4( transformed, 1.0 );\n#ifdef USE_INSTANCING\n pw = instanceMatrix * pw;\n#endif\n vProbeWorld = ( modelMatrix * pw ).xyz; }');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vProbeWorld;\nuniform vec3 probeBoxMin; uniform vec3 probeBoxMax; uniform vec3 probePos; uniform float probeOn;\n' +
            'vec3 boxProject( vec3 dir ) {\n' +
            '  if ( probeOn < 0.5 || any( lessThan( vProbeWorld, probeBoxMin - 0.6 ) ) || any( greaterThan( vProbeWorld, probeBoxMax + 0.6 ) ) ) return dir;\n' +
            '  vec3 tMax = ( probeBoxMax - vProbeWorld ) / dir, tMin = ( probeBoxMin - vProbeWorld ) / dir;\n' +
            '  vec3 t = max( tMax, tMin );\n' +
            '  float d = min( min( t.x, t.y ), t.z );\n' +
            '  return normalize( vProbeWorld + dir * d - probePos );\n' +
            '}')
          .replace('#include <envmap_physical_pars_fragment>', THREE.ShaderChunk.envmap_physical_pars_fragment
            .split('reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );').join('reflectVec = boxProject( transformDirectionByInverseViewMatrix( reflectVec, viewMatrix ) );'));
      };
      m.customProgramCacheKey = () => prevKey() + '|boxprobe';
      m.needsUpdate = true;
    }
  }

  /** Everything needs re-capturing (the time of day changed). */
  invalidate() { for (const p of this.probes) p.stale = true; }

  private capture(p: Probe) {
    this.cubeCam.position.copy(p.pos);
    this.cubeCam.update(this.renderer, this.scene);
    const rt = this.pmrem.fromCubemap(this.cubeRT.texture);
    p.tex?.dispose();
    p.tex = rt.texture;
    p.stale = false;
    this.captures++;
  }

  /**
   * Picks the probe for the room the camera is in, (re)captures it if needed, and points every
   * interior material at it. Returns the texture interior materials should use (null = stand-in).
   */
  /** Off = Stage 4 behaviour (the stand-in environment everywhere), for before/after comparisons. */
  enabled = true;

  update(roomId: string | null): THREE.Texture | null {
    const p = roomId && this.enabled ? this.probes.find((q) => q.rooms.includes(roomId)) ?? null : null;
    if (p && (p.stale || !p.tex)) this.capture(p);
    this.active = p;
    const u = PROBE_UNIFORMS;
    if (p) { u.probeBoxMin.value.copy(p.min); u.probeBoxMax.value.copy(p.max); u.probePos.value.copy(p.pos); u.probeOn.value = 1; }
    else u.probeOn.value = 0;
    return p?.tex ?? null;
  }

  /** Captures every stale probe now (tests and the loader). */
  captureAll() { for (const p of this.probes) if (p.stale || !p.tex) this.capture(p); }
}
