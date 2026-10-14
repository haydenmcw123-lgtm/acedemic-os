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
import { ktx2, loadPrebuiltTextures } from './materials/prebuilt';
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
import { AdaptiveQuality, TIERS, type Tier } from './render/adaptive';
import { LevelCuller } from './render/culling';
import { installHeightFog } from './render/fog';
import { Post, POST_PRESETS } from './render/post';
import { allocShadowMap, createRenderer } from './render/renderer';
import { installTestApi } from './test-api';
import { gpuMemory, installGpuMemoryCounter } from './perf/gpumem';
import { downloadMB, gpuName, PerfRecorder, showReport, type PassStats } from './perf/perfmode';
import { Caption } from './ui/caption';
import { Dock, type Quality } from './ui/dock';
import { RoomLabels } from './ui/labels';
import { Measure } from './ui/measure';
import { whereAt } from './ui/where';

const params = new URLSearchParams(location.search);
const TEST = params.has('test');
/** `?perf` (or `?perf=high,medium,low`): play the tour once per quality and report frame times. */
const PERF = params.has('perf') ? (params.get('perf') || 'high,medium').split(',') as Quality[] : null;
if (TEST || PERF) installGpuMemoryCounter(); // before the renderer exists
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
// the pre-baked KTX2 textures (pnpm textures) before anything uses a material; else generated in code
const prebuilt = await loadPrebuiltTextures(rig.renderer);
console.info(prebuilt ? `Textures: ${prebuilt} pre-baked KTX2 sets` : 'Textures: generated in code (run pnpm textures for KTX2)');
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
  console.info(`Furniture: ${fs.items} items from the JSON in ${fs.meshes} merged meshes (${fs.tris.toLocaleString()} tris; far-away twins ${fs.loTris.toLocaleString()}), ${fs.blockers} colliders`);
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
const lightmaps = new Lightmaps(ktx2(rig.renderer));
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
    lightmaps.setTime(time.hour, daylightAt);
    probes.captureAll(); // all six behind the loader: walking into a room never waits on a capture
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
// the mirror pass runs before the post chain (never inside the AO pass). The interiors are left out
// of it: through the glass, upside down, rippled and at half resolution they are invisible, and
// skipping them roughly halves the pass's draw calls. So is the furniture on the shell (covered decks).
// Anything holding a light stays (the fires): a light that vanishes for one pass changes the light
// setup between passes, and three re-checks every lit shader twice a frame.
const INTERIOR_GROUPS = new Set(['L0i', 'L1i', 'L2i', 'stair']);
const hasLight = (o: THREE.Object3D) => { let l = false; o.traverse((c) => { if ((c as THREE.Light).isLight) l = true; }); return l; };
lake.hideInReflection = [...built.groups].flatMap(([k, g]) => (INTERIOR_GROUPS.has(k) ? g.children : k === 'site' ? [] : g.children.filter((c) => c.name.startsWith('furniture:'))).filter((c) => !hasLight(c)));
post.beforeRender = (dt) => lake.render(rig.renderer, rig.scene, rig.camera, dt);
rig.onResize.push((w, h) => lake.setSize(w, h));
console.info(`Lights: ${interior.counts.cans} recessed cans, ${interior.counts.clusters} room light clusters, ${interior.counts.windows} daylight glass walls`);
const caption = new Caption();
const labels = new RoomLabels(built.bvh, built.opaque);
const measure = new Measure(rig.scene, built.bvh);

