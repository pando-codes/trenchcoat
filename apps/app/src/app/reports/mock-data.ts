// Realistic placeholder data for the /reports view. No backend wiring —
// per brief br_db4m9x Non-goals, this is fixture data, not a live fetch.

export interface ReportsSummary {
  verdict: {
    headline: string;
    supportingStat: string;
    status: "healthy" | "attention";
  };
  performance: {
    successRate: number; // 0-100
    successTrend: number; // pct points vs prior period
    medianDurationMin: number;
  };
  cost: {
    totalUsd: number;
    trend: number; // pct vs prior period
    projectedMonthUsd: number;
  };
  health: {
    errorRate: number; // 0-100
    errorTrend: number; // pct points vs prior period, negative is good
    activeAgents: number;
  };
  dailyActivity: { date: string; sessions: number; tokens: number }[];
  dailyCost: { date: string; costUsd: number }[];
  topAgents: {
    name: string;
    calls: number;
    successRate: number;
    avgDurationMin: number;
    costUsd: number;
  }[];
}

function isoDaysAgo(daysAgo: number): string {
  const d = new Date("2026-07-23T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

export const mockReportsData: ReportsSummary = {
  verdict: {
    headline:
      "Agents are performing well and running cost-efficient this week.",
    supportingStat: "96% success rate on $184 spent across 312 runs.",
    status: "healthy",
  },
  performance: {
    successRate: 96,
    successTrend: 2.4,
    medianDurationMin: 4.2,
  },
  cost: {
    totalUsd: 184.32,
    trend: -8.1,
    projectedMonthUsd: 790,
  },
  health: {
    errorRate: 2.1,
    errorTrend: -0.6,
    activeAgents: 7,
  },
  dailyActivity: Array.from({ length: 14 }, (_, i) => {
    const daysAgo = 13 - i;
    const base = 18 + Math.round(10 * Math.sin(i / 2.3)) + (i % 3 === 0 ? 4 : 0);
    return {
      date: isoDaysAgo(daysAgo),
      sessions: Math.max(4, base),
      tokens: Math.max(4, base) * 42_000,
    };
  }),
  dailyCost: Array.from({ length: 14 }, (_, i) => {
    const daysAgo = 13 - i;
    const base = 9 + 5 * Math.sin(i / 2.1 + 1) + (i % 4 === 0 ? 3 : 0);
    return {
      date: isoDaysAgo(daysAgo),
      costUsd: Math.max(1.2, Math.round(base * 100) / 100),
    };
  }),
  topAgents: [
    { name: "code-reviewer", calls: 84, successRate: 98, avgDurationMin: 3.1, costUsd: 41.6 },
    { name: "test-runner", calls: 67, successRate: 94, avgDurationMin: 5.8, costUsd: 52.9 },
    { name: "docs-writer", calls: 51, successRate: 97, avgDurationMin: 2.4, costUsd: 18.3 },
    { name: "migration-planner", calls: 38, successRate: 89, avgDurationMin: 7.6, costUsd: 44.1 },
    { name: "release-notes", calls: 29, successRate: 100, avgDurationMin: 1.9, costUsd: 9.7 },
  ],
};
