import type * as THREE from 'three';
import { gpuMemory } from './gpumem';

/**
 * Perf mode (Stage 6): open the app with `?perf` (or run `pnpm perf`) and it plays the guided tour
 * in real time, once per quality level (High, then Medium), recording every frame:
 *   - frame time (the interval between frames, as the viewer feels it): average, p95, p99, worst;
 *   - draw calls of the main scene pass (the budget figure) and of the whole frame (mirror pass,
 *     scene, AO and post together), and triangles: the highest at each tour stop and inside / outside;
 *   - GPU memory allocated, the download size, and the time to the first view.
 * At the end the report is shown on screen and published as window.__perfReport.
 *
 * Recording is allocation-free: preallocated typed arrays, no per-frame objects.
 */
export interface StopStats { stop: number; label: string; inside: boolean; sceneCalls: number; calls: number; tris: number; avgMs: number }
export interface PassStats {
  quality: string; frames: number; seconds: number;
  avgMs: number; p95Ms: number; p99Ms: number; maxMs: number;
  maxSceneCallsInside: number; maxSceneCallsOutside: number; maxCallsInside: number; maxCallsOutside: number; maxTris: number;
  stops: StopStats[];
}
export interface PerfReport {
  userAgent: string; gpu: string; viewport: string; pixelRatio: number;
  firstViewMs: number; downloadMB: number; gpuMemoryMB: number;
  passes: PassStats[];
}

const MAX_FRAMES = 1 << 18;

export class PerfRecorder {
  private ms = new Float32Array(MAX_FRAMES);
  private n = 0;
  private stopCalls: Int32Array; private stopScene: Int32Array; private stopTris: Float64Array; private stopInside: Uint8Array;
  private stopMs: Float64Array; private stopFrames: Int32Array;
  private callsIn = 0; private callsOut = 0; private sceneIn = 0; private sceneOut = 0; private trisMax = 0; private seconds = 0;
  private gpuPeak = 0;

  private labels: string[] = [];
  /** `where(i)` names a stop (the room it shows), asked once, the first time the tour dwells there. */
  constructor(private stops: { label?: string }[], private where: (i: number) => string = () => '') {
    const k = stops.length;
    this.stopCalls = new Int32Array(k); this.stopScene = new Int32Array(k); this.stopTris = new Float64Array(k); this.stopInside = new Uint8Array(k);
    this.stopMs = new Float64Array(k); this.stopFrames = new Int32Array(k);
  }

  begin() {
    this.n = 0; this.callsIn = 0; this.callsOut = 0; this.sceneIn = 0; this.sceneOut = 0; this.stopScene.fill(0); this.trisMax = 0; this.seconds = 0;
    this.stopCalls.fill(0); this.stopTris.fill(0); this.stopInside.fill(0); this.stopMs.fill(0); this.stopFrames.fill(0);
  }

  /** One rendered frame: its interval, the renderer's tallies for the whole frame, where we are. */
  frame(intervalMs: number, info: THREE.WebGLInfo, sceneCalls: number, inside: boolean, dwellStop: number) {
    if (this.n < MAX_FRAMES) this.ms[this.n++] = intervalMs;
    this.seconds += intervalMs / 1000;
    const calls = info.render.calls, tris = info.render.triangles;
    if (inside) { this.callsIn = Math.max(this.callsIn, calls); this.sceneIn = Math.max(this.sceneIn, sceneCalls); }
    else { this.callsOut = Math.max(this.callsOut, calls); this.sceneOut = Math.max(this.sceneOut, sceneCalls); }
    this.trisMax = Math.max(this.trisMax, tris);
    if (dwellStop >= 0) {
      const i = dwellStop;
      this.stopCalls[i] = Math.max(this.stopCalls[i], calls); this.stopScene[i] = Math.max(this.stopScene[i], sceneCalls); this.stopTris[i] = Math.max(this.stopTris[i], tris);
      if (!this.stopFrames[i]) this.labels[i] ??= this.stops[i].label ?? this.where(i);
      this.stopInside[i] = inside ? 1 : 0; this.stopMs[i] += intervalMs; this.stopFrames[i]++;
    }
    this.gpuPeak = Math.max(this.gpuPeak, gpuMemory.total);
  }

