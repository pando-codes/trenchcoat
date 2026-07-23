import type { ReportsSummary } from "../mock-data";

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "var(--tc-space-2) var(--tc-space-3)",
  fontSize: "var(--tc-text-caption-size)",
  fontWeight: 600,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--tc-ink-secondary)",
  borderBottom: "1px solid var(--tc-border)",
};

const tdStyle: React.CSSProperties = {
  padding: "var(--tc-space-2) var(--tc-space-3)",
  fontSize: "var(--tc-text-body-md-size)",
  color: "var(--tc-ink-primary)",
  borderBottom: "1px solid var(--tc-border)",
};

export function TopAgentsTable({ agents }: { agents: ReportsSummary["topAgents"] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse" style={{ minWidth: 480 }}>
        <caption className="sr-only">Top agents by run volume this period</caption>
        <thead>
          <tr>
            <th style={thStyle} scope="col">Agent</th>
            <th style={thStyle} scope="col">Calls</th>
            <th style={thStyle} scope="col">Success</th>
            <th style={thStyle} scope="col">Avg duration</th>
            <th style={thStyle} scope="col">Cost</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((a) => (
            <tr key={a.name}>
              <td style={tdStyle} className="tc-font-mono">{a.name}</td>
              <td style={{ ...tdStyle, color: "var(--tc-ink-secondary)" }}>{a.calls}</td>
              <td style={tdStyle}>{a.successRate}%</td>
              <td style={{ ...tdStyle, color: "var(--tc-ink-secondary)" }} className="tc-font-mono">
                {a.avgDurationMin.toFixed(1)} min
              </td>
              <td style={tdStyle} className="tc-font-mono">${a.costUsd.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
