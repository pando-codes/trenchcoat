import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getEvalComparison } from "@/lib/services/evals.service";
import { isLowSample, metricNames, deltaVsBaseline } from "@/lib/analytics/eval-comparison";
import { formatUsd, formatTokens, formatLatency } from "@/lib/format/agents";

export default async function EvalComparisonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const evalId = decodeURIComponent(id);

  const result = await getEvalComparison(supabase, user.id, evalId);
  const variants = result.success ? result.data : [];

  const metrics = metricNames(variants);
  const baseline = variants[0];

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <Link href="/evals" className="text-sm text-muted-foreground hover:underline">
          ← Evals
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{evalId}</h1>
        <p className="text-sm text-muted-foreground">
          Per-variant session, cost, and score comparison. Sample counts are shown next to every
          average.
        </p>
      </div>

      {variants.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            <p>No runs found for this eval.</p>
            <p className="mt-1">
              Tag runs with{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                TRENCHCOAT_EVAL_ID={evalId}
              </code>{" "}
              and{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                TRENCHCOAT_EVAL_VARIANT
              </code>{" "}
              in the environment, then post scores to{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                POST /api/v1/evals/scores
              </code>
              .
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {variants.map((variant) => {
            const lowSample = isLowSample(variant.session_count);
            const isBaseline = variants.length > 1 && variant.eval_variant === baseline?.eval_variant;

            return (
              <Card key={variant.eval_variant}>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    {variant.eval_variant}
                    {isBaseline && <Badge variant="outline">baseline</Badge>}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">Sessions</dt>
                      <dd className="flex items-center gap-2 font-medium">
                        {variant.session_count}
                        {lowSample && <Badge variant="secondary">low sample</Badge>}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Total Cost</dt>
                      <dd className="font-medium">{formatUsd(variant.total_cost_usd)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Tokens (in/out)</dt>
                      <dd className="font-medium">
                        {formatTokens(variant.total_input_tokens)} /{" "}
                        {formatTokens(variant.total_output_tokens)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Avg Duration</dt>
                      <dd className="font-medium">
                        {formatLatency(variant.avg_duration_ms, variant.session_count)}
                      </dd>
                    </div>
                  </dl>

                  {metrics.length > 0 && (
                    <div className="border-t pt-3">
                      <table className="w-full text-sm">
                        <tbody>
                          {metrics.map((metric) => {
                            const summary = variant.scores?.[metric];
                            const delta = !isBaseline ? deltaVsBaseline(variants, metric) : null;
                            return (
                              <tr key={metric} className="border-b last:border-0">
                                <td className="py-1.5 pr-2 align-top text-muted-foreground">
                                  {metric}
                                </td>
                                <td className="py-1.5 text-right">
                                  {summary ? (
                                    <div className="font-medium">
                                      {summary.avg.toFixed(2)}{" "}
                                      <span className="text-xs font-normal text-muted-foreground">
                                        (n={summary.count})
                                      </span>
                                    </div>
                                  ) : (
                                    <span className="text-muted-foreground">--</span>
                                  )}
                                  {delta !== null && (
                                    <div
                                      className={`text-xs ${
                                        delta >= 0 ? "text-emerald-600" : "text-red-500"
                                      }`}
                                    >
                                      {delta >= 0 ? "+" : ""}
                                      {delta.toFixed(2)} vs {baseline?.eval_variant}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
