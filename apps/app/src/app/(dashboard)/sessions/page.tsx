import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { parseDateRange } from "@/lib/date-range";
import { computeCost, formatCost, type RateMap } from "@/lib/cost";
import { SessionFilters } from "@/components/dashboard/session-filters";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { SessionSummary } from "@/types/analytics";

interface SessionsPageProps {
  searchParams: Promise<{ page?: string; branch?: string; from?: string; to?: string }>;
}

const PAGE_SIZE = 20;

function formatDuration(ms: number | null): string {
  if (ms === null) return "--";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function SessionsPage({ searchParams }: SessionsPageProps) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const page = Math.max(1, parseInt(params.page ?? "1", 10));
  const branch = params.branch ?? undefined;
  const from = params.from ?? undefined;
  const to = params.to ?? undefined;
  const offset = (page - 1) * PAGE_SIZE;

  const { p_from, p_to } = parseDateRange(from, to);

  const [branchesResult, sessionsResult, pricingResult] = await Promise.all([
    supabase
      .from("sessions")
      .select("git_branch")
      .eq("user_id", user.id)
      .not("git_branch", "is", null)
      .order("git_branch", { ascending: true }),
    (() => {
      let query = supabase
        .from("sessions")
        .select("*", { count: "exact" })
        .eq("user_id", user.id)
        .gte("started_at", p_from)
        .lte("started_at", p_to + "T23:59:59.999Z")
        .order("started_at", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);

      if (branch) {
        query = query.eq("git_branch", branch);
      }

      return query;
    })(),
    supabase.from("model_pricing").select("model_id, input_cost_per_1m, output_cost_per_1m"),
  ]);

  const branches: string[] = [
    ...new Set(
      (branchesResult.data ?? []).map((r) => r.git_branch as string)
    ),
  ].sort();

  const sessions: SessionSummary[] = sessionsResult.data ?? [];
  const totalPages = Math.ceil((sessionsResult.count ?? 0) / PAGE_SIZE);

  const rates: RateMap = Object.fromEntries(
    ((pricingResult.data ?? []) as { model_id: string; input_cost_per_1m: number; output_cost_per_1m: number }[]).map(
      (r) => [r.model_id, { input_cost_per_1m: r.input_cost_per_1m, output_cost_per_1m: r.output_cost_per_1m }]
    )
  );

  function buildPageUrl(p: number): string {
    const pageParams = new URLSearchParams();
    if (from) pageParams.set("from", from);
    if (to) pageParams.set("to", to);
    if (branch) pageParams.set("branch", branch);
    pageParams.set("page", String(p));
    return `/sessions?${pageParams.toString()}`;
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sessions</h1>
        <p className="text-sm text-muted-foreground">
          Browse your Claude Code sessions.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>All Sessions</CardTitle>
          <Suspense fallback={null}>
            <SessionFilters branches={branches} currentBranch={branch ?? null} />
          </Suspense>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Started</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead className="text-right">Events</TableHead>
                <TableHead className="text-right">Tools</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No sessions found.
                  </TableCell>
                </TableRow>
              ) : (
                sessions.map((session) => (
                  <TableRow key={session.id}>
                    <TableCell>
                      <Link
                        href={`/sessions/${session.id}`}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        {formatDate(session.started_at)}
                      </Link>
                    </TableCell>
                    <TableCell>{formatDuration(session.duration_ms)}</TableCell>
                    <TableCell className="text-right">{session.event_count}</TableCell>
                    <TableCell className="text-right">{session.tool_count}</TableCell>
                    <TableCell>
                      {session.git_branch ? (
                        <Badge variant="secondary">{session.git_branch}</Badge>
                      ) : (
                        <span className="text-muted-foreground">--</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatCost(computeCost(session.input_tokens ?? null, session.output_tokens ?? null, session.model ?? null, rates))}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-2">
              {page > 1 && (
                <Link
                  href={buildPageUrl(page - 1)}
                  className="text-sm text-primary underline-offset-4 hover:underline"
                >
                  Previous
                </Link>
              )}
              <span className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              {page < totalPages && (
                <Link
                  href={buildPageUrl(page + 1)}
                  className="text-sm text-primary underline-offset-4 hover:underline"
                >
                  Next
                </Link>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
