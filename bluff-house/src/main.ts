import * as THREE from 'three';
import { buildHouse } from './build/house';
import { FLOOR_Y, house, LEVELS, levelOfFeet, squareFootage, validateHouse } from './data/house';
import { PlayerController } from './player/controller';
import { Input } from './player/input';
import { LevelCuller } from './render/culling';
import { createRenderer } from './render/renderer';
import { installTestApi } from './test-api';

const TEST = new URLSearchParams(location.search).has('test');

const errs = validateHouse(house);
if (errs.length) console.error('house-data.json problems:\n' + errs.join('\n'));

const sf = squareFootage(house);
console.info(
  `Bluff House · lower ${sf.byLevel[0].toLocaleString()} / main ${sf.byLevel[1].toLocaleString()} / upper ${sf.byLevel[2].toLocaleString()}` +
  ` = ${sf.heated.toLocaleString()} heated sq ft (+ ${sf.garage.toLocaleString()} garage)`,
);

const rig = createRenderer(document.getElementById('stage')!, TEST);
const built = buildHouse(house);
rig.scene.add(built.root, built.collider);
{
  const s = built.stair;
  console.info(`Stair: ${s.risersPerFloor} risers × ${(s.riser * 12).toFixed(3)} in = ${(s.risersPerFloor * s.riser).toFixed(4)} ft floor-to-floor; ` +
    `${s.perFlight - 1} treads × ${(s.tread * 12).toFixed(0)} in per flight`);
  console.info(`Built in ${built.stats.ms.toFixed(0)} ms · ${built.stats.tris.toLocaleString()} tris in ${built.stats.buckets} merged meshes · collider ${built.stats.colliderTris.toLocaleString()} tris`);
}

const player = new PlayerController(built.bvh, built.ctx.dynamic.map((d) => d.blocker));
const start = house.tourStops[0];
player.teleport(start.x, start.z, FLOOR_Y[1]);
player.yaw = Math.PI / 2; // face west, toward the front doors
const culler = new LevelCuller(built.groups, built.plan);
const input = new Input(rig.renderer.domElement);

// ---- debug toggles ----
input.on('KeyV', () => { built.roof.visible = !built.roof.visible; rig.renderer.shadowMap.needsUpdate = true; });
input.on('KeyC', () => { built.collider.visible = !built.collider.visible; });
const jump: [number, number, number][] = [[21, 23, FLOOR_Y[0]], [13, 33, FLOOR_Y[1]], [28, 19.6, FLOOR_Y[2]]];
(['Digit1', 'Digit2', 'Digit3'] as const).forEach((k, i) => input.on(k, () => player.teleport(jump[i][0], jump[i][1], jump[i][2])));

// ---- HUD ----
const hudLevel = document.getElementById('hudLevel')!, hudRoom = document.getElementById('hudRoom')!, hudMeta = document.getElementById('hudMeta')!;
const fpsEl = document.getElementById('fps')!;
let lastRoom = '';
function updateHud() {
  const L = levelOfFeet(player.feet);
  const room = built.plan.roomAt(L, player.x, player.z);
  const key = room ? room.id : 'out';
  if (key === lastRoom) return;
  lastRoom = key;
  hudLevel.textContent = room ? LEVELS[L].name : 'Outdoors';
  hudRoom.textContent = room ? room.name : 'The Grounds';
  hudMeta.textContent = room?.meta ?? (room ? `${room.rects[0][2] - room.rects[0][0]}′ × ${room.rects[0][3] - room.rects[0][1]}′` : 'Lake Lure, North Carolina');
}

// ---- loop ----
const timer = new THREE.Timer();
let frameMs = 16, fpsT = 0;
function frame(now: number) {
  timer.update(now);
  const dt = Math.min(0.05, timer.getDelta());
  input.update();
  const [mx, my] = input.consumeLook();
  player.yaw -= mx * 0.0022;
  player.pitch = THREE.MathUtils.clamp(player.pitch - my * 0.0022, -1.35, 1.35);
  player.step(dt, input.move);
  for (const d of built.ctx.dynamic) d.update(player.x, player.z, player.feet, dt);
  culler.update(player.x, player.z, player.feet);
  player.applyCamera(rig.camera);
  updateHud();
  rig.renderer.render(rig.scene, rig.camera);
  frameMs = frameMs * 0.95 + dt * 1000 * 0.05;
  fpsT += dt;
  if (fpsT > 0.5) { fpsT = 0; fpsEl.textContent = `${(1000 / frameMs).toFixed(0)} fps · ${rig.renderer.info.render.calls} calls`; }
}

// first frame behind the loader, then fade (no black flash)
player.applyCamera(rig.camera);
culler.update(player.x, player.z, player.feet);
rig.renderer.compile(rig.scene, rig.camera);
rig.renderer.render(rig.scene, rig.camera);
const loader = document.getElementById('loader')!;
(document.getElementById('loaderBar') as HTMLElement).style.width = '100%';
requestAnimationFrame(() => { loader.style.opacity = '0'; setTimeout(() => loader.remove(), 650); });

if (TEST) installTestApi({ rig, built, player, culler, squareFootage: sf });
else rig.renderer.setAnimationLoop(frame);
