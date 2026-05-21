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
import type { SkillStat } from "@/types/analytics";

export default async function SkillsPage({
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

  const { data } = await supabase.rpc("get_skill_stats", {
    p_user_id: user.id,
    p_from,
    p_to,
  });

  const skills: SkillStat[] = ((data as Record<string, unknown>[]) ?? []).map((row) => ({
    skill_name: row.skill_name as string,
    invocation_count: row.invocation_count as number,
    tool_calls_triggered: row.tool_calls_triggered as number,
    cross_session_tool_calls: (row.cross_session_tool_calls as number) ?? 0,
    avg_tools_per_invocation: row.avg_tools_per_invocation as number,
  }));

  const totalInvocations = skills.reduce((sum, s) => sum + s.invocation_count, 0);
  const uniqueSkills = skills.length;
  const avgToolsOverall =
    totalInvocations > 0
      ? (
          skills.reduce((sum, s) => sum + s.tool_calls_triggered, 0) /
          totalInvocations
        ).toFixed(1)
      : "0";

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Skills</h1>
        <p className="text-sm text-muted-foreground">
          Skill invocation counts and downstream tool attribution.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Invocations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totalInvocations.toLocaleString()}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Unique Skills
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{uniqueSkills}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Avg Tools / Invocation
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{avgToolsOverall}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Cross-Session Tools
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {skills.reduce((sum, s) => sum + s.cross_session_tool_calls, 0).toLocaleString()}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Skill Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Skill</TableHead>
                <TableHead className="text-right">Invocations</TableHead>
                <TableHead className="text-right">Tools Triggered</TableHead>
                <TableHead className="text-right">Avg Tools / Invocation</TableHead>
                <TableHead className="text-right">Cross-Session Tools</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {skills.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No skill usage data found for this date range.
                  </TableCell>
                </TableRow>
              ) : (
                skills.map((skill) => (
                  <TableRow key={skill.skill_name}>
                    <TableCell className="font-medium font-mono text-sm">
                      {skill.skill_name}
                    </TableCell>
                    <TableCell className="text-right">{skill.invocation_count}</TableCell>
                    <TableCell className="text-right">{skill.tool_calls_triggered}</TableCell>
                    <TableCell className="text-right">{skill.avg_tools_per_invocation}</TableCell>
                    <TableCell className="text-right">
                      {skill.cross_session_tool_calls > 0
                        ? skill.cross_session_tool_calls.toLocaleString()
                        : <span className="text-muted-foreground">--</span>
                      }
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
