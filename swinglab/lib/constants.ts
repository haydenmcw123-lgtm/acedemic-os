import type { CameraAngle, Club } from "./types";

export const CLUBS: Club[] = [
  { id: "driver", label: "Driver", category: "driver" },
  { id: "3w", label: "3W", category: "wood" },
  { id: "5w", label: "5W", category: "wood" },
  { id: "hybrid", label: "Hyb", category: "hybrid" },
  { id: "4i", label: "4i", category: "long-iron" },
  { id: "5i", label: "5i", category: "long-iron" },
  { id: "6i", label: "6i", category: "mid-iron" },
  { id: "7i", label: "7i", category: "mid-iron" },
  { id: "8i", label: "8i", category: "short-iron" },
  { id: "9i", label: "9i", category: "short-iron" },
  { id: "pw", label: "PW", category: "wedge" },
  { id: "gw", label: "GW", category: "wedge" },
  { id: "sw", label: "SW", category: "wedge" },
  { id: "lw", label: "LW", category: "wedge" },
];

export const ANGLES: { id: CameraAngle; label: string; blurb: string }[] = [
  {
    id: "down-the-line",
    label: "Down the line",
    blurb: "Behind the ball, on the target line",
  },
  {
    id: "face-on",
    label: "Face on",
    blurb: "Square to your chest, at the ball",
  },
];

/**
 * Validation thresholds. Every one of these is a real limit on what the pose
 * pipeline can measure, not a preference.
 */
export const LIMITS = {
  /** Above this the browser tends to die decoding it on a phone. */
  maxBytes: 600 * 1024 * 1024,
  /** Below this something is wrong with the file. */
  minDurationSec: 0.8,
  /** A swing is ~1.5s of real time; at 120fps slo-mo that plays back long. */
  maxDurationSec: 25,
  warnDurationSec: 14,
  /** Keyframe timing gets mushy below this. */
  minFps: 60,
  warnFps: 90,
  /** Short side. BlazePose needs limbs that are more than a few pixels wide. */
  minShortSide: 360,
  warnShortSide: 540,
} as const;

export const ACCEPTED_TYPES = "video/*,.mov,.mp4,.m4v,.webm";
