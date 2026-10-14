/**
 * Stage 6: bakes every procedural texture set (and the lightmaps) into mip-mapped KTX2 files.
 *
 *   pnpm textures   →  public/textures/*.ktx2 + manifest.json, public/lightmaps/*.ktx2, public/basis/
 *
 * The app generates its textures in code; doing that at load costs seconds, and uncompressed RGBA
 * costs 4 bytes per texel of GPU memory. Baked here, with the same generator code, into UASTC
 * (Basis Universal) with full mip chains and Zstandard supercompression, they load in parallel,
 * transcode in a worker to the GPU's native block format (BC7 on desktop, ASTC on phones) at 1 byte
 * per texel, and skip generation entirely. Normal maps use the encoder's normal-map mode.
 *
 * If the files are missing the app falls back to generating the textures at load (slower, more memory).
 */
import fs from 'node:fs';
import path from 'node:path';
import { encodeToKTX2 } from 'ktx2-encoder';
import { TEXTURE_KEYS, textureSet } from '../src/materials/procedural';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'public', 'textures');
const LM = path.join(ROOT, 'public', 'lightmaps');
const only = process.argv.slice(2);

type Raw = { data: Uint8Array; width: number; height: number };
async function encode(img: Raw, kind: 'color' | 'linear' | 'normal', mips = true, flipY = false): Promise<Uint8Array> {
  return encodeToKTX2(img.data, {
    isUASTC: true,
    uastcLDRQualityLevel: 2,
    enableRDO: kind !== 'normal', rdoQualityLevel: 1, // rate-distortion: smaller files, no visible loss
    needSupercompression: true,
    isNormalMap: kind === 'normal',
    isPerceptual: kind === 'color',
    isSetKTX2SRGBTransferFunc: kind === 'color',
    generateMipmap: mips,
    isKTX2File: true,
    isYFlip: flipY,
    // our buffers are already raw RGBA: the "decoder" just hands them over
    imageDecoder: async () => ({ width: img.width, height: img.height, data: img.data }),
  });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const manifest: Record<string, { tileU: number; tileV: number; w: number; h: number }> = {};
  const prev = fs.existsSync(path.join(OUT, 'manifest.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.json'), 'utf8')).sets : {};
  let bytes = 0;
  const t0 = Date.now();
  for (const key of TEXTURE_KEYS) {
    if (only.length && !only.includes(key) && prev[key]) { manifest[key] = prev[key]; continue; }
    const t = textureSet(key)!;
    const img = (x: THREE_Texture) => x.image as Raw;
    const m = img(t.map);
    for (const [suffix, tex, kind] of [['albedo', t.map, 'color'], ['normal', t.normalMap, 'normal'], ['orm', t.ormMap, 'linear']] as const) {
      const out = await encode(img(tex), kind);
      fs.writeFileSync(path.join(OUT, `${key}.${suffix}.ktx2`), out);
      bytes += out.length;
    }
    manifest[key] = { tileU: t.tileU, tileV: t.tileV, w: m.width, h: m.height };
    process.stdout.write(`${key} ${m.width}×${m.height} `);
  }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ format: 'uastc+zstd', sets: manifest }, null, 1));
  console.log(`\n${Object.keys(manifest).length} texture sets → ${(bytes / 1048576).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(0)} s`);

  // lightmaps: the PNGs Blender wrote (8-bit sRGB; the AO map is linear), no mips (one texel per surface patch)
  const lm = path.join(LM, 'manifest.json');
  if (fs.existsSync(lm) && (!only.length || only.includes('lightmaps'))) {
    const { PNG } = await import('pngjs');
    const m = JSON.parse(fs.readFileSync(lm, 'utf8'));
    let lb = 0;
    for (const f of [...m.times.map((t: { file: string }) => t.file), m.ao] as string[]) {
      const png = PNG.sync.read(fs.readFileSync(path.join(LM, f)));
      const out = await encode({ data: new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.length), width: png.width, height: png.height }, f === m.ao ? 'linear' : 'color', false, true); // PNG rows run top-down; GL's v runs bottom-up
      fs.writeFileSync(path.join(LM, f.replace(/\.png$/, '.ktx2')), out);
      lb += out.length;
    }
    console.log(`lightmaps → ${(lb / 1048576).toFixed(1)} MB KTX2`);
  }

  // the Basis transcoder the browser needs (three.js ships it)
  const basis = path.join(ROOT, 'node_modules', 'three', 'examples', 'jsm', 'libs', 'basis');
  fs.mkdirSync(path.join(ROOT, 'public', 'basis'), { recursive: true });
  for (const f of ['basis_transcoder.js', 'basis_transcoder.wasm']) fs.copyFileSync(path.join(basis, f), path.join(ROOT, 'public', 'basis', f));
}

type THREE_Texture = import('three').Texture;
void main();
