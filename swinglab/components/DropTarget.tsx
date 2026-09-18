"use client";

import { useState } from "react";

/**
 * Broadcast framing marks rather than a dashed box — corner ticks read as a
 * viewfinder, which is what this is.
 */
function CornerTicks() {
  const base = "absolute h-5 w-5 border-bone-25";
  return (
    <>
      <span className={`${base} top-0 left-0 border-t border-l`} />
      <span className={`${base} top-0 right-0 border-t border-r`} />
      <span className={`${base} bottom-0 left-0 border-b border-l`} />
      <span className={`${base} right-0 bottom-0 border-r border-b`} />
    </>
  );
}

export function DropTarget({
  onRequestPicker,
  onFile,
  disabled,
}: {
  /** Tapping opens the filming guide first; the picker comes after. */
  onRequestPicker: () => void;
  /** A drag-and-drop already has the file, so it skips straight to reading. */
  onFile: (file: File) => void;
  disabled?: boolean;
}) {
  const [dragging, setDragging] = useState(false);

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onRequestPicker}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) onFile(file);
      }}
      className={`relative flex h-52 w-full flex-col items-center justify-center border transition-colors sm:h-64 ${
        dragging ? "border-bone bg-fairway-lift" : "border-rule bg-fairway-deep"
      } ${disabled ? "opacity-40" : ""}`}
    >
      <CornerTicks />
      <span className="heading text-[26px] tracking-[0.06em]">Select footage</span>
      <span className="eyebrow mt-2">MOV or MP4 · slo-mo</span>
      <span className="mt-6 h-px w-10 bg-rule-strong" />
      <span className="mt-4 max-w-[22ch] text-center text-[11px] leading-snug text-bone-45">
        Read on this device. Nothing is uploaded.
      </span>
    </button>
  );
}
