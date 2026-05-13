import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { computeCost, formatCost, type RateMap } from "@/lib/cost";
import type { SessionSummary } from "@/types/analytics";
import type { TelemetryEvent } from "@/types/events";

interface SessionDetailPageProps {
  params: Promise<{ id: string }>;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "--";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function eventTypeColor(type: string): "default" | "secondary" | "outline" | "destructive" {
  switch (type) {
    case "tool_use":
    case "tool_result":
      return "default";
    case "session_start":
    case "session_end":
      return "secondary";
    case "error":
      return "destructive";
    default:
      return "outline";
  }
}

export default async function SessionDetailPage({ params }: SessionDetailPageProps) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: session } = await supabase
    .from("sessions")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!session) {
    notFound();
  }

  const typedSession = session as SessionSummary;

  const { data: events } = await supabase
    .from("events")
    .select("*")
    .eq("session_id", typedSession.session_id)
    .eq("user_id", user.id)
    .order("seq", { ascending: true });

  const typedEvents: TelemetryEvent[] = (events ?? []) as unknown as TelemetryEvent[];

  const { data: pricingData } = await supabase
    .from("model_pricing")
    .select("model_id, input_cost_per_1m, output_cost_per_1m");

  const rates: RateMap = Object.fromEntries(
    ((pricingData ?? []) as { model_id: string; input_cost_per_1m: number; output_cost_per_1m: number }[]).map(
      (r) => [r.model_id, { input_cost_per_1m: r.input_cost_per_1m, output_cost_per_1m: r.output_cost_per_1m }]
    )
  );

  const sessionCost = computeCost(
    (typedSession.input_tokens as number | null) ?? null,
    (typedSession.output_tokens as number | null) ?? null,
    (typedSession.model as string | null) ?? null,
    rates
  );

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Session Detail</h1>
        <p className="text-sm text-muted-foreground">
          {formatTimestamp(typedSession.started_at)}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Duration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatDuration(typedSession.duration_ms)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Events
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{typedSession.event_count}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Tools Used
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{typedSession.tool_count}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Branch
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {typedSession.git_branch ? (
                <Badge variant="secondary">{typedSession.git_branch}</Badge>
              ) : (
                <span className="text-muted-foreground text-base">--</span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Cost
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">
              {formatCost(sessionCost)}
            </div>
          </CardContent>
        </Card>
      </div>

      {(() => {
        const agentEvents = typedEvents.filter((e) => e.event_type === "subagent_stop");
        if (agentEvents.length === 0) return null;
        return (
          <Card>
            <CardHeader>
              <CardTitle>Agents</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {agentEvents.map((event) => {
                  const d = event.data;
                  const agentType = (d.agent_type as string | null) ?? "subagent";
                  const toolCountTotal = (d.tool_count_total as number | null) ?? 0;
                  const turns = (d.turns as number | null) ?? 0;
                  const toolCounts = (d.tool_counts as Record<string, number> | null) ?? {};
                  const topTools = Object.entries(toolCounts)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 3);
                  const agentCost = computeCost(
                    (d.input_tokens as number | null) ?? null,
                    (d.output_tokens as number | null) ?? null,
                    (d.model as string | null) ?? null,
                    rates
                  );
                  return (
                    <div key={event.id} className="rounded-lg border p-4">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{agentType}</span>
                        <div className="flex gap-4 text-sm text-muted-foreground">
                          <span>{toolCountTotal} tools</span>
                          <span>{turns} turns</span>
                          {agentCost !== null && (
                            <span className="font-mono">{formatCost(agentCost)}</span>
                          )}
                        </div>
                      </div>
                      {topTools.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {topTools.map(([tool, count]) => (
                            <Badge key={tool} variant="secondary">
                              {tool} × {count}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      <Card>
        <CardHeader>
          <CardTitle>Event Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          {typedEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events recorded.</p>
          ) : (
            <div className="relative space-y-0">
              {typedEvents.map((event, index) => (
                <div
                  key={event.id}
                  className="relative flex gap-4 pb-6 last:pb-0"
                >
                  {index < typedEvents.length - 1 && (
                    <div className="absolute left-[11px] top-6 h-full w-px bg-border" />
                  )}
                  <div className="relative z-10 mt-1 size-[22px] shrink-0 rounded-full border-2 border-border bg-background" />
                  <div className="flex flex-1 flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <Badge variant={eventTypeColor(event.event_type)}>
                        {event.event_type}
                      </Badge>
                      {event.tool_name && (
                        <span className="text-sm font-medium">
                          {event.tool_name}
                        </span>
                      )}
                      {event.duration_ms !== null && (
                        <span className="text-xs text-muted-foreground">
                          {event.duration_ms}ms
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatTimestamp(event.timestamp)} (seq: {event.seq})
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
