"use client";

import type { ReportsState } from "../state";

const STATES: { value: ReportsState; label: string }[] = [
  { value: "loading", label: "Loading" },
  { value: "empty", label: "Empty" },
  { value: "populated", label: "Populated" },
  { value: "error", label: "Error" },
];

interface StateSwitcherProps {
  current: ReportsState;
  onChange: (state: ReportsState) => void;
}

// Demo-only harness so every data state named in br_db4m9x ("Fails if" #1)
// is directly reachable without a live backend. Not production chrome —
// a real deploy would drive these same four render paths from fetch
// status, not a manual switch.
export function StateSwitcher({ current, onChange }: StateSwitcherProps) {
  return (
    <div
      role="tablist"
      aria-label="Preview data state"
      className="inline-flex items-center gap-1 rounded-[var(--tc-radius-md)] p-1"
      style={{
        backgroundColor: "var(--tc-surface-1)",
        border: "1px solid var(--tc-border)",
      }}
    >
      {STATES.map((s) => {
        const active = s.value === current;
        return (
          <button
            key={s.value}
            role="tab"
            id={`state-tab-${s.value}`}
            aria-selected={active}
            aria-controls="reports-content"
            type="button"
            onClick={() => onChange(s.value)}
            className="rounded-[var(--tc-radius-sm)] px-3 py-1.5 transition-colors"
            style={{
              fontFamily: "var(--tc-font-text)",
              fontSize: "var(--tc-text-label-size)",
              fontWeight: 500,
              lineHeight: "var(--tc-text-label-lh)",
              color: active ? "var(--tc-ink-on-accent)" : "var(--tc-ink-secondary)",
              backgroundColor: active ? "var(--tc-accent)" : "transparent",
              transitionDuration: "var(--tc-motion-fast)",
              transitionTimingFunction: "var(--tc-motion-easing-standard)",
            }}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
