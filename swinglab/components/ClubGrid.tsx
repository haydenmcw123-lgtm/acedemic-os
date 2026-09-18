"use client";

import { CLUBS } from "@/lib/constants";
import type { ClubId } from "@/lib/types";

export function ClubGrid({
  value,
  onChange,
}: {
  value: ClubId;
  onChange: (next: ClubId) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Club"
      className="bg-rule grid grid-cols-5 gap-px border border-rule"
    >
      {CLUBS.map((club) => {
        const selected = club.id === value;
        return (
          <button
            key={club.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(club.id)}
            className={`heading py-3 text-[14px] transition-colors ${
              selected ? "bg-bone text-fairway" : "bg-fairway text-bone-70"
            }`}
          >
            {club.label}
          </button>
        );
      })}
      {/* Keep the hairline grid rectangular — 14 clubs in fives leaves a hole. */}
      {Array.from({ length: (5 - (CLUBS.length % 5)) % 5 }).map((_, i) => (
        <span key={`pad-${i}`} aria-hidden className="bg-fairway" />
      ))}
    </div>
  );
}
