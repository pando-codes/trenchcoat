import type { ReportsSummary } from "../mock-data";

interface KpiRowProps {
  performance: ReportsSummary["performance"];
  cost: ReportsSummary["cost"];
  health: ReportsSummary["health"];
}

function Trend({ value, invert = false }: { value: number; invert?: boolean }) {
  // invert: for metrics where a negative delta is the good outcome (cost, error rate)
  const good = invert ? value <= 0 : value >= 0;
  const arrow = value > 0 ? "↑" : value < 0 ? "↓" : "→";
  return (
    <span
      style={{
        fontFamily: "var(--tc-font-mono)",
        fontSize: "var(--tc-text-mono-sm-size)",
        color: good ? "var(--tc-accent-emphasis)" : "var(--tc-ink-secondary)",
      }}
    >
      {arrow} {Math.abs(value).toFixed(1)}
    </span>
  );
}

function KpiCard({
  eyebrow,
  value,
  unit,
  trend,
  description,
}: {
  eyebrow: string;
  value: string;
  unit?: string;
  trend: React.ReactNode;
  description: string;
}) {
  return (
    <div
      className="flex flex-col gap-2 rounded-[var(--tc-radius-lg)] p-5"
      style={{
        backgroundColor: "var(--tc-surface-1)",
        border: "1px solid var(--tc-border)",
      }}
    >
      <p
        style={{
          fontSize: "var(--tc-text-label-size)",
          fontWeight: 600,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: "var(--tc-ink-secondary)",
        }}
      >
        {eyebrow}
      </p>
      <div className="flex items-baseline gap-2">
        <span
          className="tc-font-mono"
          style={{
            fontSize: "var(--tc-text-heading-lg-size)",
            lineHeight: "var(--tc-text-heading-lg-lh)",
            fontWeight: 600,
            color: "var(--tc-ink-primary)",
          }}
        >
          {value}
        </span>
        {unit && (
          <span
            style={{
              fontSize: "var(--tc-text-body-md-size)",
              color: "var(--tc-ink-secondary)",
            }}
          >
            {unit}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between">
        <p
          style={{
            fontSize: "var(--tc-text-caption-size)",
            color: "var(--tc-ink-secondary)",
          }}
        >
          {description}
        </p>
        {trend}
      </div>
    </div>
  );
}

// Agent performance, cost, and a quality/health signal — the three
// required within the initial 1280px viewport, no scroll (br_db4m9x
// "Fails if" #2). Numeric values render in the canon's mono family.
export function KpiRow({ performance, cost, health }: KpiRowProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <KpiCard
        eyebrow="Performance"
        value={`${performance.successRate}%`}
        unit="success rate"
        trend={<Trend value={performance.successTrend} />}
        description={`Median run ${performance.medianDurationMin.toFixed(1)} min`}
      />
      <KpiCard
        eyebrow="Cost"
        value={`$${cost.totalUsd.toFixed(2)}`}
        unit="this period"
        trend={<Trend value={cost.trend} invert />}
        description={`Projected $${cost.projectedMonthUsd.toFixed(0)} this month`}
      />
      <KpiCard
        eyebrow="Health"
        value={`${health.errorRate}%`}
        unit="error rate"
        trend={<Trend value={health.errorTrend} invert />}
        description={`${health.activeAgents} agents active`}
      />
    </div>
  );
}
