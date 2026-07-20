import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCost } from "@/lib/cost";
import type { SessionSummary } from "@/types/analytics";
import type { TelemetryEvent } from "@/types/events";
import { getProfile } from "@/lib/services/user-profile.service";
import { OutcomeSignals } from "@/components/sessions/outcome-signals";
import { Timeline } from "@/components/sessions/timeline";
import { getAgentTree, getSessionCosts } from "@/lib/services/analytics.service";
import { SpawnGraphView } from "@/components/graph/spawn-graph-view";
import { summariseSessionCache } from "@/lib/analytics/session-cache";
import { AgentsTable } from "@/components/sessions/agents-table";
import { formatDuration } from "@/lib/format/duration";
import { formatTokens } from "@/lib/format/agents";

interface SessionDetailPageProps {
  params: Promise<{ id: string }>;
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

  const costSessionIds = [typedSession.session_id, ...childSessions.map((c) => c.session_id)];
  const costResult = await getSessionCosts(supabase, user.id, costSessionIds);
  const costById = new Map(
    (costResult.success ? costResult.data : []).map((c) => [c.session_id, c])
  );
  const sessionCostRow = costById.get(typedSession.session_id);
  const sessionCost = sessionCostRow?.cost_usd ?? null;
  const cacheSummary = summariseSessionCache(sessionCostRow);

  // The page only tracks the current session's own id and its immediate parent
  // (see parentSessionId above) — it has no resolved "true root" id. Fetch the
  // agent tree rooted at the current session; get_agent_tree recurses downward
  // from p_session_id, so this covers the current session and all its descendant agents.
  const agentTreeResult = await getAgentTree(supabase, user.id, typedSession.session_id);
  const agents = agentTreeResult.success ? agentTreeResult.data : [];

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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
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

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Cache
            </CardTitle>
          </CardHeader>
          <CardContent>
            {cacheSummary.captured ? (
              <>
                <div className="text-2xl font-bold font-mono">
                  {cacheSummary.hitRatio === null
                    ? "--"
                    : `${Math.round(cacheSummary.hitRatio * 100)}%`}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatTokens(cacheSummary.readTokens)} read ·{" "}
                  {formatTokens(cacheSummary.creationTokens)} written
                </p>
              </>
            ) : (
              <>
                <div className="text-base text-muted-foreground">Not captured</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Requires plugin 1.3.3+
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <AgentsTable agents={agents} />

      {childSessions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Subagent Sessions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {childSessions.map((child) => {
                const childCost = costById.get(child.session_id)?.cost_usd ?? null;
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

      {agents.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Spawn graph</CardTitle>
          </CardHeader>
          <CardContent>
            <SpawnGraphView tree={agents} />
          </CardContent>
        </Card>
      )}

      <Timeline events={typedEvents} userTimezone={userTimezone} />
    </div>
  );
}
