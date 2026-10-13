import * as THREE from 'three';
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
    d.post.setSize(w, h);
  };
  const state = () => {
    const L = levelOfFeet(player.feet);
    const room = built.plan.roomAt(L, player.x, player.z);
    return { x: player.x, z: player.z, feet: player.feet, yaw: player.yaw, level: L, room: room?.id ?? null };
  };
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
