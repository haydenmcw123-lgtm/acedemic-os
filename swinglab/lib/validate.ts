import { LIMITS } from "./constants";
import type { Check, ClipProbe, Verdict } from "./types";

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(1);
  if (bytes >= 1024 ** 2) return Math.round(bytes / 1024 ** 2).toString();
  return Math.max(1, Math.round(bytes / 1024)).toString();
}

export function bytesUnit(bytes: number): string {
  if (bytes >= 1024 ** 3) return "GB";
  return bytes >= 1024 ** 2 ? "MB" : "KB";
}

/** Sampled rates carry false precision at two decimals. */
function formatFps(fps: number): string {
  return fps % 1 === 0 ? String(fps) : fps.toFixed(1);
}

/**
 * A clip whose container says 30fps may still be honest slow motion — Photos
 * renders the slowed version out at the playback rate, which keeps every bit
 * of the captured detail. We cannot tell the two apart from the file, so we
 * ask instead of rejecting.
 */
export function mayBePreSlowed(probe: ClipProbe): boolean {
  return probe.fps != null && probe.fps < LIMITS.minFps;
}

export function validateClip(
  probe: ClipProbe,
  options: { slowMotionAcknowledged: boolean },
): Verdict {
  const checks: Check[] = [];

  // --- Frame rate -----------------------------------------------------------
  const fps = probe.fps;
  if (fps == null) {
    checks.push({
      id: "fps",
      label: "Frame rate",
      status: "warn",
      value: "—",
      note: "Could not be read. Measurements will trust the file's own timing.",
    });
  } else if (fps >= LIMITS.warnFps) {
    checks.push({
      id: "fps",
      label: "Frame rate",
      status: "pass",
      value: formatFps(fps),
      unit: "fps",
      note:
        probe.fpsSource === "sampled"
          ? "Estimated from playback, not the file header."
          : undefined,
    });
  } else if (fps >= LIMITS.minFps) {
    checks.push({
      id: "fps",
      label: "Frame rate",
      status: "warn",
      value: formatFps(fps),
      unit: "fps",
      note: "Usable, but impact lands between frames. 120 is the target.",
    });
  } else if (options.slowMotionAcknowledged) {
    checks.push({
      id: "fps",
      label: "Frame rate",
      status: "warn",
      value: formatFps(fps),
      unit: "fps",
      note: "Read as pre-slowed footage. Tempo will be reported as a ratio only.",
    });
  } else {
    checks.push({
      id: "fps",
      label: "Frame rate",
      status: "fail",
      value: formatFps(fps),
      unit: "fps",
      note: "Too coarse to find impact — unless this clip is already slowed down.",
    });
  }

  // --- Duration -------------------------------------------------------------
  const duration = probe.durationSec;
  if (!Number.isFinite(duration) || duration < LIMITS.minDurationSec) {
    checks.push({
      id: "duration",
      label: "Duration",
      status: "fail",
      value: Number.isFinite(duration) ? duration.toFixed(2) : "—",
      unit: "s",
      note: "Too short to contain a full swing.",
    });
  } else if (duration > LIMITS.maxDurationSec) {
    checks.push({
      id: "duration",
      label: "Duration",
      status: "fail",
      value: duration.toFixed(1),
      unit: "s",
      note: "Trim to the swing itself — setup to finish, nothing else.",
    });
  } else if (duration > LIMITS.warnDurationSec) {
    checks.push({
      id: "duration",
      label: "Duration",
      status: "warn",
      value: duration.toFixed(1),
      unit: "s",
      note: "Long. Trimming closer to the swing speeds up the pose pass.",
    });
  } else {
    checks.push({
      id: "duration",
      label: "Duration",
      status: "pass",
      value: duration.toFixed(1),
      unit: "s",
    });
  }

  // --- Frame size -----------------------------------------------------------
  const shortSide = Math.min(probe.width, probe.height);
  const size = `${probe.width}×${probe.height}`;
  if (probe.width === 0 || probe.height === 0) {
    checks.push({
      id: "resolution",
      label: "Frame size",
      status: "fail",
      value: "—",
      note: "No video track was found in this file.",
    });
  } else if (shortSide < LIMITS.minShortSide) {
    checks.push({
      id: "resolution",
      label: "Frame size",
      status: "fail",
      value: size,
      note: "Too small for pose tracking to find your hands and the club.",
    });
  } else if (shortSide < LIMITS.warnShortSide) {
    checks.push({
      id: "resolution",
      label: "Frame size",
      status: "warn",
      value: size,
      note: "Low. Wrist and shaft positions will be less certain.",
    });
  } else {
    checks.push({ id: "resolution", label: "Frame size", status: "pass", value: size });
  }

  // --- File size ------------------------------------------------------------
  if (probe.sizeBytes > LIMITS.maxBytes) {
    checks.push({
      id: "size",
      label: "File size",
      status: "fail",
      value: formatBytes(probe.sizeBytes),
      unit: bytesUnit(probe.sizeBytes),
      note: "Larger than this browser can hold in memory. Trim the clip first.",
    });
  } else {
    checks.push({
      id: "size",
      label: "File size",
      status: "pass",
      value: formatBytes(probe.sizeBytes),
      unit: bytesUnit(probe.sizeBytes),
    });
  }

  return { accepted: !checks.some((c) => c.status === "fail"), checks };
}

/** Frames the pose pass will actually walk. */
export function frameCount(probe: ClipProbe): number | null {
  if (probe.fps == null || !Number.isFinite(probe.durationSec)) return null;
  return Math.round(probe.fps * probe.durationSec);
}
