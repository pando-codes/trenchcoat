import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatUsd, formatTokens } from "@/lib/format/agents";
import { formatDuration } from "@/lib/format/duration";
import type { AgentTreeNode } from "@/types/analytics";

export function AgentsTable({ agents }: { agents: AgentTreeNode[] }) {
  if (agents.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Agents</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agent</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Model</TableHead>
              <TableHead className="text-right">Duration</TableHead>
              <TableHead className="text-right">Tools</TableHead>
              <TableHead className="text-right">In / Out</TableHead>
              <TableHead className="text-right">Cache R / C</TableHead>
              <TableHead className="text-right">Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {agents.map((a) => (
              <TableRow key={a.agent_id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span
                      className="text-muted-foreground"
                      style={{ paddingLeft: `${a.depth * 12}px` }}
                    />
                    <span className="font-medium">
                      {a.agent_type || a.agent_id.slice(0, 8)}
                    </span>
                    {a.edge_label && <Badge variant="outline">{a.edge_label}</Badge>}
                  </div>
                </TableCell>
                <TableCell>
                  {a.status ? (
                    <Badge
                      variant={
                        a.status === "completed"
                          ? "secondary"
                          : a.status === "running"
                            ? "outline"
                            : "destructive"
                      }
                    >
                      {a.status}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">--</span>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {a.model ?? "--"}
                </TableCell>
                <TableCell className="text-right">{formatDuration(a.duration_ms)}</TableCell>
                <TableCell className="text-right">{a.tool_count ?? "--"}</TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {formatTokens(a.input_tokens)} / {formatTokens(a.output_tokens)}
                </TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {formatTokens(a.cache_read_tokens)} / {formatTokens(a.cache_creation_tokens)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatUsd(a.estimated_cost_usd)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
