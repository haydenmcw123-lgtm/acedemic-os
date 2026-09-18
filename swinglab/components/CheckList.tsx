import type { Check } from "@/lib/types";

const MARK: Record<Check["status"], { label: string; className: string }> = {
  pass: { label: "OK", className: "text-bone-45" },
  warn: { label: "Check", className: "text-bone-70" },
  fail: { label: "Out of range", className: "text-flag" },
};

/**
 * One measured value per row. The number is the accent because it is the
 * user's own; red appears only when the value is out of range.
 */
export function CheckList({ checks }: { checks: Check[] }) {
  return (
    <ul className="border-t border-rule">
      {checks.map((check) => {
        const failed = check.status === "fail";
        const mark = MARK[check.status];
        return (
          <li
            key={check.id}
            className="flex items-start gap-4 border-b border-rule py-3.5"
          >
            <span
              aria-hidden
              className={`mt-1 h-8 w-px shrink-0 ${
                failed
                  ? "bg-flag"
                  : check.status === "warn"
                    ? "bg-bone-45"
                    : "bg-rule"
              }`}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="eyebrow">{check.label}</span>
                <span className={`eyebrow ${mark.className}`}>{mark.label}</span>
              </div>
              {check.note ? (
                <p className="mt-1.5 text-[12px] leading-snug text-bone-45">
                  {check.note}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-baseline gap-1 text-right">
              <span
                className={`num ${check.value.length > 6 ? "text-[19px]" : "text-[30px]"} ${
                  failed ? "text-flag" : "text-lab"
                }`}
              >
                {check.value}
              </span>
              {check.unit ? (
                <span className="eyebrow text-bone-45">{check.unit}</span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
