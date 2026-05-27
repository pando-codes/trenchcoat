import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { computeCost, formatCost, type RateMap } from "@/lib/cost";
import type { SessionSummary } from "@/types/analytics";
import type { TelemetryEvent } from "@/types/events";
import { getProfile } from "@/lib/services/user-profile.service";
import { OutcomeSignals } from "@/components/sessions/outcome-signals";
import { Timeline } from "@/components/sessions/timeline";

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

function formatTimestamp(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone,
  });
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

  const parentSessionId = (session as SessionSummary & { parent_session_id?: string }).parent_session_id ?? null;

  const profileResult = await getProfile(supabase, user.id);
  const userTimezone = profileResult.success ? (profileResult.data?.timezone ?? "UTC") : "UTC";

  const [parentResult, childrenResult] = await Promise.all([
    parentSessionId
      ? supabase
          .from("sessions")
          .select("id, session_id, started_at")
          .eq("session_id", parentSessionId)   // parent_session_id stores plugin text session_id
          .eq("user_id", user.id)
          .single()
      : Promise.resolve({ data: null }),
    supabase
      .from("sessions")
      .select("id, session_id, started_at, tool_count, input_tokens, output_tokens, model")
      .eq("parent_session_id", (session as SessionSummary).session_id)
      .eq("user_id", user.id)
      .order("started_at", { ascending: true }),
  ]);

  const parentSession = parentResult.data as { id: string; session_id: string; started_at: string } | null;
  const childSessions = (childrenResult.data ?? []) as {
    id: string;
    session_id: string;
    started_at: string;
    tool_count: number;
    input_tokens: number | null;
    output_tokens: number | null;
    model: string | null;
  }[];

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
          {formatTimestamp(typedSession.started_at, userTimezone)}
        </p>
      </div>

      {parentSession && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-4 py-2 text-sm text-muted-foreground">
          <span>Subagent session — spawned by</span>
          <Link
            href={`/sessions/${parentSession.id}`}
            className="font-mono text-primary underline-offset-4 hover:underline"
          >
            {formatTimestamp(parentSession.started_at, userTimezone)}
          </Link>
        </div>
      )}

      <OutcomeSignals
        stopReason={typedSession.stop_reason}
        events={typedEvents}
      />

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

      {childSessions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Subagent Sessions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {childSessions.map((child) => {
                const childCost = computeCost(
                  child.input_tokens ?? null,
                  child.output_tokens ?? null,
                  child.model ?? null,
                  rates
                );
                return (
                  <div key={child.id} className="flex items-center justify-between rounded-lg border px-4 py-3">
                    <Link
                      href={`/sessions/${child.id}`}
                      className="text-sm text-primary underline-offset-4 hover:underline"
                    >
                      {formatTimestamp(child.started_at, userTimezone)}
                    </Link>
                    <div className="flex gap-4 text-sm text-muted-foreground">
                      <span>{child.tool_count} tools</span>
                      {childCost !== null && (
                        <span className="font-mono">{formatCost(childCost)}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Timeline events={typedEvents} userTimezone={userTimezone} />
    </div>
  );
}
