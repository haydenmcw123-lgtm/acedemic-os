import * as THREE from 'three';
import type { Furniture } from './furniture/furnish';
import type { Lake } from './render/lake';
import type { Lightmaps } from './lighting/lightmaps';
import type { Probes } from './lighting/probes';
import type { BuiltHouse } from './build/house';
import { levelOfFeet } from './data/house';
import { PLAYER, type MoveInput, type PlayerController } from './player/controller';
import type { Director } from './player/director';
import type { Tour } from './player/tour';
import type { TimeOfDay } from './lighting/timeofday';
import type { Caption } from './ui/caption';
import type { RoomLabels } from './ui/labels';
import type { Measure } from './ui/measure';
import { whereAt } from './ui/where';
import type { LevelCuller } from './render/culling';
import type { Post, ToneMap } from './render/post';
import type { InteriorLights } from './lighting/interior';
import { renderLevelAerial, renderPlan, windowFromViewBox } from './render/planview';
import type { RenderRig } from './render/renderer';

interface Deps {
  rig: RenderRig;
  built: BuiltHouse;
  furniture: Furniture;
  lake: Lake;
  lightmaps: Lightmaps;
  probes: Probes;
  setBaked: (on: boolean) => void;
  player: PlayerController;
  culler: LevelCuller;
  director: Director;
  tour: Tour;
  time: TimeOfDay;
  caption: Caption;
  labels: RoomLabels;
  measure: Measure;
  step: (dt: number) => void;
  post: Post;
  interior: InteriorLights;
  renderSettled: () => void;
  squareFootage: { byLevel: number[]; heated: number; garage: number };
}

/**
 * window.__app: a deterministic driver for Playwright. Headless Chromium has no GPU, so tests
 * step the simulation with a fixed timestep instead of letting the render loop run.
 */
