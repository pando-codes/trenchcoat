import Link from "next/link";
import { TrenchcoatMark } from "@/components/logo";

// The "no agents connected yet" state named in br_db4m9x Constraints.
// Visually distinct from populated/error: centered, no numbers, one action.
export function EmptyState() {
  return (
    <div
      className="flex min-h-[420px] flex-col items-center justify-center gap-4 rounded-[var(--tc-radius-lg)] px-6 py-16 text-center"
      style={{
        backgroundColor: "var(--tc-surface-1)",
        border: "1px dashed var(--tc-border-strong)",
      }}
    >
      <TrenchcoatMark className="size-8 text-[var(--tc-accent)]" />
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
          No agents connected yet
        </p>
        <p
          className="mt-2"
          style={{
            fontSize: "var(--tc-text-body-md-size)",
            lineHeight: "var(--tc-text-body-md-lh)",
            color: "var(--tc-ink-secondary)",
          }}
        >
          Connect your first agent and this is where you&apos;ll see what it did,
          what it cost, and whether it&apos;s working.
        </p>
      </div>
      <Link
        href="/login"
        className="rounded-[var(--tc-radius-sm)] px-4 py-2 transition-colors"
        style={{
          fontSize: "var(--tc-text-label-size)",
          fontWeight: 600,
          color: "var(--tc-ink-on-accent)",
          backgroundColor: "var(--tc-accent)",
          transitionDuration: "var(--tc-motion-fast)",
        }}
      >
        Connect an agent →
      </Link>
    </div>
  );
}
