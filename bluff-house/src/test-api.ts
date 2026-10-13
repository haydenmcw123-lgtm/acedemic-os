import type { BuiltHouse } from './build/house';
import { levelOfFeet } from './data/house';
import { PLAYER, type MoveInput, type PlayerController } from './player/controller';
import type { LevelCuller } from './render/culling';
import { renderLevelAerial, renderPlan, windowFromViewBox } from './render/planview';
import type { RenderRig } from './render/renderer';

interface Deps {
  rig: RenderRig;
  built: BuiltHouse;
  player: PlayerController;
  culler: LevelCuller;
  squareFootage: { byLevel: number[]; heated: number; garage: number };
}

/**
 * window.__app: a deterministic driver for Playwright. Headless Chromium has no GPU, so tests
 * step the simulation with a fixed timestep instead of letting the render loop run.
 */
export function installTestApi(d: Deps) {
  const { rig, built, player } = d;
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
    groundAt: (x: number, z: number, from: number) => player.groundAt(x, z, from, 400),
    renderPlan: (level: number, viewBox?: [number, number, number, number], pocheColor?: number) =>
      renderPlan(built, rig, level, { win: viewBox ? windowFromViewBox(...viewBox) : undefined, pocheColor }),
    renderAerial: (level: number) => renderLevelAerial(built, rig, level),
    renderView(x: number, z: number, feet: number, yaw: number, pitch = 0, w = 1280, h = 800) {
      player.teleport(x, z, feet); player.yaw = yaw; player.pitch = pitch;
      for (const p of built.ctx.dynamic) for (let i = 0; i < 60; i++) p.update(player.x, player.z, player.feet, 1 / 30);
      d.culler.update(player.x, player.z, player.feet);
      rig.renderer.setSize(w, h, false); rig.camera.aspect = w / h; rig.camera.updateProjectionMatrix();
      player.applyCamera(rig.camera);
      rig.renderer.shadowMap.needsUpdate = true;
      rig.renderer.render(rig.scene, rig.camera);
      return rig.renderer.domElement.toDataURL('image/png');
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
