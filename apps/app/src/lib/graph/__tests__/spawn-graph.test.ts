import { describe, it, expect } from "bun:test";
import { buildSpawnGraph } from "../spawn-graph";
import type { SessionTreeNode } from "@/types/analytics";

function node(p: Partial<SessionTreeNode> & { session_id: string }): SessionTreeNode {
  return {
    session_id: p.session_id,
    parent_session_id: p.parent_session_id ?? null,
    spawner_id: p.spawner_id ?? null,
    spawner_type: p.spawner_type ?? null,
    depth: p.depth ?? 0,
    started_at: p.started_at ?? "2025-04-01T00:00:00Z",
    ended_at: p.ended_at ?? null,
    duration_ms: p.duration_ms ?? 0,
    tool_count: p.tool_count ?? 0,
    skill_count: p.skill_count ?? 0,
    subagent_count: p.subagent_count ?? 0,
    input_tokens: p.input_tokens ?? 0,
    output_tokens: p.output_tokens ?? 0,
    estimated_cost_usd: p.estimated_cost_usd ?? 0,
    edge_label: p.edge_label ?? null,
  };
}

describe("buildSpawnGraph", () => {
  const tree: SessionTreeNode[] = [
    node({ session_id: "root", depth: 0, duration_ms: 100, estimated_cost_usd: 0.10 }),
    node({ session_id: "a", parent_session_id: "root", depth: 1, duration_ms: 90, estimated_cost_usd: 0.40 }),
    node({ session_id: "b", parent_session_id: "root", depth: 1, duration_ms: 10, estimated_cost_usd: 0.05 }),
  ];

  it("creates a node per row and an edge per parent link", () => {
    const g = buildSpawnGraph(tree);
    expect(g.nodes).toHaveLength(3);
    expect(g.edges).toHaveLength(2);
    expect(g.edges.map((e) => `${e.source}->${e.target}`).sort()).toEqual(["root->a", "root->b"]);
  });

  it("normalizes cost heat against the max cost (default weight=cost)", () => {
    const g = buildSpawnGraph(tree);
    const a = g.nodes.find((n) => n.id === "a")!;
    const b = g.nodes.find((n) => n.id === "b")!;
    expect(a.costHeat).toBeCloseTo(1); // a has the max cost
    expect(b.costHeat).toBeLessThan(a.costHeat);
  });

  it("marks the longest-duration root→leaf chain as the critical path", () => {
    const g = buildSpawnGraph(tree); // root(100)->a(90) = 190 beats root->b = 110
    const onPath = g.nodes.filter((n) => n.onCriticalPath).map((n) => n.id).sort();
    expect(onPath).toEqual(["a", "root"]);
  });

  it("truncates beyond the cap and reports how many were hidden", () => {
    const big: SessionTreeNode[] = [node({ session_id: "root", depth: 0 })];
    for (let i = 0; i < 10; i++) big.push(node({ session_id: `n${i}`, parent_session_id: "root", depth: 1 }));
    const g = buildSpawnGraph(big, { cap: 5 });
    expect(g.nodes).toHaveLength(5);
    expect(g.truncated).toBe(true);
    expect(g.hiddenCount).toBe(6);
  });

  it("drops edges whose parent was truncated away", () => {
    const big: SessionTreeNode[] = [node({ session_id: "root", depth: 0 })];
    for (let i = 0; i < 10; i++) big.push(node({ session_id: `n${i}`, parent_session_id: "root", depth: 1 }));
    const g = buildSpawnGraph(big, { cap: 3 });
    for (const e of g.edges) {
      expect(g.nodes.some((n) => n.id === e.source)).toBe(true);
      expect(g.nodes.some((n) => n.id === e.target)).toBe(true);
    }
  });

  it("carries a node's edge_label onto its inbound edge", () => {
    const tree = [
      node({ session_id: "root", depth: 0 }),
      node({ session_id: "a", parent_session_id: "root", depth: 1, edge_label: "verify" }),
      node({ session_id: "b", parent_session_id: "root", depth: 1 }),
    ];
    const g = buildSpawnGraph(tree);
    const ea = g.edges.find((e) => e.target === "a")!;
    const eb = g.edges.find((e) => e.target === "b")!;
    expect(ea.label).toBe("verify");
    expect(eb.label).toBeNull();
  });
});