  end(quality: string): PassStats {
    // the first frames after a quality switch reallocate buffers: they are not representative
    const skip = Math.min(10, this.n);
    const sorted = Array.from(this.ms.subarray(skip, this.n)).sort((a, b) => a - b);
    const q = (p: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0;
    const avg = sorted.reduce((s, v) => s + v, 0) / Math.max(1, sorted.length);
    const r1 = (v: number) => Math.round(v * 10) / 10;
    return {
      quality, frames: this.n, seconds: Math.round(this.seconds),
      avgMs: r1(avg), p95Ms: r1(q(0.95)), p99Ms: r1(q(0.99)), maxMs: r1(sorted[sorted.length - 1] ?? 0),
      maxSceneCallsInside: this.sceneIn, maxSceneCallsOutside: this.sceneOut, maxCallsInside: this.callsIn, maxCallsOutside: this.callsOut, maxTris: this.trisMax,
      // the stops the tour dwells at (the in-between path points have no frames of their own)
      stops: this.stops.flatMap((s, i) => (this.stopFrames[i] ? [{
        stop: i + 1, label: this.labels[i] ?? s.label ?? `Stop ${i + 1}`, inside: !!this.stopInside[i],
        sceneCalls: this.stopScene[i], calls: this.stopCalls[i], tris: this.stopTris[i], avgMs: r1(this.stopMs[i] / this.stopFrames[i]),
      }] : [])),
    };
  }

  get gpuPeakMB() { return Math.round(this.gpuPeak / 1048576); }
}

/** Download size: every resource this page fetched (transfer size where the server reports it). */
export function downloadMB(): number {
  let b = 0;
  for (const e of performance.getEntriesByType('navigation') as PerformanceResourceTiming[]) b += e.transferSize || e.encodedBodySize || 0;
  for (const e of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) b += e.transferSize || e.encodedBodySize || 0;
  return Math.round(b / 1048576 * 10) / 10;
}

export function gpuName(gl: WebGL2RenderingContext): string {
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
}

/** The on-screen report at the end of a perf run. */
export function showReport(r: PerfReport) {
  const el = document.createElement('div');
  el.id = 'perfReport';
  el.style.cssText = 'position:fixed;inset:24px;overflow:auto;z-index:50;background:rgba(18,20,22,.92);color:#eee;font:13px/1.45 Inter,system-ui,sans-serif;padding:20px 24px;border-radius:12px';
  const row = (c: (string | number)[], th = false) => `<tr>${c.map((v) => `<${th ? 'th' : 'td'} style="padding:2px 10px;text-align:left">${v}</${th ? 'th' : 'td'}>`).join('')}</tr>`;
  let h = `<h2 style="margin:0 0 6px">Perf report</h2><div>${r.gpu} · ${r.viewport} @ ${r.pixelRatio}× · first view ${(r.firstViewMs / 1000).toFixed(1)} s · download ${r.downloadMB} MB · GPU memory ${r.gpuMemoryMB} MB</div>`;
  for (const p of r.passes) {
    h += `<h3 style="margin:14px 0 4px">${p.quality}: avg ${p.avgMs} ms · p95 ${p.p95Ms} · p99 ${p.p99Ms} · worst ${p.maxMs} (${p.frames} frames, ${p.seconds} s)</h3>`;
    h += `<div>max scene draw calls inside ${p.maxSceneCallsInside} · outside ${p.maxSceneCallsOutside} (whole frame ${p.maxCallsInside} / ${p.maxCallsOutside}) · max triangles ${p.maxTris.toLocaleString()}</div>`;
    h += `<table style="border-collapse:collapse;margin-top:4px">${row(['#', 'stop', 'where', 'scene calls', 'frame calls', 'triangles', 'avg ms'], true)}${p.stops.map((s) => row([s.stop, s.label, s.inside ? 'inside' : 'outside', s.sceneCalls, s.calls, s.tris.toLocaleString(), s.avgMs])).join('')}</table>`;
  }
  const b = document.createElement('button');
  b.textContent = 'Download JSON';
  b.style.cssText = 'margin-top:14px;padding:6px 12px';
  b.onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' })); a.download = 'perf-report.json'; a.click(); };
  el.innerHTML = h; el.append(b);
  document.body.append(el);
}
