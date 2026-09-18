"use client";

interface Option<T extends string> {
  id: T;
  label: string;
  blurb?: string;
}

/**
 * Two-up selector. Selected state is bone-on-fairway, never yellow — the
 * accent belongs to measured values, not to interface chrome.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  name,
}: {
  options: Option<T>[];
  value: T;
  onChange: (next: T) => void;
  name: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={name}
      className="bg-rule grid grid-cols-2 gap-px border border-rule"
    >
      {options.map((option) => {
        const selected = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.id)}
            className={`px-3 py-3 text-left transition-colors ${
              selected ? "bg-bone text-fairway" : "bg-fairway text-bone-70"
            }`}
          >
            <span className="heading block text-[15px] leading-tight">
              {option.label}
            </span>
            {option.blurb ? (
              <span
                className={`mt-1 block text-[11px] leading-snug ${
                  selected ? "text-fairway/70" : "text-bone-45"
                }`}
              >
                {option.blurb}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
