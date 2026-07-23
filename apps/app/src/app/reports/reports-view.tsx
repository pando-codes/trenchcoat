"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { ReportsWordmark } from "./components/wordmark";
import { StateSwitcher } from "./components/state-switcher";
import { VerdictBanner } from "./components/verdict-banner";
import { KpiRow } from "./components/kpi-row";
import { ActivityChart, CostChart } from "./components/trend-charts";
import { TopAgentsTable } from "./components/top-agents-table";
import { LoadingSkeleton } from "./components/loading-skeleton";
import { EmptyState } from "./components/empty-state";
import { ErrorState } from "./components/error-state";
import { mockReportsData } from "./mock-data";
import type { ReportsState } from "./state";

interface ReportsViewProps {
  initialState: ReportsState;
}

export function ReportsView({ initialState }: ReportsViewProps) {
  const [state, setState] = useState<ReportsState>(initialState);
  const router = useRouter();

  const handleChange = useCallback(
    (next: ReportsState) => {
      setState(next);
      router.replace(`/reports?state=${next}`, { scroll: false });
    },
    [router]
  );

  const handleRetry = useCallback(() => {
    // Simulate a real retry: brief flash of loading, then recovery.
    handleChange("loading");
    window.setTimeout(() => handleChange("populated"), 700);
  }, [handleChange]);

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-6 px-6 py-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <ReportsWordmark />
          <div>
            <h1
              className="tc-font-display"
              style={{
                fontSize: "var(--tc-text-heading-md-size)",
                lineHeight: "var(--tc-text-heading-md-lh)",
                fontWeight: "var(--tc-text-heading-md-weight)" as unknown as number,
                color: "var(--tc-ink-primary)",
              }}
            >
              Reports
            </h1>
            <p
              style={{
                fontSize: "var(--tc-text-body-md-size)",
                color: "var(--tc-ink-secondary)",
              }}
            >
              Your agents, revealed — performance, cost, and health at a glance.
            </p>
          </div>
        </div>
        <StateSwitcher current={state} onChange={handleChange} />
      </header>

      <main id="reports-content" role="tabpanel" aria-labelledby={`state-tab-${state}`}>
        {state === "loading" && <LoadingSkeleton />}
        {state === "empty" && <EmptyState />}
        {state === "error" && <ErrorState onRetry={handleRetry} />}
        {state === "populated" && (
          <div className="flex flex-col gap-6">
            <VerdictBanner verdict={mockReportsData.verdict} />
            <KpiRow
              performance={mockReportsData.performance}
              cost={mockReportsData.cost}
              health={mockReportsData.health}
            />

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <section
                className="rounded-[var(--tc-radius-lg)] p-5"
                style={{ backgroundColor: "var(--tc-surface-1)", border: "1px solid var(--tc-border)" }}
              >
                <h2
                  className="mb-3"
                  style={{
                    fontSize: "var(--tc-text-heading-sm-size)",
                    fontWeight: 600,
                    color: "var(--tc-ink-primary)",
                  }}
                >
                  Daily activity
                </h2>
                <ActivityChart data={mockReportsData.dailyActivity} />
              </section>
              <section
                className="rounded-[var(--tc-radius-lg)] p-5"
                style={{ backgroundColor: "var(--tc-surface-1)", border: "1px solid var(--tc-border)" }}
              >
                <h2
                  className="mb-3"
                  style={{
                    fontSize: "var(--tc-text-heading-sm-size)",
                    fontWeight: 600,
                    color: "var(--tc-ink-primary)",
                  }}
                >
                  Daily cost
                </h2>
                <CostChart data={mockReportsData.dailyCost} />
              </section>
            </div>

            <section
              className="rounded-[var(--tc-radius-lg)] p-5"
              style={{ backgroundColor: "var(--tc-surface-1)", border: "1px solid var(--tc-border)" }}
            >
              <h2
                className="mb-3"
                style={{
                  fontSize: "var(--tc-text-heading-sm-size)",
                  fontWeight: 600,
                  color: "var(--tc-ink-primary)",
                }}
              >
                Top agents
              </h2>
              <TopAgentsTable agents={mockReportsData.topAgents} />
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
