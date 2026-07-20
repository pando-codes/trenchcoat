import type { SessionTreeNode, AgentTreeNode } from "@/types/analytics";

export interface SpawnGraphNode {
  id: string;
  parentId: string | null;
  label: string;
  depth: number;
  costUsd: number | null;
  durationMs: number;
  costHeat: number; // 0..1 normalized against max weight
  onCriticalPath: boolean;
}
export interface SpawnGraphEdge { id: string; source: string; target: string; label: string | null; }
export interface SpawnGraph {
  nodes: SpawnGraphNode[];
  edges: SpawnGraphEdge[];
  truncated: boolean;
  hiddenCount: number;
}

export interface BuildOpts { cap?: number; weight?: "cost" | "latency"; }

const DEFAULT_CAP = 300;

function labelFor(n: SessionTreeNode): string {
  if (n.spawner_type && n.spawner_id) return `${n.spawner_type}:${n.spawner_id}`;
  return n.session_id.slice(0, 8);
}

export interface GraphInputNode {
  id: string;
  parentId: string | null;
  label: string;
  depth: number;
  costUsd: number | null;
  durationMs: number;
  edgeLabel: string | null;
  sortKey: string;
}

export function buildGraphFromNodes(
  input: GraphInputNode[],
  opts: BuildOpts = {}
): SpawnGraph {
  const cap = opts.cap ?? DEFAULT_CAP;
  const weight = opts.weight ?? "cost";

  // Deterministic order: by depth then start time (matches RPC ordering).
  const ordered = [...input].sort(
    (a, b) => a.depth - b.depth || a.sortKey.localeCompare(b.sortKey)
  );
  const kept = ordered.slice(0, cap);
  const hiddenCount = ordered.length - kept.length;
  const keptIds = new Set(kept.map((n) => n.id));

  const weightOf = (n: GraphInputNode) => (weight === "cost" ? n.costUsd ?? 0 : n.durationMs);
  const maxWeight = kept.reduce((m, n) => Math.max(m, weightOf(n)), 0);

  // Critical path: longest cumulative duration from a root to a leaf.
  const byId = new Map(kept.map((n) => [n.id, n]));
  const cum = new Map<string, number>(); // node -> best root→node cumulative duration
  for (const n of kept) {
    const parentCum = n.parentId ? cum.get(n.parentId) ?? 0 : 0;
    cum.set(n.id, parentCum + n.durationMs);
  }
  let leafId: string | null = null;
  let best = -1;
  for (const [id, c] of cum) if (c > best) { best = c; leafId = id; }
  const criticalIds = new Set<string>();
  let cursor = leafId;
  while (cursor) {
    criticalIds.add(cursor);
    cursor = byId.get(cursor)?.parentId ?? null;
    if (cursor && !keptIds.has(cursor)) break;
  }

  const nodes: SpawnGraphNode[] = kept.map((n) => ({
    id: n.id,
    parentId: n.parentId,
    label: n.label,
    depth: n.depth,
    costUsd: n.costUsd,
    durationMs: n.durationMs,
    costHeat: maxWeight > 0 ? weightOf(n) / maxWeight : 0,
    onCriticalPath: criticalIds.has(n.id),
  }));

  const edges: SpawnGraphEdge[] = kept
    .filter((n) => n.parentId && keptIds.has(n.parentId))
    .map((n) => ({
      id: `${n.parentId}->${n.id}`,
      source: n.parentId as string,
      target: n.id,
      label: n.edgeLabel ?? null,
    }));

  return { nodes, edges, truncated: hiddenCount > 0, hiddenCount };
}

export function buildSpawnGraph(tree: SessionTreeNode[], opts: BuildOpts = {}): SpawnGraph {
  return buildGraphFromNodes(
    tree.map((n) => ({
      id: n.session_id,
      parentId: n.parent_session_id,
      label: labelFor(n),
      depth: n.depth,
      costUsd: n.estimated_cost_usd,
      durationMs: n.duration_ms,
      edgeLabel: n.edge_label ?? null,
      sortKey: n.started_at,
    })),
    opts
  );
}

export function buildAgentGraph(tree: AgentTreeNode[], opts: BuildOpts = {}): SpawnGraph {
  return buildGraphFromNodes(
    tree.map((n) => ({
      id: n.agent_id,
      parentId: n.parent_agent_id,
      label: n.agent_type || n.agent_id.slice(0, 8),
      depth: n.depth,
      costUsd: n.estimated_cost_usd,
      durationMs: n.duration_ms,
      edgeLabel: n.edge_label,
      sortKey: n.started_at ?? "",
    })),
    opts
  );
}
