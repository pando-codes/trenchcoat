import type { SessionTreeNode } from "@/types/analytics";

export interface SpawnGraphNode {
  id: string;
  parentId: string | null;
  label: string;
  depth: number;
  costUsd: number;
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

export function buildSpawnGraph(tree: SessionTreeNode[], opts: BuildOpts = {}): SpawnGraph {
  const cap = opts.cap ?? DEFAULT_CAP;
  const weight = opts.weight ?? "cost";

  // Deterministic order: by depth then start time (matches RPC ordering).
  const ordered = [...tree].sort(
    (a, b) => a.depth - b.depth || a.started_at.localeCompare(b.started_at)
  );
  const kept = ordered.slice(0, cap);
  const hiddenCount = ordered.length - kept.length;
  const keptIds = new Set(kept.map((n) => n.session_id));

  const weightOf = (n: SessionTreeNode) => (weight === "cost" ? n.estimated_cost_usd : n.duration_ms);
  const maxWeight = kept.reduce((m, n) => Math.max(m, weightOf(n)), 0);

  // Critical path: longest cumulative duration from a root to a leaf.
  const byId = new Map(kept.map((n) => [n.session_id, n]));
  const cum = new Map<string, number>(); // node -> best root→node cumulative duration
  for (const n of kept) {
    const parentCum = n.parent_session_id ? cum.get(n.parent_session_id) ?? 0 : 0;
    cum.set(n.session_id, parentCum + n.duration_ms);
  }
  let leafId: string | null = null;
  let best = -1;
  for (const [id, c] of cum) if (c > best) { best = c; leafId = id; }
  const criticalIds = new Set<string>();
  let cursor = leafId;
  while (cursor) {
    criticalIds.add(cursor);
    cursor = byId.get(cursor)?.parent_session_id ?? null;
    if (cursor && !keptIds.has(cursor)) break;
  }

  const nodes: SpawnGraphNode[] = kept.map((n) => ({
    id: n.session_id,
    parentId: n.parent_session_id,
    label: labelFor(n),
    depth: n.depth,
    costUsd: n.estimated_cost_usd,
    durationMs: n.duration_ms,
    costHeat: maxWeight > 0 ? weightOf(n) / maxWeight : 0,
    onCriticalPath: criticalIds.has(n.session_id),
  }));

  const edges: SpawnGraphEdge[] = kept
    .filter((n) => n.parent_session_id && keptIds.has(n.parent_session_id))
    .map((n) => ({
      id: `${n.parent_session_id}->${n.session_id}`,
      source: n.parent_session_id as string,
      target: n.session_id,
      label: n.edge_label ?? null,
    }));

  return { nodes, edges, truncated: hiddenCount > 0, hiddenCount };
}
