"use client";

import { useEffect, useRef } from "react";
import { AngleDiagram } from "./AngleDiagram";
import type { CameraAngle } from "@/lib/types";

const FRAMING: Record<CameraAngle, string> = {
  "down-the-line":
    "On the target line, behind the ball, lens at hand height. Your whole body and the whole club in frame at the top.",
  "face-on":
    "Square to your chest, level with the ball, lens at hand height. Your whole body and the whole club in frame at the top.",
};

const STEPS = (angle: CameraAngle) => [
  {
    n: "01",
    title: "Shoot slo-mo, 120 fps",
    body: "iOS: Settings › Camera › Record Slo-mo › 1080p at 120. Android: the Slow Motion mode in the camera app.",
  },
  {
    n: "02",
    title: "Put the phone down",
    body: "Ground, bag or tripod. Handheld shake reads as body movement and poisons every measurement.",
  },
  { n: "03", title: "Frame it", body: FRAMING[angle] },
  {
    n: "04",
    title: "One swing per clip",
    body: "Start recording before you set up, stop after the finish. Trim the rest.",
  },
];

export function FilmGuide({
  angle,
  onCancel,
  onContinue,
}: {
  angle: CameraAngle;
  onCancel: () => void;
  onContinue: () => void;
}) {
  const continueRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    continueRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onCancel}
        className="absolute inset-0 bg-fairway-deep/80"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="film-guide-title"
        className="relative flex max-h-[92vh] flex-col border-t border-rule-strong bg-fairway"
      >
        <div className="flex items-baseline justify-between px-5 pt-5">
          <h2 id="film-guide-title" className="heading text-[22px]">
            How to film this
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="eyebrow py-1 pl-4 text-bone-45"
          >
            Close
          </button>
        </div>

        <div className="overflow-y-auto px-5 pb-8">
          <div className="mt-4 border border-rule px-3 py-3">
            <div className="mx-auto max-w-[240px]">
              <AngleDiagram angle={angle} />
            </div>
          </div>

          <ol className="mt-5">
            {STEPS(angle).map((step) => (
              <li
                key={step.n}
                className="flex gap-4 border-t border-rule py-4 first:border-t-0 first:pt-0"
              >
                <span className="num text-bone-25 w-8 shrink-0 text-[26px]">
                  {step.n}
                </span>
                <div className="min-w-0">
                  <h3 className="heading text-[15px] text-bone">{step.title}</h3>
                  <p className="mt-1 text-[13px] leading-snug text-bone-70">
                    {step.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="border-t border-rule bg-fairway px-5 pt-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
          <button
            ref={continueRef}
            type="button"
            onClick={onContinue}
            className="heading w-full bg-bone py-4 text-[16px] tracking-[0.12em] text-fairway"
          >
            Choose video
          </button>
          <p className="mt-3 text-center text-[11px] text-bone-45">
            The clip is read on this device. It is never uploaded.
          </p>
        </div>
      </div>
    </div>
  );
}
