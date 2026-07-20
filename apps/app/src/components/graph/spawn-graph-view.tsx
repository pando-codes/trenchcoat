"use client";
import { useMemo, useState } from "react";
import dagre from "dagre";
import { ReactFlow, Background, Controls, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { buildAgentGraph, type BuildOpts } from "@/lib/graph/spawn-graph";
import type { AgentTreeNode } from "@/types/analytics";
import { formatUsd } from "@/lib/format/agents";

const W = 180, H = 52;

function layout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 30, ranksep: 60 });
  g.setDefaultEdgeLabel(() => ({}));
  nodes.forEach((n) => g.setNode(n.id, { width: W, height: H }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return nodes.map((n) => {
    const p = g.node(n.id);
    return { ...n, position: { x: p.x - W / 2, y: p.y - H / 2 } };
  });
}

// Red-orange heat: interpolate lightness by heat (0 = pale, 1 = hot).
function heatColor(heat: number): string {
  const l = 92 - Math.round(heat * 42); // 92%→50%
  return `hsl(18 90% ${l}%)`;
}

export function SpawnGraphView({ tree }: { tree: AgentTreeNode[] }) {
  const [weight, setWeight] = useState<BuildOpts["weight"]>("cost");
  const graph = useMemo(() => buildAgentGraph(tree, { weight }), [tree, weight]);

  const { nodes, edges } = useMemo(() => {
    const rawNodes: Node[] = graph.nodes.map((n) => ({
      id: n.id,
      data: { label: `${n.label}\n${formatUsd(n.costUsd)}` },
      position: { x: 0, y: 0 },
      style: {
        width: W, height: H, whiteSpace: "pre", fontSize: 11, borderRadius: 8,
        background: heatColor(n.costHeat),
        border: n.onCriticalPath ? "2px solid #dc2626" : "1px solid #e5e7eb",
      },
    }));
    const rawEdges: Edge[] = graph.edges.map((e) => ({
      id: e.id, source: e.source, target: e.target, animated: false,
      label: e.label ?? undefined,
      labelStyle: { fontSize: 10, fill: "var(--color-muted-foreground)" },
      labelBgStyle: { fill: "var(--color-background)" },
    }));
    return { nodes: layout(rawNodes, rawEdges), edges: rawEdges };
  }, [graph]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3 text-sm">
        <span className="text-muted-foreground">Weight:</span>
        <button onClick={() => setWeight("cost")}
          className={weight === "cost" ? "font-semibold underline" : "text-muted-foreground"}>Cost</button>
        <button onClick={() => setWeight("latency")}
          className={weight === "latency" ? "font-semibold underline" : "text-muted-foreground"}>Latency</button>
        {graph.truncated && (
          <span className="ml-auto text-amber-600">Truncated — {graph.hiddenCount} nodes hidden</span>
        )}
      </div>
      <div style={{ height: 480 }} className="rounded-lg border">
        <ReactFlow nodes={nodes} edges={edges} fitView proOptions={{ hideAttribution: true }}>
          <Background />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}
