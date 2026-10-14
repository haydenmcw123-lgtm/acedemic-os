/**
 * GPU memory counter (perf mode and tests). three.js only reports object *counts*; this wraps the
 * WebGL2 allocation calls — textures, buffers, renderbuffers — and keeps a running byte total, so
 * the report states what was actually allocated (driver padding aside). Installed before the
 * renderer is created; it only adds bookkeeping to calls that happen at load or resize.
 */
type GL = WebGL2RenderingContext;

const BPP: Record<number, number> = {};
function bpp(fmt: number): number {
  if (!BPP[0x8058]) {
    const g = WebGL2RenderingContext;
    Object.assign(BPP, {
      [g.RGBA8]: 4, [g.SRGB8_ALPHA8]: 4, [g.RGBA]: 4, [g.RGB8]: 4, [g.RGB]: 4, [g.SRGB8]: 4, [g.RGB10_A2]: 4,
      [g.R8]: 1, [g.RED]: 1, [g.LUMINANCE]: 1, [g.ALPHA]: 1, [g.RG8]: 2, [g.RG]: 2, [g.LUMINANCE_ALPHA]: 2,
      [g.R16F]: 2, [g.RG16F]: 4, [g.RGB16F]: 8, [g.RGBA16F]: 8, [g.R11F_G11F_B10F]: 4,
      [g.R32F]: 4, [g.RG32F]: 8, [g.RGB32F]: 16, [g.RGBA32F]: 16, [g.R32UI]: 4, [g.RGBA32UI]: 16,
      [g.DEPTH_COMPONENT16]: 2, [g.DEPTH_COMPONENT24]: 4, [g.DEPTH_COMPONENT32F]: 4, [g.DEPTH24_STENCIL8]: 4,
      [g.DEPTH32F_STENCIL8]: 8, [g.DEPTH_COMPONENT]: 4, [g.DEPTH_STENCIL]: 4, [g.STENCIL_INDEX8]: 1,
      // block-compressed formats (KTX2 transcodes to one of these): bytes per texel
      0x8e8c: 1, 0x8e8d: 1, 0x8e8e: 1, 0x8e8f: 1, // BC7 / BC6H (BPTC)
      0x83f0: 0.5, 0x83f1: 0.5, 0x83f2: 1, 0x83f3: 1, 0x8c4c: 0.5, 0x8c4d: 0.5, 0x8c4e: 1, 0x8c4f: 1, // BC1–3 (S3TC)
      0x8dbb: 0.5, 0x8dbc: 0.5, 0x8dbd: 1, 0x8dbe: 1, // BC4 / BC5 (RGTC)
      0x8d64: 0.5, 0x9274: 0.5, 0x9275: 0.5, 0x9276: 0.5, 0x9277: 0.5, 0x9278: 1, 0x9279: 1, // ETC1 / ETC2
      0x93b0: 1, 0x93d0: 1, // ASTC 4×4
    });
  }
  return BPP[fmt] ?? 4;
}

export const gpuMemory = {
  textures: 0, buffers: 0, renderbuffers: 0,
  get total() { return this.textures + this.buffers + this.renderbuffers; },
  /** Live texture allocations by shape, "w×h fmt levels" → count and bytes (the breakdown). */
  shapes: new Map<string, { count: number; bytes: number }>(),
};
const shape = (k: string, bytes: number, n = 1) => { const e = gpuMemory.shapes.get(k) ?? { count: 0, bytes: 0 }; e.count += n; e.bytes += bytes; if (e.count <= 0) gpuMemory.shapes.delete(k); else gpuMemory.shapes.set(k, e); };

