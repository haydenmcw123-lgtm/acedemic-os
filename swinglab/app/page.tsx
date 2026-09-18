"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AngleDiagram } from "@/components/AngleDiagram";
import { CheckList } from "@/components/CheckList";
import { ClipPreview } from "@/components/ClipPreview";
import { ClubGrid } from "@/components/ClubGrid";
import { DropTarget } from "@/components/DropTarget";
import { FilmGuide } from "@/components/FilmGuide";
import { Segmented } from "@/components/Segmented";
import { ACCEPTED_TYPES, ANGLES, CLUBS } from "@/lib/constants";
import { putClip, putSession } from "@/lib/db";
import { newSessionId } from "@/lib/id";
import { probeClip, UndecodableClipError } from "@/lib/probe";
import type { CameraAngle, Check, ClipProbe, ClubId, SwingSession } from "@/lib/types";
import { frameCount, mayBePreSlowed, validateClip } from "@/lib/validate";

type Stage = "setup" | "reading" | "verdict" | "ready";

const DECODE_FAILURE: Check[] = [
  {
    id: "decode",
    label: "Container",
    status: "fail",
    value: "—",
    note: "This browser cannot decode the file. Export it as H.264 MP4 and try again.",
  },
];

function Section({
  index,
  title,
  children,
}: {
  index: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-9">
      <div className="flex items-baseline gap-3 border-b border-rule pb-2">
        <span className="num text-[17px] text-bone-25">{index}</span>
        <h2 className="eyebrow text-bone-70">{title}</h2>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Readout({
  label,
  value,
  unit,
  measured = false,
}: {
  label: string;
  value: string;
  unit?: string;
  /** Measured off the clip — accent. Chosen by the golfer — bone. */
  measured?: boolean;
}) {
  return (
    <div className="border-b border-rule py-3">
      <div className="eyebrow">{label}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span
          className={`num ${value.length > 6 ? "text-[20px]" : "text-[28px]"} ${
            measured ? "text-lab" : "text-bone"
          }`}
        >
          {value}
        </span>
        {unit ? <span className="eyebrow text-bone-45">{unit}</span> : null}
      </div>
    </div>
  );
}

export default function CapturePage() {
  const [angle, setAngle] = useState<CameraAngle>("down-the-line");
  const [club, setClub] = useState<ClubId>("7i");

  const [stage, setStage] = useState<Stage>("setup");
  const [guideOpen, setGuideOpen] = useState(false);
  const [readingStatus, setReadingStatus] = useState("Decoding clip");

  const [file, setFile] = useState<File | null>(null);
  const [probe, setProbe] = useState<ClipProbe | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [decodeFailed, setDecodeFailed] = useState(false);
  const [slowMotionAck, setSlowMotionAck] = useState(false);
  const [saving, setSaving] = useState(false);
  const [session, setSession] = useState<SwingSession | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<string | null>(null);

  // The object URL outlives React state on unmount; release it by hand.
  useEffect(() => {
    urlRef.current = objectUrl;
  }, [objectUrl]);
  useEffect(() => {
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  const verdict = useMemo(
    () => (probe ? validateClip(probe, { slowMotionAcknowledged: slowMotionAck }) : null),
    [probe, slowMotionAck],
  );

  const reset = useCallback(() => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    setObjectUrl(null);
    setProbe(null);
    setFile(null);
    setDecodeFailed(false);
    setSlowMotionAck(false);
    setSession(null);
    setStage("setup");
    if (inputRef.current) inputRef.current.value = "";
  }, [objectUrl]);

  const handleFile = useCallback(
    async (picked: File) => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setObjectUrl(null);
      setProbe(null);
      setDecodeFailed(false);
      setSlowMotionAck(false);
      setFile(picked);
      setReadingStatus("Decoding clip");
      setStage("reading");

      try {
        const { probe: browserProbe, objectUrl: url } = await probeClip(picked);
        setObjectUrl(url);

        // The container header is the honest frame rate; playback sampling is
        // only a fallback for when ffmpeg cannot be fetched.
        setReadingStatus("Reading frame rate");
        let merged = browserProbe;
        try {
          const { probeContainerFps } = await import("@/lib/ffmpeg");
          const containerFps = await probeContainerFps(picked);
          if (containerFps != null) {
            merged = { ...browserProbe, fps: containerFps, fpsSource: "container" };
          }
        } catch {
          /* keep the sampled estimate */
        }

        setProbe(merged);
        setStage("verdict");
      } catch (err) {
        setDecodeFailed(err instanceof UndecodableClipError);
        setProbe(null);
        setStage("verdict");
      }
    },
    [objectUrl],
  );

  const confirm = useCallback(async () => {
    if (!probe || !file || !verdict?.accepted) return;
    setSaving(true);
    const id = newSessionId();
    const clipStored = await putClip(id, file);
    const record: SwingSession = {
      id,
      createdAt: Date.now(),
      angle,
      club,
      clubCategory: CLUBS.find((c) => c.id === club)!.category,
      probe,
      checks: verdict.checks,
      renderedSlowMotion: slowMotionAck,
      clipStored,
      status: "captured",
    };
    try {
      await putSession(record);
      setSession(record);
      setStage("ready");
    } finally {
      setSaving(false);
    }
  }, [angle, club, file, probe, slowMotionAck, verdict]);

  const checks = decodeFailed ? DECODE_FAILURE : (verdict?.checks ?? []);
  const frames = probe ? frameCount(probe) : null;
  const clubLabel = CLUBS.find((c) => c.id === club)?.label ?? "";
  const angleLabel = ANGLES.find((a) => a.id === angle)?.label ?? "";

  return (
    <main className="mx-auto w-full max-w-md px-5 pb-20">
      <header className="flex items-baseline justify-between border-b border-rule-strong pt-6 pb-3">
        <h1 className="heading text-[24px] tracking-[0.02em]">
          Swing<span className="text-lab">Lab</span>
        </h1>
        <span className="eyebrow">On device</span>
      </header>

      {stage === "ready" && session ? (
        <ReadyPanel
          session={session}
          angleLabel={angleLabel}
          clubLabel={clubLabel}
          frames={frames}
          objectUrl={objectUrl}
          onReset={reset}
        />
      ) : (
        <>
          <Section index="01" title="Camera angle">
            <Segmented name="Camera angle" options={ANGLES} value={angle} onChange={setAngle} />
            <div className="mt-3 border border-rule px-3 py-3">
              <AngleDiagram angle={angle} />
            </div>
          </Section>

          <Section index="02" title="Club">
            <ClubGrid value={club} onChange={setClub} />
          </Section>

          <Section index="03" title="Footage">
            {stage === "setup" ? (
              <>
                <DropTarget
                  onRequestPicker={() => setGuideOpen(true)}
                  onFile={(picked) => void handleFile(picked)}
                />
                <button
                  type="button"
                  onClick={() => setGuideOpen(true)}
                  className="eyebrow mt-4 w-full border border-rule py-3 text-bone-70"
                >
                  How to film this
                </button>
              </>
            ) : null}

            {stage === "reading" ? <ReadingPanel status={readingStatus} /> : null}

            {stage === "verdict" ? (
              <div>
                {objectUrl ? <ClipPreview src={objectUrl} /> : null}

                <h3 className="heading mt-6 text-[19px]">
                  {decodeFailed || !verdict?.accepted ? "Clip rejected" : "Clip reads clean"}
                </h3>
                <p className="mt-1 text-[12px] leading-snug text-bone-45">
                  {decodeFailed || !verdict?.accepted
                    ? "Fix the flagged line and pick another clip. Everything else measured fine."
                    : "Nothing here will hold the measurements back."}
                </p>

                <div className="mt-4">
                  <CheckList checks={checks} />
                </div>

                {probe && mayBePreSlowed(probe) ? (
                  <label className="mt-4 flex items-start gap-3 border border-rule p-3">
                    <input
                      type="checkbox"
                      checked={slowMotionAck}
                      onChange={(e) => setSlowMotionAck(e.target.checked)}
                      className="mt-0.5 h-4 w-4 accent-[#E8C547]"
                    />
                    <span className="text-[12px] leading-snug text-bone-70">
                      <span className="heading block text-[13px] text-bone">
                        This clip is already slowed down
                      </span>
                      Photos exports slo-mo at the playback rate, so the file says{" "}
                      {probe.fps ?? "—"} fps but the motion was captured faster. Tick this
                      and the detail is taken as real.
                    </span>
                  </label>
                ) : null}

                <div className="mt-5 flex gap-px bg-rule">
                  <button
                    type="button"
                    onClick={reset}
                    className="heading flex-1 bg-fairway py-4 text-[15px] tracking-[0.1em] text-bone-70"
                  >
                    Pick another
                  </button>
                  {verdict?.accepted ? (
                    <button
                      type="button"
                      onClick={() => void confirm()}
                      disabled={saving}
                      className="heading flex-1 bg-bone py-4 text-[15px] tracking-[0.1em] text-fairway disabled:opacity-50"
                    >
                      {saving ? "Saving" : "Use this clip"}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </Section>
        </>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        className="hidden"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          if (picked) void handleFile(picked);
        }}
      />

      {guideOpen ? (
        <FilmGuide
          angle={angle}
          onCancel={() => setGuideOpen(false)}
          onContinue={() => {
            setGuideOpen(false);
            inputRef.current?.click();
          }}
        />
      ) : null}
    </main>
  );
}

function ReadingPanel({ status }: { status: string }) {
  return (
    <div className="border border-rule bg-fairway-deep px-4 py-10 text-center">
      <span className="eyebrow text-bone-70">{status}</span>
      <div className="mx-auto mt-4 h-px w-24 overflow-hidden bg-rule">
        <span className="block h-px w-1/2 animate-[swipe_1.1s_ease-in-out_infinite] bg-lab" />
      </div>
      <p className="mt-4 text-[11px] text-bone-45">
        Reading the file in place. Nothing is being sent anywhere.
      </p>
    </div>
  );
}

function ReadyPanel({
  session,
  angleLabel,
  clubLabel,
  frames,
  objectUrl,
  onReset,
}: {
  session: SwingSession;
  angleLabel: string;
  clubLabel: string;
  frames: number | null;
  objectUrl: string | null;
  onReset: () => void;
}) {
  const { probe } = session;
  return (
    <div className="mt-8">
      <span className="eyebrow text-bone-70">Clip logged</span>
      <h2 className="heading mt-2 text-[30px] leading-none">Ready to analyse</h2>

      {objectUrl ? (
        <div className="mt-5">
          <ClipPreview src={objectUrl} />
        </div>
      ) : null}

      <div className="mt-6 grid grid-cols-2 gap-x-6">
        <Readout
          measured
          label="Frame rate"
          value={probe.fps == null ? "—" : String(Math.round(probe.fps))}
          unit="fps"
        />
        <Readout measured label="Duration" value={probe.durationSec.toFixed(1)} unit="s" />
        <Readout measured label="Frames" value={frames == null ? "—" : String(frames)} />
        <Readout measured label="Frame size" value={`${probe.width}×${probe.height}`} />
        <Readout label="Angle" value={angleLabel} />
        <Readout label="Club" value={clubLabel} />
      </div>

      <dl className="mt-6 space-y-1 text-[11px] text-bone-45">
        <div className="flex justify-between gap-4">
          <dt className="eyebrow">Session</dt>
          <dd className="truncate font-mono">{session.id}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="eyebrow">Clip cached</dt>
          <dd>{session.clipStored ? "Yes, in this browser" : "No — too large for storage"}</dd>
        </div>
      </dl>

      <div className="mt-8 border border-rule px-4 py-5">
        <span className="eyebrow text-bone-70">Next</span>
        <p className="mt-2 text-[13px] leading-snug text-bone-70">
          Pose tracking and keyframe detection arrive in the next phase. This clip is
          logged under the id above and will be picked up from there.
        </p>
      </div>

      <button
        type="button"
        onClick={onReset}
        className="heading mt-6 w-full border border-rule py-4 text-[15px] tracking-[0.1em] text-bone-70"
      >
        New clip
      </button>
    </div>
  );
}