export function installTestApi(d: Deps) {
  const { rig, built, player } = d;
  const setSize = (w: number, h: number) => {
    rig.renderer.setPixelRatio(1);
    rig.renderer.setSize(w, h, false); rig.camera.aspect = w / h; rig.camera.updateProjectionMatrix();
    d.post.setSize(w, h); d.lake.setSize(w, h);
  };
  const state = () => {
    const L = levelOfFeet(player.feet);
    const room = built.plan.roomAt(L, player.x, player.z);
    return { x: player.x, z: player.z, feet: player.feet, yaw: player.yaw, level: L, room: room?.id ?? null };
  };
  let filmLast: number[] | null = null;
  let filmCanvas: HTMLCanvasElement | null = null;
  const api = {
    ready: true,
    sqft: d.squareFootage,
    stats: built.stats,
    stair: built.stair,
    wallPieces: built.ctx.wallPieces,
    radius: PLAYER.radius,
    state,
    teleport(x: number, z: number, feet?: number, yaw?: number) {
      player.teleport(x, z, feet);
      if (yaw !== undefined) player.yaw = yaw;
      return state();
    },
    /** Walk with a held input for `seconds` at a fixed 1/60 s step; returns the path and overlap count. */
    walk(input: Partial<MoveInput>, seconds: number, yaw?: number) {
      if (yaw !== undefined) player.yaw = yaw;
      const mv: MoveInput = { forward: 0, right: 0, sprint: false, ...input };
      const dt = 1 / 60, n = Math.round(seconds / dt);
      let overlaps = 0, minFeet = Infinity, maxFeet = -Infinity;
      const rooms = new Set<string>();
      for (let i = 0; i < n; i++) {
        player.step(dt, mv);
        for (const p of built.ctx.dynamic) p.update(player.x, player.z, player.feet, dt);
        if (player.overlaps(player.x, player.z, player.feet, PLAYER.radius - 0.02)) overlaps++;
        minFeet = Math.min(minFeet, player.feet); maxFeet = Math.max(maxFeet, player.feet);
        const s = state(); if (s.room) rooms.add(s.room);
      }
      return { ...state(), overlaps, minFeet, maxFeet, rooms: [...rooms] };
    },
    /** Walks toward a plan point (turning to face it each step) until within `tol` or out of time. */
    walkTo(x: number, z: number, seconds = 30, tol = 0.6) {
      const dt = 1 / 60;
      let overlaps = 0, t = 0;
      while (t < seconds) {
        const dx = x - player.x, dz = z - player.z;
        if (Math.hypot(dx, dz) < tol) break;
        player.yaw = Math.atan2(-dx, -dz);
        player.step(dt, { forward: 1, right: 0, sprint: false });
        for (const p of built.ctx.dynamic) p.update(player.x, player.z, player.feet, dt);
        if (player.overlaps(player.x, player.z, player.feet, PLAYER.radius - 0.02)) overlaps++;
        t += dt;
      }
      return { ...state(), overlaps, seconds: t, reached: Math.hypot(x - player.x, z - player.z) < tol };
    },
    overlaps: (x: number, z: number, feet: number, r?: number) => player.overlaps(x, z, feet, r),
    blockers: () => built.ctx.dynamic.map((p) => p.blocker),
    groundAt: (x: number, z: number, from: number) => player.groundAt(x, z, from, 400),
    renderPlan: (level: number, viewBox?: [number, number, number, number], pocheColor?: number) =>
      renderPlan(built, rig, level, { win: viewBox ? windowFromViewBox(...viewBox) : undefined, pocheColor }),
    renderAerial: (level: number) => renderLevelAerial(built, rig, level),
    renderView(x: number, z: number, feet: number, yaw: number, pitch = 0, w = 1280, h = 800) {
      player.teleport(x, z, feet); player.yaw = yaw; player.pitch = pitch;
      for (const p of built.ctx.dynamic) for (let i = 0; i < 60; i++) p.update(player.x, player.z, player.feet, 1 / 30);
      d.culler.update(player.x, player.z, player.feet);
      setSize(w, h);
      player.applyCamera(rig.camera);
      d.renderSettled();
      return rig.renderer.domElement.toDataURL('image/png');
    },
    /**
     * Runs the whole guided tour with a fixed timestep (no rendering) and reports what it visited,
     * every capsule overlap with walls/rails/glass, the duration, and the biggest per-step camera jump.
     */
    simTour(dt = 1 / 30, maxSeconds = 1200) {
      const { director, tour } = d;
      director.restart();
      let t = 0, overlapSteps = 0, maxJump = 0, maxYawStep = 0;
      const hits: string[] = [], visits: string[] = [];
      let last = '', prev = director.cameraPose();
      while (director.mode === 'tour' && t < maxSeconds) {
        d.step(dt); t += dt;
        const w = whereAt(built.plan, player.x, player.z, player.feet);
        if (w.key !== last) { visits.push(w.key); last = w.key; }
        if (player.overlaps(player.x, player.z, player.feet, PLAYER.radius - 0.02)) {
          overlapSteps++;
          // cluster by 2-ft cell so each trouble spot is reported once
          const k = `${Math.round(player.x / 2) * 2},${Math.round(player.z / 2) * 2},${Math.round(player.feet)} @${tour.s.toFixed(0)}ft`;
          if (!hits.some((h) => h.split(' @')[0] === k.split(' @')[0])) hits.push(k);
        }
        const c = director.cameraPose();
        maxJump = Math.max(maxJump, Math.hypot(c.x - prev.x, c.z - prev.z, c.feet - prev.feet));
        maxYawStep = Math.max(maxYawStep, Math.abs(Math.atan2(Math.sin(c.yaw - prev.yaw), Math.cos(c.yaw - prev.yaw))));
        prev = c;
      }
      return { seconds: t, done: tour.done, length: tour.total, overlapSteps, hits, visits, maxJump, maxYawStep, captions: [...d.caption.log] };
    },
    /** Runs the tour until it is dwelling at the stop at (x, z), then `extra` seconds more. */
    runToStop(x: number, z: number, extra = 1, dt = 1 / 30) {
      d.director.restart();
      const i = d.tour.stops.findIndex((s) => Math.abs(s.x - x) < 1e-6 && Math.abs(s.z - z) < 1e-6);
      if (i < 0) throw new Error(`no tour stop at ${x}, ${z}`);
      for (let t = 0; t < 1200 && !(d.tour.dwellStop === i); t += dt) d.step(dt);
      for (let t = 0; t < extra; t += dt) d.step(dt);
      return { ...d.director.cameraPose(), dwellStop: d.tour.dwellStop };
    },
    /** Keeps the room caption on screen (headless renders take longer than its 2.5 s hold). */
    holdCaption() { d.caption.holdMs = 1e9; },
    tourPose: () => ({ mode: d.director.mode, s: d.tour.s, ...d.director.cameraPose(), feet: player.feet }),
    pauseTour: () => d.director.pause(),
    resumeTour: () => d.director.resume(),
    restartTour: () => d.director.restart(),
    /** Steps the app (tour or walk) for `seconds` and returns the largest per-step camera move. */
    run(seconds: number, dt = 1 / 30) {
      let prev = d.director.cameraPose(), maxJump = 0;
      for (let t = 0; t < seconds; t += dt) {
        d.step(dt);
        const c = d.director.cameraPose();
        maxJump = Math.max(maxJump, Math.hypot(c.x - prev.x, c.z - prev.z, c.feet - prev.feet));
        prev = c;
      }
      return { maxJump, ...d.director.cameraPose(), mode: d.director.mode };
    },
    setTime: (h: number) => { d.time.set(h); return d.time.sun; },
    labelsShown(x: number, z: number, feet: number, yaw: number) {
      d.director.pause(); player.teleport(x, z, feet); player.yaw = yaw; player.pitch = 0;
      d.step(0);
      if (!d.labels.on) d.labels.toggle();
      d.labels.update(rig.camera, player.feet, 1);
      return d.labels.shown();
    },
    measureBetween(a: [number, number], b: [number, number]) {
      if (!d.measure.on) d.measure.toggle();
      d.measure.click(rig.camera, a[0], a[1]); d.measure.click(rig.camera, b[0], b[1]);
      const m = d.measure.last;
      return m ? { ft: m.ft, text: m.text, a: m.a.toArray(), b: m.b.toArray() } : null;
    },
    /** Renders the current camera view (for screenshots of the UI-free scene). */
    shot(w = 1280, h = 800) {
      setSize(w, h);
      d.labels.update(rig.camera, player.feet, 1);
      d.measure.update(rig.camera);
      d.renderSettled();
      return rig.renderer.domElement.toDataURL('image/png');
    },
    setToneMap: (t: ToneMap) => d.post.setToneMap(t),
    /** 0 = normal, 1 = AO only, 2 = no AO (debug views). */
    aoMode: (m: number) => { d.post.ao.configuration.renderMode = m === 2 ? 0 : m; d.post.ao.enabled = m !== 2; },
    lightCounts: () => d.interior.counts,
    post: () => d.post,
    /**
     * Renders a fixed view at a given clock time and returns the image plus a health check:
     * pure-black pixels (NaN / bloom black squares), clipped pixels (blown highlights), mean luminance.
     */
    photo(x: number, z: number, feet: number, yaw: number, pitch: number, hour: number, w = 1280, h = 720) {
      d.director.pause();
      player.teleport(x, z, feet); player.yaw = yaw; player.pitch = pitch;
      for (const p of built.ctx.dynamic) for (let i = 0; i < 60; i++) p.update(player.x, player.z, player.feet, 1 / 30);
      d.culler.update(player.x, player.z, player.feet);
      d.time.set(hour);
      setSize(w, h);
      player.applyCamera(rig.camera);
      d.renderSettled();
      const gl = rig.renderer.getContext();
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let black = 0, clipped = 0, lum = 0;
      for (let i = 0; i < px.length; i += 4) {
        const r = px[i], g = px[i + 1], b = px[i + 2];
        if (r + g + b === 0) black++; // true black only: NaN / bloom black squares
        if (r >= 252 && g >= 252 && b >= 252) clipped++;
        lum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      }
      const n = w * h;
      const url = rig.renderer.domElement.toDataURL('image/png');
      // the root cause of bloom "black squares" is Inf/NaN in the HDR scene buffer: count them exactly
      const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType });
      rig.renderer.setRenderTarget(rt);
      // the same pass also counts the scene's draw calls (post-processing passes not included)
      rig.renderer.info.autoReset = false; rig.renderer.info.reset();
      rig.renderer.render(rig.scene, rig.camera);
      const calls = rig.renderer.info.render.calls, tris = rig.renderer.info.render.triangles;
      rig.renderer.info.autoReset = true;
      const hdr = new Uint16Array(w * h * 4);
      rig.renderer.readRenderTargetPixels(rt, 0, 0, w, h, hdr);
      rig.renderer.setRenderTarget(null);
      rt.dispose();
      let nanInf = 0;
      for (let i = 0; i < hdr.length; i += 4) if ((hdr[i] & 0x7c00) === 0x7c00 || (hdr[i + 1] & 0x7c00) === 0x7c00 || (hdr[i + 2] & 0x7c00) === 0x7c00) nanInf++;
      return { url, black: black / n, clipped: clipped / n, nanInf, meanLum: lum / n / 255, exposure: d.time.exposure, sunEl: d.time.sun.elevation, calls, tris };
    },
    /**
     * Video recording (tests/record.spec.ts): measures the tour's length with a fixed-step dry run,
     * restarts it, sets the clock and frame size, and hides the controls (the room captions stay).
     */
    filmBegin(w: number, h: number, hour: number) {
      const dry = api.simTour(1 / 30);
      d.time.set(hour);
      setSize(w, h);
      for (const sel of ['.dock', '#chip', '#hkey', '#cross', '#labels', '#loader']) document.querySelectorAll<HTMLElement>(sel).forEach((e) => (e.style.display = 'none'));
      d.caption.film = true;
      d.director.restart();
      filmLast = null;
      d.renderSettled();
      return { seconds: dry.seconds as number };
    },
    /** Advances the simulation k fixed steps without rendering (resuming an interrupted recording). */
    filmSkip(k: number, dt: number) { for (let i = 0; i < k; i++) d.step(dt); filmLast = null; },
    /**
     * One video frame: a fixed simulation step, then the full post-processed render with the room
     * caption drawn on top, returned as a JPEG. When nothing on screen changed (the camera resting
     * at a stop) it returns { same: true } and the recorder repeats the previous frame instead.
     */
    filmFrame(dt: number) {
      d.step(dt);
      const hud = document.getElementById('hud')!;
      const key = [...rig.camera.matrixWorld.elements, d.time.exposure, +(hud.style.opacity || 0)];
      const changed = !filmLast || rig.renderer.shadowMap.needsUpdate || key.some((v, i) => Math.abs(v - filmLast![i]) > 1e-5);
      if (!changed) return { same: true };
      filmLast = key;
      d.post.render(dt);
      const gl = rig.renderer.domElement;
      filmCanvas ??= document.createElement('canvas');
      filmCanvas.width = gl.width; filmCanvas.height = gl.height;
      const g = filmCanvas.getContext('2d')!;
      g.drawImage(gl, 0, 0);
      const alpha = +(hud.style.opacity || 0);
      if (alpha > 0.001) {
        // the caption, drawn from the live DOM's own text, fonts and layout
        g.save();
        g.globalAlpha = alpha;
        g.shadowColor = 'rgba(0,0,0,0.5)'; g.shadowBlur = 16; g.shadowOffsetY = 1;
        g.textBaseline = 'middle';
        for (const el of Array.from(hud.children) as HTMLElement[]) {
          const cs = getComputedStyle(el), r = el.getBoundingClientRect();
          g.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
          (g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing;
          g.fillStyle = cs.color;
          const text = cs.textTransform === 'uppercase' ? (el.textContent ?? '').toUpperCase() : el.textContent ?? '';
          g.fillText(text, r.left, r.top + r.height / 2);
        }
        g.restore();
      }
      return { same: false, url: filmCanvas.toDataURL('image/jpeg', 0.93) };
    },
    /** Every placed item (world footprint, size, flags) plus the fit report. */
    furnitureInfo() {
      const f = d.furniture;
      return {
        stats: f.stats(), report: f.report,
        items: f.items.map((it) => ({ id: it.id, name: it.name, room: it.room, level: it.level, builtIn: it.builtIn, x: it.x, z: it.z, y: it.y, rot: it.rot, size: it.size, staging: it.staging, stretch: it.stretch, collides: !!it.blocker, roles: { ...it.roles } })),
      };
    },
    /**
     * Runs the tour (fixed step) and lists every furniture item whose collider comes within
     * `clear` ft of the 1-ft capsule's center path (the clearance rule: nothing across a tour path).
     */
    tourFurnitureConflicts(clear = PLAYER.radius, dt = 1 / 30) {
      const f = d.furniture, out = new Map<number, { id: number; name: string; room: string; s: number; gap: number; at: [number, number] }>();
      d.director.restart();
      for (let t = 0; t < 1200 && d.director.mode === 'tour'; t += dt) {
        d.step(dt);
        for (const it of f.items) {
          const b = it.blocker;
          if (!b || b.y1 < player.feet + PLAYER.stepUp || b.y0 > player.feet + PLAYER.height) continue;
          const c = Math.cos(b.rot), sn = Math.sin(b.rot), wx = player.x - b.cx, wz = player.z - b.cz;
          const lx = wx * c - wz * sn, lz = wx * sn + wz * c;
          const gap = Math.hypot(Math.max(0, Math.abs(lx) - b.hw), Math.max(0, Math.abs(lz) - b.hd));
          if (gap < clear) {
            const prev = out.get(it.id);
            if (!prev || gap < prev.gap) out.set(it.id, { id: it.id, name: it.name, room: it.room, s: +d.tour.s.toFixed(1), gap: +gap.toFixed(2), at: [+player.x.toFixed(1), +player.z.toFixed(1)] });
          }
        }
      }
      return [...out.values()];
    },
    /**
     * The staging clearance rules, measured on the placed furniture:
     *  - every doorway keeps a clear path min(3 ft, door width) wide, 3 ft deep on both sides;
     *  - no furniture box intersects a wall (0.06 ft tolerance for pieces mounted flush);
     *  - art hangs within 0.2 ft of a solid wall and never over an opening.
     * Returns the problems found (empty = pass) plus counts of what was checked.
     */
    clearance() {
      const f = d.furniture, data = built.ctx.data, problems: string[] = [];
      const DOORS = new Set(['door', 'gdoor', 'front', 'fold', 'glassdoor', 'slide', 'bookcase', 'open']);
      // oriented footprint corners of an item, shrunk by `s`
      const corners = (it: (typeof f.items)[number], sh = 0) => {
        const c = Math.cos(it.rot), sn = Math.sin(it.rot), hw = it.size[0] / 2 - sh, hd = it.size[2] / 2 - sh;
        return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([lx, lz]) => [it.x + lx * c + lz * sn, it.z - lx * sn + lz * c] as [number, number]);
      };
      // separating-axis test between a convex quad and an axis-aligned rectangle
      const quadHitsRect = (q: [number, number][], x0: number, z0: number, x1: number, z1: number) => {
        const rect: [number, number][] = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
        for (const poly of [q, rect]) for (let i = 0; i < 4; i++) {
          const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % 4], nx = bz - az, nz = ax - bx;
          let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
          for (const [x, z] of q) { const v = x * nx + z * nz; amin = Math.min(amin, v); amax = Math.max(amax, v); }
          for (const [x, z] of rect) { const v = x * nx + z * nz; bmin = Math.min(bmin, v); bmax = Math.max(bmax, v); }
          if (amax <= bmin + 1e-6 || bmax <= amin + 1e-6) return false;
        }
        return true;
      };
      const floorOf = (it: (typeof f.items)[number]) => (it.level < 0 ? it.y : [0, 11, 22][it.level]);
      const standing = f.items.filter((it) => it.size[1] >= 0.5 && it.y - floorOf(it) < 1.5); // not rugs, not wall-mounted
      // 1) doorways: a 3-ft-wide path (narrower doors: their full width), 3 ft deep on both sides.
      //    On a wide slider or garage door, any 3-ft window across the opening counts.
      let doors = 0;
      for (const o of data.openings) {
        if (!DOORS.has(o.kind)) continue;
        doors++;
        const fy = [0, 11, 22][o.level], half = Math.min(1.5, (o.to - o.from) / 2);
        const blockers = standing.filter((it) => !(it.y > fy + 6.5 || it.y + it.size[1] < fy + 0.1));
        let clear = false, firstBlock: string[] = [];
        for (let mid = o.from + half; mid <= o.to - half + 1e-6 && !clear; mid += 0.25) {
          const [x0, z0, x1, z1] = o.axis === 'x' ? [o.at - 3, mid - half, o.at + 3, mid + half] : [mid - half, o.at - 3, mid + half, o.at + 3];
          const hit = blockers.filter((it) => quadHitsRect(corners(it, 0.02), x0, z0, x1, z1));
          if (!hit.length) clear = true; else if (!firstBlock.length) firstBlock = hit.map((it) => `${it.name} (${it.room})`);
        }
        if (!clear) problems.push(`doorway: ${firstBlock.join(', ')} block${firstBlock.length > 1 ? '' : 's'} the ${o.kind} at ${o.axis}=${o.at} [${o.from}–${o.to}], level ${o.level}`);
      }
      // 2) walls (with the push that would clear each piece, used to fix the data)
      const fixes: { id: number; name: string; room: string; x: number; z: number; dx: number; dz: number }[] = [];
      for (const it of f.items) {
        const q = corners(it, 0.06);
        for (const w of built.ctx.wallPieces) {
          if (w.y1 <= it.y + 0.05 || w.y0 >= it.y + it.size[1] - 0.05) continue;
          const [x0, z0, x1, z1] = w.axis === 'x' ? [w.at - 0.25, w.s, w.at + 0.25, w.e] : [w.s, w.at - 0.25, w.e, w.at + 0.25];
          if (!quadHitsRect(q, x0, z0, x1, z1)) continue;
          problems.push(`wall: ${it.name} (${it.room}) at ${it.x}, ${it.z} intersects the wall ${w.axis}=${w.at} [${w.s}–${w.e}]`);
          const full = corners(it), xs = full.map((p) => p[0]), zs = full.map((p) => p[1]);
          let dx = 0, dz = 0;
          if (w.axis === 'x') dx = it.x < w.at ? w.at - 0.26 - Math.max(...xs) : w.at + 0.26 - Math.min(...xs);
          else dz = it.z < w.at ? w.at - 0.26 - Math.max(...zs) : w.at + 0.26 - Math.min(...zs);
          fixes.push({ id: it.id, name: it.name, room: it.room, x: it.x, z: it.z, dx: +dx.toFixed(3), dz: +dz.toFixed(3) });
          break;
        }
      }
      // 3) art: back face flush (≤ 0.2 ft) on solid, opaque wall everywhere across its width
      const ray = new THREE.Ray(), dir = new THREE.Vector3();
      let art = 0;
      for (const it of f.items.filter((i) => i.name === 'Art')) {
        art++;
        const c = Math.cos(it.rot), sn = Math.sin(it.rot);
        dir.set(-sn, 0, -c); // the back of the frame (local -z)
        const hd = it.size[2] / 2;
        for (const u of [-0.45, 0, 0.45]) for (const v of [0.2, 0.5, 0.8]) {
          const lx = u * it.size[0];
          ray.origin.set(it.x + lx * c + hd * sn * 0 - dir.x * 0, it.y + v * it.size[1], it.z - lx * sn);
          ray.origin.addScaledVector(dir, hd - 0.01); // start just inside the back face
          ray.origin.addScaledVector(dir, -0.3); // …and step back so a slightly embedded frame still finds its wall
          ray.direction.copy(dir);
          const hit = built.bvh.raycastFirst(ray, THREE.DoubleSide);
          const gap = hit ? hit.distance - 0.3 : Infinity;
          if (!hit || gap > 0.2 || !built.opaque[hit.faceIndex!]) { problems.push(`art: ${it.name} (${it.room}) at ${it.x}, ${it.z}: ${hit ? (built.opaque[hit.faceIndex!] ? `${gap.toFixed(2)} ft off the wall` : 'over glass') : 'no wall behind it'} at u=${u}, v=${v}`); break; }
        }
      }
      return { problems, fixes, doors, art, items: f.items.length, walls: built.ctx.wallPieces.length };
    },
    /** Baked GI on/off (before/after) and its state. */
    bakedGI(on: boolean) { d.setBaked(on); },
    lightmapInfo: () => ({ ...d.lightmaps.info, probes: d.probes.probes.map((p) => ({ id: p.id, captured: !!p.tex, min: p.min.toArray(), max: p.max.toArray() })), activeProbe: d.probes.active?.id ?? null, captures: d.probes.captures }),
    setFurnished(on: boolean, animate = false) { d.furniture.setFurnished(on, animate); },
    furnitureState() {
      const f = d.furniture, loose = f.items.filter((i) => !i.builtIn), built = f.items.filter((i) => i.builtIn);
      return {
        furnished: f.furnished, fade: f.fadeLevel,
        looseVisible: f.looseMeshes.filter((m) => m.visible).length, looseMeshes: f.looseMeshes.length,
        looseBlockersOn: loose.filter((i) => i.blocker?.enabled).length, builtInBlockersOn: built.filter((i) => i.blocker?.enabled).length,
        opacity: (f.looseMeshes[0]?.material as THREE.Material | undefined)?.opacity ?? 1,
      };
    },
    /** Cycles an item's finish (staging) and returns the new label. */
    cycleItem(id: number) { return d.furniture.cycle(d.furniture.items[id]); },
    info() { return { calls: rig.renderer.info.render.calls, tris: rig.renderer.info.render.triangles }; },
    /** Runs level culling for the current position and reports which interior groups are drawn. */
    culling() {
      d.culler.update(player.x, player.z, player.feet);
      const vis: Record<string, boolean> = {};
      for (const [k, g] of built.groups) vis[k] = g.visible;
      return { level: d.culler.level, inside: d.culler.inside, visible: vis };
    },
  };
  (window as unknown as { __app: typeof api }).__app = api;
}
