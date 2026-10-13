import * as THREE from 'three';
import { buildHouse } from './build/house';
import { FLOOR_Y, house, squareFootage, validateHouse } from './data/house';
import { fmtClock } from './lighting/sun';
import { InteriorLights } from './lighting/interior';
import { InteriorEnv } from './lighting/interiorEnv';
import { SkyRig } from './lighting/sky';
import { DAY, TimeOfDay } from './lighting/timeofday';
import { PlayerController } from './player/controller';
import { Director } from './player/director';
import { Input } from './player/input';
import { Tour } from './player/tour';
import { LevelCuller } from './render/culling';
import { installHeightFog } from './render/fog';
import { Post, POST_PRESETS } from './render/post';
import { createRenderer } from './render/renderer';
import { installTestApi } from './test-api';
import { Caption } from './ui/caption';
import { Dock, type Quality } from './ui/dock';
import { RoomLabels } from './ui/labels';
import { Measure } from './ui/measure';
import { whereAt } from './ui/where';

const TEST = new URLSearchParams(location.search).has('test');
installHeightFog(); // before any material compiles

const errs = validateHouse(house);
if (errs.length) console.error('house-data.json problems:\n' + errs.join('\n'));
const sf = squareFootage(house);
console.info(
  `Bluff House · lower ${sf.byLevel[0].toLocaleString()} / main ${sf.byLevel[1].toLocaleString()} / upper ${sf.byLevel[2].toLocaleString()}` +
  ` = ${sf.heated.toLocaleString()} heated sq ft (+ ${sf.garage.toLocaleString()} garage)`,
);
console.info(`Sun on ${house.location.date}: sunrise ${fmtClock(DAY.sunrise)}, solar noon ${fmtClock(DAY.solarNoon)}, sunset ${fmtClock(DAY.sunset)} (EDT)`);

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
const tour = new Tour(house.tourStops);
const director = new Director(player, tour);
const culler = new LevelCuller(built.groups, built.plan);
const input = new Input(rig.renderer.domElement);
const sky = new SkyRig(rig.renderer, rig.scene);
sky.sky.name = 'sky';
const interior = new InteriorLights(rig.scene, built.plan);
const post = new Post(rig.renderer, rig.scene, rig.camera, 'agx');
rig.onResize.push((w, h) => post.setSize(w, h));
const time = new TimeOfDay(rig, sky, interior, new InteriorEnv(rig.renderer));
console.info(`Lights: ${interior.counts.cans} recessed cans, ${interior.counts.clusters} room light clusters, ${interior.counts.windows} daylight glass walls`);
const caption = new Caption();
const labels = new RoomLabels(built.bvh, built.opaque);
const measure = new Measure(rig.scene, built.bvh);

// ---- quality (adaptive "Auto" arrives in Stage 6; until then it equals High) ----
function setQuality(q: Quality) {
  const ratio = { auto: 1, high: 1, medium: 0.85, low: 0.75 }[q];
  rig.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5) * ratio);
  post.apply(POST_PRESETS[q === 'auto' ? 'high' : q]);
  const sm = { auto: 4096, high: 4096, medium: 2048, low: 1024 }[q];
  if (rig.sun.shadow.mapSize.x !== sm) {
    rig.sun.shadow.mapSize.set(sm, sm);
    rig.sun.shadow.map?.dispose(); rig.sun.shadow.map = null;
    rig.renderer.shadowMap.needsUpdate = true;
  }
  rig.resize();
  dock.setQuality(q);
}

// ---- UI ----
const chip = document.getElementById('chip')!, chipText = document.getElementById('chipText')!;
const dock = new Dock({
  onTour: () => director.toggle(),
  onTime: (h) => time.set(h),
  onSizes: () => dock.setSizes(labels.toggle()),
  onMeasure: () => toggleMeasure(),
  onFurnished: () => dock.toast('Furniture arrives in Stage 4'),
  onQuality: (q) => setQuality(q),
});
function toggleMeasure() {
  const on = measure.toggle();
  dock.setMeasure(on);
  if (on) { director.pause(); dock.toast(input.locked ? 'Measure: click two points (crosshair)' : 'Measure: click two points · Esc cancels'); }
}
director.onModeChange = (m) => {
  dock.setTour(m === 'tour');
  chip.classList.toggle('walk', m === 'walk');
  chipText.textContent = m === 'tour' ? 'Guided tour' : 'Free walk';
};
director.onTourDone = () => dock.toast('Tour complete · walk freely, or press R to go again', 4000);
time.onChange = (h) => dock.setTime(h);
director.onModeChange(director.mode);