export function installGpuMemoryCounter() {
  const P = WebGL2RenderingContext.prototype as GL & Record<string, unknown>;
  if ((P as { __gpuMem?: boolean }).__gpuMem) return;
  (P as { __gpuMem?: boolean }).__gpuMem = true;
  const tex = new WeakMap<WebGLTexture, { levels: Map<number, number>; mip: boolean; shape?: string; shapeBytes?: number }>();
  const buf = new WeakMap<WebGLBuffer, number>();
  const rb = new WeakMap<WebGLRenderbuffer, number>();
  const bound = new Map<number, WebGLTexture | null>(); // `${unit}:${target}` packed as unit * 65536 + target
  const boundBuf = new Map<number, WebGLBuffer | null>();
  let unit = 0, boundRb: WebGLRenderbuffer | null = null;
  const faceTarget = (t: number) => (t >= 0x8515 && t <= 0x851a ? 0x8513 : t); // cube faces → TEXTURE_CUBE_MAP
  const texOf = (t: number) => bound.get(unit * 65536 + faceTarget(t)) ?? null;
  const total = (e: { levels: Map<number, number>; mip: boolean }) => { let s = 0; for (const v of e.levels.values()) s += v; return e.mip ? s * 4 / 3 : s; };
  const setLevel = (t: WebGLTexture | null, key: number, bytes: number) => {
    if (!t) return;
    let e = tex.get(t);
    if (!e) { e = { levels: new Map(), mip: false }; tex.set(t, e); }
    const before = total(e);
    e.levels.set(key, bytes);
    gpuMemory.textures += total(e) - before;
  };
  const tag = (t: WebGLTexture | null, key: string, bytes: number) => {
    const e = t && tex.get(t); if (!e) return;
    if (e.shape) shape(e.shape, -(e.shapeBytes ?? 0), -1);
    e.shape = key; e.shapeBytes = bytes; shape(key, bytes);
  };
  const wrap = <K extends keyof GL>(name: K, after: (...a: any[]) => void) => {
    const orig = P[name] as unknown as (...a: unknown[]) => unknown;
    (P as Record<string, unknown>)[name as string] = function (this: GL, ...a: unknown[]) { const r = orig.apply(this, a); after.call(this, ...a); return r; };
  };
  wrap('activeTexture', (u: number) => { unit = u - 0x84c0; });
  wrap('bindTexture', (t: number, x: WebGLTexture | null) => { bound.set(unit * 65536 + t, x); });
  wrap('texStorage2D', (t: number, levels: number, fmt: number, w: number, h: number) => {
    const faces = t === 0x8513 ? 6 : 1;
    let s = 0; for (let l = 0; l < levels; l++) s += Math.max(1, w >> l) * Math.max(1, h >> l) * bpp(fmt);
    setLevel(texOf(t), -1, s * faces);
    tag(texOf(t), `${w}×${h} 0x${fmt.toString(16)} L${levels}${faces > 1 ? ' cube' : ''}`, s * faces);
  });
  wrap('texStorage3D', (t: number, levels: number, fmt: number, w: number, h: number, d: number) => {
    let s = 0; for (let l = 0; l < levels; l++) s += Math.max(1, w >> l) * Math.max(1, h >> l) * (t === 0x806f ? Math.max(1, d >> l) : d) * bpp(fmt);
    setLevel(texOf(t), -1, s);
    tag(texOf(t), `${w}×${h}×${d} 0x${fmt.toString(16)} L${levels} 3D`, s);
  });
  wrap('texImage2D', (t: number, level: number, fmt: number, a: unknown, b: unknown) => {
    let w: number, h: number;
    if (typeof a === 'number') { w = a; h = b as number; } else { const src = b as { width?: number; height?: number; videoWidth?: number; videoHeight?: number } | null; w = src?.videoWidth || src?.width || 0; h = src?.videoHeight || src?.height || 0; }
    setLevel(texOf(t), (t & 0xff) * 64 + level, w * h * bpp(fmt));
    if (level === 0 && t === 0xde1) tag(texOf(t), `${w}×${h} 0x${fmt.toString(16)}`, w * h * bpp(fmt));
    if (level === 0 && t === 0x8515) tag(texOf(t), `${w}×${h} 0x${fmt.toString(16)} cube`, w * h * bpp(fmt) * 6);
  });
  wrap('texImage3D', (t: number, level: number, fmt: number, w: number, h: number, d: number) => { setLevel(texOf(t), level, w * h * d * bpp(fmt)); });
  wrap('compressedTexImage2D', (t: number, level: number, _f: number, _w: number, _h: number, _b: number, data: ArrayBufferView) => { setLevel(texOf(t), (t & 0xff) * 64 + level, data?.byteLength ?? 0); });
  wrap('generateMipmap', (t: number) => {
    const x = texOf(t); const e = x && tex.get(x);
    if (e && !e.levels.has(-1) && !e.mip) { const before = total(e); e.mip = true; gpuMemory.textures += total(e) - before; }
  });
  wrap('deleteTexture', (x: WebGLTexture | null) => { const e = x && tex.get(x); if (e) { gpuMemory.textures -= total(e); if (e.shape) shape(e.shape, -(e.shapeBytes ?? 0), -1); tex.delete(x!); } });
  wrap('bindBuffer', (t: number, x: WebGLBuffer | null) => { boundBuf.set(t, x); });
  wrap('bufferData', (t: number, d: number | ArrayBufferView | ArrayBuffer | null) => {
    const x = boundBuf.get(t); if (!x) return;
    const bytes = typeof d === 'number' ? d : d?.byteLength ?? 0;
    gpuMemory.buffers += bytes - (buf.get(x) ?? 0); buf.set(x, bytes);
  });
  wrap('deleteBuffer', (x: WebGLBuffer | null) => { const b = x && buf.get(x); if (b) { gpuMemory.buffers -= b; buf.delete(x!); } });
  wrap('bindRenderbuffer', (_t: number, x: WebGLRenderbuffer | null) => { boundRb = x; });
  const rbStore = (samples: number, fmt: number, w: number, h: number) => {
    if (!boundRb) return;
    const bytes = w * h * bpp(fmt) * Math.max(1, samples);
    gpuMemory.renderbuffers += bytes - (rb.get(boundRb) ?? 0); rb.set(boundRb, bytes);
  };
  wrap('renderbufferStorage', (_t: number, fmt: number, w: number, h: number) => rbStore(1, fmt, w, h));
  wrap('renderbufferStorageMultisample', (_t: number, s: number, fmt: number, w: number, h: number) => rbStore(s, fmt, w, h));
  wrap('deleteRenderbuffer', (x: WebGLRenderbuffer | null) => { const b = x && rb.get(x); if (b) { gpuMemory.renderbuffers -= b; rb.delete(x!); } });
}
