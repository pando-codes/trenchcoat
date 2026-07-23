"use client";

import { TrenchcoatMark } from "@/components/logo";

interface ErrorStateProps {
  onRetry: () => void;
}

// Deliberately not a red/alarm color — canon registers one accent only.
// Distinguished from other states by structure (bordered card, icon,
// single retry action) and copy, not by introducing an off-canon hue.
export function ErrorState({ onRetry }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex min-h-[420px] flex-col items-center justify-center gap-4 rounded-[var(--tc-radius-lg)] px-6 py-16 text-center"
      style={{
        backgroundColor: "var(--tc-surface-1)",
        border: "1px solid var(--tc-border-strong)",
      }}
    >
      <TrenchcoatMark className="size-8 text-[var(--tc-ink-secondary)]" />
      <div className="max-w-[420px]">
        <p
          className="tc-font-display"
          style={{
            fontSize: "var(--tc-text-heading-sm-size)",
            lineHeight: "var(--tc-text-heading-sm-lh)",
            fontWeight: "var(--tc-text-heading-sm-weight)" as unknown as number,
            color: "var(--tc-ink-primary)",
          }}
        >
          Couldn&apos;t load your reports
        </p>
        <p
          className="mt-2"
          style={{
            fontSize: "var(--tc-text-body-md-size)",
            lineHeight: "var(--tc-text-body-md-lh)",
            color: "var(--tc-ink-secondary)",
          }}
        >
          Something interrupted the connection between Trenchcoat and your
          data. Retry, or check back in a moment.
        </p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-[var(--tc-radius-sm)] px-4 py-2 transition-colors"
        style={{
          fontSize: "var(--tc-text-label-size)",
          fontWeight: 600,
          color: "var(--tc-ink-on-accent)",
          backgroundColor: "var(--tc-accent)",
          transitionDuration: "var(--tc-motion-fast)",
        }}
      >
        Retry
      </button>
    </div>
  );
}
