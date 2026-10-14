import * as THREE from 'three';
import { buildHouse } from './build/house';
import { siteBlocked } from './build/landscape';
import { buildTrees, wind } from './build/trees';
import { buildWorld, LAKE_Y, LOT } from './build/world';
import { Lake } from './render/lake';
import { Lightmaps } from './lighting/lightmaps';
import { Probes } from './lighting/probes';
import { Fire } from './lighting/fire';
import { buildOutdoorLights } from './lighting/outdoor';
import { Furniture } from './furniture/furnish';
import { loadModels } from './furniture/models';
import { LOOSE_MATERIALS } from './materials/library';
import { FLOOR_Y, house, squareFootage, validateHouse } from './data/house';
import { fmtClock } from './lighting/sun';
import { InteriorLights } from './lighting/interior';
import { InteriorEnv } from './lighting/interiorEnv';
import { SkyRig } from './lighting/sky';
import { DAY, daylightAt, TimeOfDay } from './lighting/timeofday';
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

// ---- the world beyond the lot: hills, far shore, ridges, the lake and the fall trees ----
const world = buildWorld(built.terrain);
rig.scene.add(world.group);
const lake = new Lake(LAKE_Y);
rig.scene.add(lake.mesh);
const inLot = (x: number, z: number) => x > LOT.x0 && x < LOT.x1 && z > LOT.z0 && z < LOT.z1;
const trees = buildTrees({ height: (x, z) => (inLot(x, z) ? built.terrain.height(x, z) : world.height(x, z)), blocked: siteBlocked(house) });
rig.scene.add(trees.group);
console.info(`Landscape: ${trees.count} near trees, mid-distance impostors, far shore at ~1,750 ft, three Blue Ridge ridgelines`);

const furniture = new Furniture(house, built.groups);
{
  const fs = furniture.stats();
  console.info(`Furniture: ${fs.items} items from the JSON in ${fs.meshes} merged meshes (${fs.tris.toLocaleString()} tris), ${fs.blockers} colliders`);
  for (const r of furniture.report) console.warn('furniture: ' + r);
}
const player = new PlayerController(built.bvh, [...built.ctx.dynamic.map((d) => d.blocker), ...furniture.blockers]);
const tour = new Tour(house.tourStops);
const director = new Director(player, tour);
const culler = new LevelCuller(built.groups, built.plan);
const input = new Input(rig.renderer.domElement);
const sky = new SkyRig(rig.renderer, rig.scene);
sky.sky.name = 'sky';
const outdoorLights = buildOutdoorLights(house);
rig.scene.add(outdoorLights.group);
const interior = new InteriorLights(rig.scene, built.plan, outdoorLights.points);
// a fire in each main-level firebox (floor center just inside the opening)
const fire = new Fire(house.openings.filter((o) => o.kind === 'fireplace' && o.level === 1).map((o) => ({ x: o.at + 1.25, y: FLOOR_Y[1] + 1, z: (o.from + o.to) / 2, width: o.to - o.from - 3 })));
built.groups.get('L1i')!.add(fire.group);
const post = new Post(rig.renderer, rig.scene, rig.camera, 'agx');
rig.onResize.push((w, h) => post.setSize(w, h));
const time = new TimeOfDay(rig, sky, interior, new InteriorEnv(rig.renderer));
// baked GI (Stage 5): loads in the background; until it arrives the real-time stand-in lighting shows
const lightmaps = new Lightmaps(rig.renderer);
const probes = new Probes(rig.renderer, rig.scene, built.plan);
let probeRoom: string | null | undefined;
/** Room probes: the probe of the room the camera is in drives interior reflections. */
function updateProbe(force = false) {
  const room = culler.inside ? built.plan.roomAt(culler.level, player.x, player.z)?.id ?? null : null;
  if (room === probeRoom && !force && !(probes.active?.stale)) return;
  probeRoom = room;
  time.interiorEnv.override = probes.update(room);
  time.interiorEnv.assign();
}
const lightmapsLoaded = lightmaps.load([...built.groups.values()]).then((ok) => {
  probes.patchMaterials();
  if (ok) {
    lightmaps.setTime(time.hour, daylightAt); lightmaps.update(0, true);
    probes.captureAll(); // all six behind the loader: walking into a room never waits on a capture
    rig.renderer.compile(rig.scene, rig.camera);
    console.info(`Baked GI: ${lightmaps.receivers.length} surfaces lightmapped`);
  } else console.info('Baked GI: no lightmaps (run pnpm bake): real-time lighting only');
  for (const p of lightmaps.problems) console.warn('lightmaps: ' + p);
});
const impostorLight = (trees.group.getObjectByName('trees:impostors') as THREE.Mesh).material as THREE.ShaderMaterial;
time.outdoor = (deep, haze, dir, sunColor, sunI, skyCol, skyI) => {
  lake.setLight(deep, haze, dir, sunColor, sunI);
  // impostors are unlit billboards: give them the same sun + sky light the real trees get
  impostorLight.uniforms.light.value.copy(sunColor).multiplyScalar(sunI * 0.12 * Math.max(0, dir.y + 0.15)).add(skyCol.clone().multiplyScalar(skyI * 1.6));
};
// the mirror pass runs before the post chain (never inside the AO pass); interior furniture is left out of it
lake.hideInReflection = [...built.groups.values()].filter((g) => g.name !== 'site').flatMap((g) => g.children.filter((c) => c.name.startsWith('furniture:')));
post.beforeRender = (dt) => lake.render(rig.renderer, rig.scene, rig.camera, dt);
rig.onResize.push((w, h) => lake.setSize(w, h));
console.info(`Lights: ${interior.counts.cans} recessed cans, ${interior.counts.clusters} room light clusters, ${interior.counts.windows} daylight glass walls`);
const caption = new Caption();
const labels = new RoomLabels(built.bvh, built.opaque);
const measure = new Measure(rig.scene, built.bvh);

