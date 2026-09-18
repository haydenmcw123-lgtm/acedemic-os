import type { ClipProbe } from "./types";

/** Frame rates a phone or camera actually records at. */
const STANDARD_RATES = [24, 25, 30, 48, 50, 60, 90, 100, 120, 180, 240];

/** Sampling is noisy; snap to a real rate when we are within 8% of one. */
export function snapToStandardRate(fps: number): number {
  let best = fps;
  let bestErr = Infinity;
  for (const rate of STANDARD_RATES) {
    const err = Math.abs(fps - rate) / rate;
    if (err < bestErr) {
      bestErr = err;
      best = rate;
    }
  }
  return bestErr <= 0.08 ? best : Math.round(fps * 10) / 10;
}

export class UndecodableClipError extends Error {
  constructor() {
    super("The browser could not decode this file.");
    this.name = "UndecodableClipError";
  }
}

function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    // Keep it out of the layout but still decodable.
    video.style.position = "fixed";
    video.style.opacity = "0";
    video.style.pointerEvents = "none";
    video.style.width = "1px";
    video.style.height = "1px";

    const done = () => {
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("error", onErr);
    };
    const onMeta = () => {
      done();
      resolve(video);
    };
    const onErr = () => {
      done();
      video.remove();
      reject(new UndecodableClipError());
    };

    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("error", onErr);
    video.src = url;
    document.body.appendChild(video);
  });
}

/**
 * Some containers report Infinity until the whole file has been walked. Seeking
 * past the end forces the real duration out.
 */
function resolveDuration(video: HTMLVideoElement): Promise<number> {
  if (Number.isFinite(video.duration) && video.duration > 0) {
    return Promise.resolve(video.duration);
  }
  return new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener("timeupdate", onSeeked);
      resolve(Number.isFinite(video.duration) ? video.duration : 0);
      video.currentTime = 0;
    };
    video.addEventListener("timeupdate", onSeeked);
    video.currentTime = 1e6;
    setTimeout(() => resolve(Number.isFinite(video.duration) ? video.duration : 0), 2000);
  });
}

interface FrameSample {
  mediaTime: number;
  decoded: number;
}

function readDecodedCount(video: HTMLVideoElement, presented: number): number {
  // totalVideoFrames counts frames the decoder produced, including any the
  // compositor then dropped — presentedFrames alone caps out at the refresh
  // rate and would read a 120fps clip as 60 on a 60Hz phone.
  const quality = video.getVideoPlaybackQuality?.();
  return quality && quality.totalVideoFrames > 0
    ? quality.totalVideoFrames
    : presented;
}

/**
 * Fallback frame-rate estimate: play a fraction of a second muted and divide
 * decoded frames by media time. Lower confidence than the container value —
 * callers should treat it as advisory.
 */
export function sampleFps(video: HTMLVideoElement): Promise<number | null> {
  if (typeof video.requestVideoFrameCallback !== "function") {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const samples: FrameSample[] = [];
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      video.pause();
      try {
        video.currentTime = 0;
      } catch {
        /* seeking back is a nicety, not a requirement */
      }
      if (samples.length < 4) return resolve(null);
      const first = samples[0];
      const last = samples[samples.length - 1];
      const dt = last.mediaTime - first.mediaTime;
      const df = last.decoded - first.decoded;
      if (dt <= 0.05 || df <= 1) return resolve(null);
      resolve(snapToStandardRate(df / dt));
    };

    const onFrame: VideoFrameRequestCallback = (_now, meta) => {
      samples.push({
        mediaTime: meta.mediaTime,
        decoded: readDecodedCount(video, meta.presentedFrames),
      });
      const span = meta.mediaTime - samples[0].mediaTime;
      if (span >= 0.25 && samples.length >= 8) return finish();
      video.requestVideoFrameCallback(onFrame);
    };

    // Hard stop: a clip that will not play should not hang the upload screen.
    setTimeout(finish, 2500);

    video.requestVideoFrameCallback(onFrame);
    video.play().catch(finish);
  });
}

/**
 * Everything the browser alone can tell us about the file. `fps` is filled in
 * by the caller from the container probe when that is available.
 */
export async function probeClip(file: File): Promise<{
  probe: ClipProbe;
  /** Caller revokes this when the screen resets. */
  objectUrl: string;
}> {
  const objectUrl = URL.createObjectURL(file);
  let video: HTMLVideoElement | null = null;
  try {
    video = await loadVideo(objectUrl);
    const durationSec = await resolveDuration(video);
    const sampled = await sampleFps(video);

    return {
      objectUrl,
      probe: {
        durationSec,
        width: video.videoWidth,
        height: video.videoHeight,
        fps: sampled,
        fpsSource: sampled == null ? "unknown" : "sampled",
        sizeBytes: file.size,
        mimeType: file.type || "unknown",
        fileName: file.name,
      },
    };
  } catch (err) {
    URL.revokeObjectURL(objectUrl);
    throw err;
  } finally {
    video?.remove();
  }
}
