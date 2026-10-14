import * as THREE from 'three';
import { PROBE_SIZE } from './probes';
import { INTERIOR_MATERIALS } from '../materials/library';

/**
 * A stand-in "room" environment for interior surfaces until Stage 5's baked lighting and
 * box-projected probes: warm wood floor, warm-white walls and ceiling, and one big window
 * whose brightness and color follow the sky (plus a sun patch on the floor). Interiors then
 * pick up warm bounce and window-side reflections instead of reflecting the open sky.
 */
export class InteriorEnv {
  private scene = new THREE.Scene();
  private pmrem: THREE.PMREMGenerator;
  private rt: THREE.WebGLRenderTarget | null = null;
  texture: THREE.Texture | null = null;
  /** A room probe in use (Stage 5): interior materials show it instead of this stand-in. */
  override: THREE.Texture | null = null;
  private floor: THREE.MeshBasicMaterial;
  private walls: THREE.MeshBasicMaterial;
  private ceil: THREE.MeshBasicMaterial;
  private window: THREE.MeshBasicMaterial;
  private sunPatch: THREE.MeshBasicMaterial;
  private lamps: THREE.MeshBasicMaterial;

  constructor(renderer: THREE.WebGLRenderer) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    const mk = (c: number) => new THREE.MeshBasicMaterial({ color: c, side: THREE.BackSide });
    this.floor = mk(0x000000); this.walls = mk(0x000000); this.ceil = mk(0x000000);
    const room = new THREE.Mesh(new THREE.BoxGeometry(30, 11, 30), [this.walls, this.walls, this.ceil, this.floor, this.walls, this.walls]);
    room.position.y = 5.5 - 5.5; // camera (env origin) at eye height ~5.5 ft above the floor
    this.scene.add(room);
    this.window = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide });
    const win = new THREE.Mesh(new THREE.PlaneGeometry(22, 8), this.window);
    win.position.set(-14.9, 0.3, 0); win.rotation.y = Math.PI / 2;
    this.scene.add(win);
    this.sunPatch = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide });
    const patch = new THREE.Mesh(new THREE.PlaneGeometry(9, 14), this.sunPatch);
    patch.rotation.x = -Math.PI / 2; patch.position.set(-8, -5.45, 0);
    this.scene.add(patch);
    this.lamps = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide });
    for (const [x, z] of [[-6, -6], [6, -6], [-6, 6], [6, 6]]) {
      const l = new THREE.Mesh(new THREE.CircleGeometry(0.9, 16), this.lamps);
      l.rotation.x = Math.PI / 2; l.position.set(x, 5.45, z); this.scene.add(l);
    }
  }

  /**
   * daylight 0..1, sky color (linear), direct sun 0..1 with its color, lamps 0..1.
   * Values are linear radiance tuned against the sun at 3.4.
   */
  set(daylight: number, sky: THREE.Color, direct: number, sunColor: THREE.Color, lamps: number) {
    const lamp = new THREE.Color(1.0, 0.62, 0.34);
    const bounce = 0.22 * daylight + 0.18 * direct;
    this.floor.color.setRGB(0.32, 0.2, 0.11).multiplyScalar(bounce + 0.05 * lamps);
    this.walls.color.setRGB(0.62, 0.59, 0.54).multiplyScalar(bounce * 0.85).add(lamp.clone().multiplyScalar(0.07 * lamps));
    this.ceil.color.setRGB(0.66, 0.63, 0.58).multiplyScalar(bounce * 0.7).add(lamp.clone().multiplyScalar(0.05 * lamps));
    this.window.color.copy(sky).multiplyScalar(2.2 * daylight + 0.004);
    this.sunPatch.color.copy(sunColor).multiplyScalar(1.2 * direct);
    this.lamps.color.copy(lamp).multiplyScalar(6 * lamps);
    const rt = this.pmrem.fromScene(this.scene, 0, 0.1, 100, { size: PROBE_SIZE }); // same size as the room probes: no shader recompiles when they swap
    this.rt?.dispose();
    this.rt = rt;
    this.texture = rt.texture;
    this.assign();
  }

  /** Points every interior material at the active room probe, or at this stand-in. */
  assign() {
    const tex = this.override ?? this.texture;
    for (const m of INTERIOR_MATERIALS) { if (!m.userData.hadEnv) { m.needsUpdate = true; m.userData.hadEnv = true; } m.envMap = tex; }
  }
}