// ---- quality: High / Medium / Low are fixed; Auto adapts to the frame time (src/render/adaptive.ts) ----
let quality: Quality = 'auto';
function applyTier(t: Tier) {
  rig.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5) * t.pixelRatio);
  post.apply({ ...POST_PRESETS.high, ao: t.ao, aoSamples: t.aoSamples });
  lake.enabled = t.lake; // without it the water shows the sky color
  if (rig.sun.shadow.mapSize.x !== t.shadow) { allocShadowMap(rig.sun, t.shadow); rig.renderer.shadowMap.needsUpdate = true; }
  rig.resize();
}
const FIXED: Record<Exclude<Quality, 'auto'>, Tier> = {
  high: { label: 'high', pixelRatio: 1, ao: true, aoSamples: 16, lake: true, shadow: 4096 },
  medium: { label: 'medium', pixelRatio: 0.85, ao: true, aoSamples: 8, lake: true, shadow: 2048 },
  low: { label: 'low', pixelRatio: 0.75, ao: false, aoSamples: 8, lake: false, shadow: 1024 },
};
const adaptive = new AdaptiveQuality((t) => { if (quality === 'auto') applyTier(t); });
function setQuality(q: Quality) {
  quality = q;
  if (q === 'auto') { adaptive.reset(); applyTier(TIERS[0]); }
  else applyTier(FIXED[q]);
  if (q === 'low') post.apply(POST_PRESETS.low); // Low also drops bloom
  dock.setQuality(q);
}
// a new window size changes the cost of every pixel: Auto starts again from the top
addEventListener('resize', () => { if (quality === 'auto') adaptive.reset(); });

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

let probeTimer = 0, doorShadowT = 0, doorSettle = false;
/** One simulation + presentation step. Shared by the render loop and the test driver. */
function step(dt: number) {
  input.update();
  if (director.mode === 'tour' && input.moving) director.pause();
  const look = input.consumeLook();
  director.update(dt, input.move, look);
  // the bookcase door's shadow: while it swings, the 4096² shadow map refreshes 5 times a second
  // (not every frame), and once more when it comes to rest
  let moving = false;
  for (let i = 0; i < built.ctx.dynamic.length; i++) {
    const d = built.ctx.dynamic[i], before = d.blocker.rot;
    d.update(player.x, player.z, player.feet, dt);
    if (Math.abs(d.blocker.rot - before) > 1e-4) moving = true;
  }
  doorShadowT -= dt;
  if (moving && doorShadowT <= 0) { doorShadowT = 0.2; rig.renderer.shadowMap.needsUpdate = true; doorSettle = true; }
  else if (!moving && doorSettle) { doorSettle = false; rig.renderer.shadowMap.needsUpdate = true; }
  culler.update(player.x, player.z, player.feet);
  furniture.update(dt);
  if (furniture.shadowsDirty) { furniture.shadowsDirty = false; rig.renderer.shadowMap.needsUpdate = true; }
  director.apply(rig.camera);
  trees.lod.update(rig.camera.position.x, rig.camera.position.z, false, dt);
  furniture.updateLod(rig.camera.position);
  time.tick(dt, culler.inside);
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
  const raw = timer.getDelta(), dt = Math.min(0.05, raw);
  if (quality === 'auto') adaptive.sample(raw * 1000);
  step(dt);
  labels.update(rig.camera, player.feet, dt);
  measure.update(rig.camera);
  if (perf) rig.renderer.info.reset(); // perf: count the whole frame (mirror pass + scene + AO + post)
  post.render(dt);
  if (perf) perfFrame(raw * 1000);
  frameMs = frameMs * 0.95 + dt * 1000 * 0.05;
  fpsT += dt;
  if (fpsT > 0.5) { fpsT = 0; fpsEl.textContent = `${(1000 / frameMs).toFixed(0)} fps` + (quality === 'auto' && adaptive.tier ? ` · ${adaptive.label}` : ''); }
}

// ---- boot: everything compiled and the first frame rendered behind the loader, then a 600 ms fade ----
setQuality('auto');
time.set(17.75);
dock.setTour(true);
step(0);
time.tick(0, culler.inside, true);
interior.update(rig.camera.position, player.feet, culler.inside, 0, true);
post.exposure.exposure = time.exposure;
rig.renderer.shadowMap.needsUpdate = true;
rig.resize();
const loader = document.getElementById('loader')!, loaderBar = document.getElementById('loaderBar') as HTMLElement;
loaderBar.style.width = '70%';
document.getElementById('loaderMsg')!.textContent = 'Lighting the rooms…';
let firstViewMs = 0;
/**
 * The loader stays up until the baked lighting is in (normally well under a second after the house
 * is built; at most 15 s on a slow connection), so the first view is the finished lighting with no
 * pop and no shader hitch a moment later. Shaders compile in parallel where the driver allows it
 * (KHR_parallel_shader_compile), including the see-through variants the Furnished fade uses.
 */
