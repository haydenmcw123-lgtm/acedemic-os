import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import { snapToStandardRate } from "./probe";

/**
 * Single-threaded core on purpose: the multi-threaded build needs
 * cross-origin isolation (COOP/COEP), and those headers break loading the
 * MediaPipe WASM bundle from a CDN. Frame extraction in later phases is not
 * hot enough to be worth that trade.
 */
const CORE_BASE =
  process.env.NEXT_PUBLIC_FFMPEG_CORE_URL ??
  "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd";

/** Past this, pulling the whole file into WASM memory on a phone is a crash. */
export const FFMPEG_MAX_BYTES = 250 * 1024 * 1024;

/**
 * The core is a ~30MB fetch the first time. On range wifi that is slow but
 * finite — past this we stop waiting and use the sampled frame rate instead,
 * so a bad connection can never strand someone on the reading screen.
 */
const PROBE_TIMEOUT_MS = 25_000;

function withTimeout<T>(work: Promise<T>, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), PROBE_TIMEOUT_MS);
    work
      .then((value) => resolve(value))
      .catch(() => resolve(fallback))
      .finally(() => clearTimeout(timer));
  });
}

let instance: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;

export function isFfmpegLoaded(): boolean {
  return instance !== null;
}

export async function getFfmpeg(
  onProgress?: (ratio: number) => void,
): Promise<FFmpeg> {
  if (instance) return instance;
  if (loading) return loading;

  loading = (async () => {
    const ffmpeg = new FFmpeg();
    if (onProgress) {
      ffmpeg.on("progress", ({ progress }) => onProgress(progress));
    }
    await ffmpeg.load({
      coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
    });
    instance = ffmpeg;
    return ffmpeg;
  })();

  try {
    return await loading;
  } catch (err) {
    loading = null;
    throw err;
  }
}

function parseFps(log: string): number | null {
  // Stream #0:0 ... 1920x1080, 24151 kb/s, 119.88 fps, 120 tbr, 600 tbn
  const fps = log.match(/,\s*([\d.]+)\s*fps\b/);
  if (fps) {
    const value = Number.parseFloat(fps[1]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  const tbr = log.match(/,\s*([\d.]+)\s*tbr\b/);
  if (tbr) {
    const value = Number.parseFloat(tbr[1]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

/**
 * Authoritative frame rate, read out of the container header rather than
 * guessed from playback. Returns null if ffmpeg could not be loaded or the
 * stream line was not recognisable — the caller falls back to the sampled
 * estimate rather than blocking the upload.
 */
export function probeContainerFps(file: File): Promise<number | null> {
  return withTimeout(readContainerFps(file), null);
}

async function readContainerFps(file: File): Promise<number | null> {
  if (file.size > FFMPEG_MAX_BYTES) return null;

  let ffmpeg: FFmpeg;
  try {
    ffmpeg = await getFfmpeg();
  } catch {
    return null;
  }

  const lines: string[] = [];
  const onLog = ({ message }: { message: string }) => lines.push(message);
  const name = "probe_input";

  ffmpeg.on("log", onLog);
  try {
    await ffmpeg.writeFile(name, await fetchFile(file));
    // No output file: ffmpeg prints the stream table, then exits non-zero.
    // That exit code is expected and not an error for our purposes.
    await ffmpeg.exec(["-hide_banner", "-i", name]);
    const fps = parseFps(lines.join("\n"));
    return fps == null ? null : snapToStandardRate(fps);
  } catch {
    return parseFps(lines.join("\n"));
  } finally {
    ffmpeg.off("log", onLog);
    try {
      await ffmpeg.deleteFile(name);
    } catch {
      /* the virtual FS is torn down with the worker anyway */
    }
  }
}
