/** Where the phone was, relative to the ball and the target line. */
export type CameraAngle = "down-the-line" | "face-on";

/**
 * Coarse club family. Tour-average ranges are published per family, not per
 * club, so this is what later phases look the comparison bands up by.
 */
export type ClubCategory =
  | "driver"
  | "wood"
  | "hybrid"
  | "long-iron"
  | "mid-iron"
  | "short-iron"
  | "wedge";

export type ClubId =
  | "driver"
  | "3w"
  | "5w"
  | "hybrid"
  | "4i"
  | "5i"
  | "6i"
  | "7i"
  | "8i"
  | "9i"
  | "pw"
  | "gw"
  | "sw"
  | "lw";

export interface Club {
  id: ClubId;
  label: string;
  category: ClubCategory;
}

/** What the browser could tell us about the file before we judged it. */
export interface ClipProbe {
  durationSec: number;
  width: number;
  height: number;
  fps: number | null;
  /** How fps was established — it changes how much we trust it. */
  fpsSource: "container" | "sampled" | "unknown";
  sizeBytes: number;
  mimeType: string;
  fileName: string;
}

export type CheckStatus = "pass" | "warn" | "fail";

export interface Check {
  id: string;
  /** Condensed, uppercase in the UI: "FRAME RATE". */
  label: string;
  status: CheckStatus;
  /** The measured value, rendered large when it is a number. */
  value: string;
  /** Unit shown small and dim next to the value. */
  unit?: string;
  /** One line. Why it failed, or what to do instead. */
  note?: string;
}

export interface Verdict {
  accepted: boolean;
  checks: Check[];
}

/**
 * One capture. Written to IndexedDB under a client-generated id the moment a
 * clip is accepted; later phases attach pose, keyframes and the critique to
 * the same id.
 */
export interface SwingSession {
  id: string;
  createdAt: number;
  angle: CameraAngle;
  club: ClubId;
  clubCategory: ClubCategory;
  probe: ClipProbe;
  checks: Check[];
  /**
   * True when the file is *already* rendered slow motion — Photos exported the
   * slowed version, so the container fps is low but the captured motion was
   * not. Later phases must not read tempo ratios as real seconds when this is
   * set.
   */
  renderedSlowMotion: boolean;
  /** Whether the video blob itself made it into IndexedDB. */
  clipStored: boolean;
  status: "captured";
}
