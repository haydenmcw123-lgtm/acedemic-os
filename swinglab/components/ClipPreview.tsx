"use client";

import { useRef, useState } from "react";

/**
 * Telestrator, not filter: two hairlines and nothing else. The vertical rule
 * is the camera's centre, the horizontal is roughly hand height — between
 * them you can see at a glance whether the framing was any good.
 */
export function ClipPreview({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  return (
    <div className="relative bg-fairway-deep">
      <video
        ref={videoRef}
        src={src}
        muted
        playsInline
        loop
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        className="max-h-[52vh] w-full object-contain"
      />

      <div aria-hidden className="pointer-events-none absolute inset-0">
        <span className="absolute top-0 bottom-0 left-1/2 w-px bg-bone/25" />
        <span className="absolute right-0 left-0 top-[45%] h-px bg-bone/20" />
        <span className="absolute top-2 left-2 h-4 w-4 border-t border-l border-bone/40" />
        <span className="absolute top-2 right-2 h-4 w-4 border-t border-r border-bone/40" />
        <span className="absolute bottom-2 left-2 h-4 w-4 border-b border-l border-bone/40" />
        <span className="absolute right-2 bottom-2 h-4 w-4 border-r border-b border-bone/40" />
      </div>

      <button
        type="button"
        onClick={() => {
          const video = videoRef.current;
          if (!video) return;
          if (video.paused) void video.play();
          else video.pause();
        }}
        className="absolute inset-0 flex items-end justify-start p-3"
        aria-label={playing ? "Pause preview" : "Play preview"}
      >
        <span className="eyebrow bg-fairway-deep/70 px-2 py-1 text-bone">
          {playing ? "Pause" : "Play"}
        </span>
      </button>
    </div>
  );
}