input.on('Space', () => { if (measure.on) toggleMeasure(); director.toggle(); });
input.on('KeyR', () => director.resume());
input.on('KeyL', () => dock.setSizes(labels.toggle()));
input.on('KeyM', toggleMeasure);
input.on('KeyF', () => dock.toast('Furniture arrives in Stage 4'));
input.on('KeyT', () => time.nextPreset());
input.on('KeyH', () => dock.toggleHint());
input.on('Escape', () => { if (measure.on) toggleMeasure(); });
input.onUnlock = () => { if (measure.on) measure.cancel(); };
input.onCanvasClick = (nx, ny) => {
  if (measure.on) { measure.click(rig.camera, nx, ny); return true; }
  director.pause(); // clicking the view takes over: free walk from here
  return false;
};
input.onMouseMove = (nx, ny) => measure.move(rig.camera, nx, ny);
// debug
input.on('KeyV', () => { built.roof.visible = !built.roof.visible; rig.renderer.shadowMap.needsUpdate = true; });
input.on('KeyC', () => { built.collider.visible = !built.collider.visible; });
const jump: [number, number, number][] = [[21, 23, FLOOR_Y[0]], [13, 33, FLOOR_Y[1]], [28, 19.6, FLOOR_Y[2]]];
(['Digit1', 'Digit2', 'Digit3'] as const).forEach((k, i) => input.on(k, () => { director.pause(); player.teleport(jump[i][0], jump[i][1], jump[i][2]); }));

/** One simulation + presentation step. Shared by the render loop and the test driver. */
function step(dt: number) {
  input.update();
  if (director.mode === 'tour' && input.moving) director.pause();
  const look = input.consumeLook();
  director.update(dt, input.move, look);
  for (const d of built.ctx.dynamic) {
    const before = d.blocker.rot;
    d.update(player.x, player.z, player.feet, dt);
    if (Math.abs(d.blocker.rot - before) > 1e-4) rig.renderer.shadowMap.needsUpdate = true; // the bookcase door's shadow
  }
  culler.update(player.x, player.z, player.feet);
  director.apply(rig.camera);
  time.tick(dt, culler.inside);
  interior.update(rig.camera.position, player.feet, culler.inside, dt);
  post.exposure.exposure = time.exposure;
  caption.update(whereAt(built.plan, player.x, player.z, player.feet), dt);
}

// ---- loop ----
const timer = new THREE.Timer();
const fpsEl = document.getElementById('fps')!;
let frameMs = 16, fpsT = 0;
function frame(now: number) {
  timer.update(now);
  const dt = Math.min(0.05, timer.getDelta());
  step(dt);
  labels.update(rig.camera, player.feet, dt);
  measure.update(rig.camera);
  post.render(dt);
  frameMs = frameMs * 0.95 + dt * 1000 * 0.05;
  fpsT += dt;
  if (fpsT > 0.5) { fpsT = 0; fpsEl.textContent = `${(1000 / frameMs).toFixed(0)} fps`; }
}

// ---- boot: first frame rendered behind the loader, then a 600 ms fade (no black flash) ----
setQuality('auto');
time.set(17.75);
dock.setTour(true);
step(0);
time.tick(0, culler.inside, true);
interior.update(rig.camera.position, player.feet, culler.inside, 0, true);
post.exposure.exposure = time.exposure;
rig.renderer.shadowMap.needsUpdate = true;
rig.resize();
rig.renderer.compile(rig.scene, rig.camera); // shader warm-up behind the loader
post.render(0);
const loader = document.getElementById('loader')!;
(document.getElementById('loaderBar') as HTMLElement).style.width = '100%';
requestAnimationFrame(() => { loader.style.opacity = '0'; setTimeout(() => loader.remove(), 650); });

/** Renders one fully settled frame (tests): env map, shadows, lights and exposure all up to date. */
function renderSettled() {
  time.tick(0, culler.inside, true);
  interior.update(rig.camera.position, player.feet, culler.inside, 0, true);
  post.exposure.exposure = time.exposure;
  rig.renderer.shadowMap.needsUpdate = true;
  post.render(0);
}
if (TEST) installTestApi({ rig, built, player, culler, director, tour, time, caption, labels, measure, step, post, interior, renderSettled, squareFootage: sf });
else rig.renderer.setAnimationLoop(frame);
