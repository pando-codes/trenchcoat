import type { ReportsSummary } from "../mock-data";

interface VerdictBannerProps {
  verdict: ReportsSummary["verdict"];
}

// The single labeled element that answers "are our agents performing and
// cost-efficient?" in plain language — the business-leader read required
// distinct from the raw charts (br_db4m9x "Fails if" #3).
export function VerdictBanner({ verdict }: VerdictBannerProps) {
  return (
    <section
      aria-labelledby="verdict-heading"
      className="rounded-[var(--tc-radius-lg)] px-6 py-5"
      style={{
        backgroundColor: "var(--tc-surface-1)",
        border: "1px solid var(--tc-border)",
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-[640px]">
          <p
            id="verdict-heading"
            className="mb-1"
            style={{
              fontFamily: "var(--tc-font-text)",
              fontSize: "var(--tc-text-caption-size)",
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: "var(--tc-accent-emphasis)",
            }}
          >
            Bottom line
          </p>
          <p
            className="tc-font-display"
            style={{
              fontSize: "var(--tc-text-heading-sm-size)",
              lineHeight: "var(--tc-text-heading-sm-lh)",
              fontWeight: "var(--tc-text-heading-sm-weight)" as unknown as number,
              color: "var(--tc-ink-primary)",
            }}
          >
            {verdict.headline}
          </p>
          <p
            className="mt-1"
            style={{
              fontSize: "var(--tc-text-body-md-size)",
              lineHeight: "var(--tc-text-body-md-lh)",
              color: "var(--tc-ink-secondary)",
            }}
          >
            {verdict.supportingStat}
          </p>
        </div>
        <span
          className="shrink-0 rounded-[var(--tc-radius-sm)] px-3 py-1"
          style={{
            fontSize: "var(--tc-text-label-size)",
            fontWeight: 600,
            color: "var(--tc-accent-emphasis)",
            backgroundColor: "var(--tc-accent-subtle)",
          }}
        >
          {verdict.status === "healthy" ? "Healthy" : "Needs attention"}
        </span>
      </div>
    </section>
  );
}