const booted = (async () => {
  let late = false;
  await Promise.race([lightmapsLoaded, new Promise<void>((r) => setTimeout(() => { late = true; r(); }, 15_000))]);
  if (late) console.warn('Baked GI is late: showing real-time lighting first');
  updateProbe(true);
  await rig.renderer.compileAsync(rig.scene, rig.camera);
  for (const m of LOOSE_MATERIALS) m.transparent = true;
  await rig.renderer.compileAsync(rig.scene, rig.camera);
  for (const m of LOOSE_MATERIALS) m.transparent = false;
  post.render(0);
  loaderBar.style.width = '100%';
  requestAnimationFrame(() => { loader.style.opacity = '0'; setTimeout(() => loader.remove(), 650); });
  firstViewMs = performance.now(); // since navigation start: the first frame is up behind the fade
  console.info(`First view at ${(firstViewMs / 1000).toFixed(2)} s`);
})();

// ---- perf mode: the tour, in real time, once per quality ----
let perf: PerfRecorder | null = null, perfQ = 0, perfWait = 0;
const perfPasses: PassStats[] = [];
function perfFrame(ms: number) {
  if (perfWait > 0) { perfWait -= ms; if (perfWait <= 0) { director.restart(); perf!.begin(); } return; } // settle after a switch, then the tour from its first stop
  perf!.frame(ms, rig.renderer.info, post.sceneCalls, culler.inside, tour.dwellStop);
  if (director.mode === 'tour') return;
  perfPasses.push(perf!.end(PERF![perfQ]));
  if (++perfQ < PERF!.length) { setQuality(PERF![perfQ]); perfWait = 1500; return; }
  const report = {
    userAgent: navigator.userAgent, gpu: gpuName(rig.renderer.getContext() as WebGL2RenderingContext),
    viewport: `${innerWidth}×${innerHeight}`, pixelRatio: devicePixelRatio, firstViewMs: Math.round(firstViewMs),
    downloadMB: downloadMB(), gpuMemoryMB: Math.max(perf!.gpuPeakMB, Math.round(gpuMemory.total / 1048576)), passes: perfPasses,
  };
  perf = null; rig.renderer.info.autoReset = true;
  (window as unknown as { __perfReport: unknown }).__perfReport = report;
  console.info('Perf report: ' + JSON.stringify(report));
  showReport(report);
}
if (PERF) void booted.then(() => {
  perf = new PerfRecorder(house.tourStops, () => whereAt(built.plan, player.x, player.z, player.feet).name);
  tour.mult = +(params.get('perfSpeed') ?? 1) || 1; // smoke tests run the tour fast; real runs at 1×
  rig.renderer.info.autoReset = false;
  setQuality(PERF[0]); perfWait = 2000;
});

/** Renders one fully settled frame (tests): env map, shadows, lights and exposure all up to date. */
function renderSettled() {
  time.tick(0, culler.inside, true);
  updateProbe(true);
  interior.update(rig.camera.position, player.feet, culler.inside, 0, true);
  post.exposure.exposure = time.exposure;
  rig.renderer.shadowMap.needsUpdate = true;
  post.render(0);
}
// downloaded furniture models (if any) replace their stand-ins as they arrive
void loadModels(furniture).then((n) => { if (n) console.info(`Furniture: ${n} downloaded models in place of their stand-ins`); });
if (TEST) void booted.then(() => installTestApi({ rig, built, furniture, lake, lightmaps, probes, setBaked, adaptive, trees, setQuality, player, culler, director, tour, time, caption, labels, measure, step, post, interior, renderSettled, squareFootage: sf }));
else void booted.then(() => rig.renderer.setAnimationLoop(frame));