// ---- quality (adaptive "Auto" arrives in Stage 6; until then it equals High) ----
function setQuality(q: Quality) {
  const ratio = { auto: 1, high: 1, medium: 0.85, low: 0.75 }[q];
  rig.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5) * ratio);
  post.apply(POST_PRESETS[q === 'auto' ? 'high' : q]);
  lake.enabled = q !== 'low'; // Low drops the lake reflection (the water shows the sky color)
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
  onFurnished: () => toggleFurnished(),
  onQuality: (q) => setQuality(q),
});
function toggleFurnished() {
  furniture.setFurnished(!furniture.furnished);
  dock.setFurnished(furniture.furnished);
  dock.toast(furniture.furnished ? 'Furnished' : 'Empty · built-ins stay');
}
const _ray = new THREE.Raycaster();
/** Click a sofa, bed, chair or rug to cycle its finish (only if no wall is in front of it). */
function stageClick(nx: number, ny: number): boolean {
  _ray.setFromCamera(new THREE.Vector2(nx, ny), rig.camera);
  const hit = furniture.pick(_ray.ray, 40);
  if (!hit) return false;
  const wall = built.bvh.raycastFirst(_ray.ray, THREE.DoubleSide);
  if (wall && wall.distance < hit.dist - 0.5 && built.opaque[wall.faceIndex!]) return false;
  const label = furniture.cycle(hit.item);
  if (label) dock.toast(`${hit.item.name} · ${label}`);
  return true;
}
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
time.onChange = (h) => { dock.setTime(h); lightmaps.setTime(h, daylightAt); probes.invalidate(); };
director.onModeChange(director.mode);

input.on('Space', () => { if (measure.on) toggleMeasure(); director.toggle(); });
input.on('KeyR', () => director.resume());
input.on('KeyL', () => dock.setSizes(labels.toggle()));
input.on('KeyM', toggleMeasure);
input.on('KeyF', () => toggleFurnished());
input.on('KeyT', () => time.nextPreset());
input.on('KeyB', () => { setBaked(!lightmaps.enabled); dock.toast(lightmaps.enabled ? 'Baked GI + probes on' : 'Baked GI + probes off (Stage 4 lighting)'); });
/** Baked GI and room probes together (B, and the before/after proof). */
function setBaked(on: boolean) { lightmaps.setEnabled(on); probes.enabled = on; updateProbe(true); }
input.on('KeyH', () => dock.toggleHint());
input.on('Escape', () => { if (measure.on) toggleMeasure(); });
input.onUnlock = () => { if (measure.on) measure.cancel(); };
input.onCanvasClick = (nx, ny) => {
  if (measure.on) { measure.click(rig.camera, nx, ny); return true; }
  if (stageClick(nx, ny)) return true;
  director.pause(); // clicking the view takes over: free walk from here
  return false;
};
input.onMouseMove = (nx, ny) => measure.move(rig.camera, nx, ny);
// debug
input.on('KeyV', () => { built.roof.visible = !built.roof.visible; rig.renderer.shadowMap.needsUpdate = true; });
input.on('KeyC', () => { built.collider.visible = !built.collider.visible; });
const jump: [number, number, number][] = [[21, 23, FLOOR_Y[0]], [13, 33, FLOOR_Y[1]], [28, 19.6, FLOOR_Y[2]]];
(['Digit1', 'Digit2', 'Digit3'] as const).forEach((k, i) => input.on(k, () => { director.pause(); player.teleport(jump[i][0], jump[i][1], jump[i][2]); }));

let probeTimer = 0;
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
  furniture.update(dt);
  if (furniture.shadowsDirty) { furniture.shadowsDirty = false; rig.renderer.shadowMap.needsUpdate = true; }
  director.apply(rig.camera);
  time.tick(dt, culler.inside);
  lightmaps.update(dt);
  probeTimer -= dt;
  if (probeTimer <= 0) { probeTimer = 0.5; updateProbe(); } // re-capture at most twice a second
  wind.time.value += dt;
  fire.update(dt);
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
// …including the see-through variants the Furnished fade uses, so toggling F never hitches
for (const m of LOOSE_MATERIALS) m.transparent = true;
rig.renderer.compile(rig.scene, rig.camera);
for (const m of LOOSE_MATERIALS) m.transparent = false;
post.render(0);
const loader = document.getElementById('loader')!;
(document.getElementById('loaderBar') as HTMLElement).style.width = '100%';
requestAnimationFrame(() => { loader.style.opacity = '0'; setTimeout(() => loader.remove(), 650); });

/** Renders one fully settled frame (tests): env map, shadows, lights and exposure all up to date. */
function renderSettled() {
  time.tick(0, culler.inside, true);
  lightmaps.update(0, true);
  updateProbe(true);
  interior.update(rig.camera.position, player.feet, culler.inside, 0, true);
  post.exposure.exposure = time.exposure;
  rig.renderer.shadowMap.needsUpdate = true;
  post.render(0);
}
// downloaded furniture models (if any) replace their stand-ins as they arrive
void loadModels(furniture).then((n) => { if (n) console.info(`Furniture: ${n} downloaded models in place of their stand-ins`); });
if (TEST) void lightmapsLoaded.then(() => installTestApi({ rig, built, furniture, lake, lightmaps, probes, setBaked, player, culler, director, tour, time, caption, labels, measure, step, post, interior, renderSettled, squareFootage: sf }));
else rig.renderer.setAnimationLoop(frame);
