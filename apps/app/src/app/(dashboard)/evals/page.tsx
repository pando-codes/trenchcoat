import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseDateRange } from "@/lib/date-range";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getEvalList } from "@/lib/services/evals.service";

export default async function EvalsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { from, to } = await searchParams;
  const { p_from, p_to } = parseDateRange(from, to);

  const evalsResult = await getEvalList(supabase, user.id, p_from, p_to);
  const evals = evalsResult.success ? evalsResult.data : [];

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Evals</h1>
        <p className="text-sm text-muted-foreground">
          Runs tagged with an eval ID, grouped by variant.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Evals</CardTitle>
        </CardHeader>
        <CardContent>
          {evals.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
              <p>No eval runs found in the selected range.</p>
              <p>
                To tag a run as part of an eval, set{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">TRENCHCOAT_EVAL_ID</code>{" "}
                and{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">TRENCHCOAT_EVAL_VARIANT</code>{" "}
                in the environment before running it.
              </p>
              <p>
                Then post scores for the run to{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">
                  POST /api/v1/evals/scores
                </code>
                .
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Eval ID</TableHead>
                  <TableHead className="text-right">Variants</TableHead>
                  <TableHead className="text-right">Sessions</TableHead>
                  <TableHead className="text-right">Last Run</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {evals.map((entry) => (
                  <TableRow key={entry.eval_id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/evals/${encodeURIComponent(entry.eval_id)}`}
                        className="hover:underline"
                      >
                        {entry.eval_id}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right">{entry.variant_count}</TableCell>
                    <TableCell className="text-right">{entry.session_count}</TableCell>
                    <TableCell className="text-right">
                      {new Date(entry.last_run).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
