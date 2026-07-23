import { TrenchcoatMark } from "@/components/logo";

// Uses the shared TrenchcoatMark (now the registered canon "T", fixed by
// head-of-creative in components/logo.tsx) rather than a local copy —
// prefer the shared component (DRY) once it's canon-correct. Only
// `TrenchcoatLockup`/`TrenchcoatStackedLockup` hardcode `text-primary`
// (the shadcn theme); `TrenchcoatMark` itself takes color entirely from
// className, so this route's canon color still applies cleanly.
export function ReportsWordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <TrenchcoatMark className="size-5 shrink-0 text-[var(--tc-accent)]" />
      <span
        className="tc-font-display"
        style={{
          fontSize: "1.125rem",
          fontWeight: 600,
          lineHeight: 1,
          letterSpacing: "-0.04em",
          color: "var(--tc-ink-primary)",
        }}
      >
        trenchcoat
      </span>
    </div>
  );
}
