# Session detail polish after Spec F

Four small items raised in Spec F reviews, triaged as ship-as-is at the time. Grouped because none justifies its own slice.

## 1. Two cost formatters on one page
`formatCost` (`apps/app/src/lib/cost.ts`) and `formatUsd` (`apps/app/src/lib/format/agents.ts`) diverge below one cent: `formatCost(0)` → `$0.00`, `formatUsd(0)` → `$0.0000`; `formatCost` emits `<$0.0001` where `formatUsd` shows `$0.0000`.

Session detail uses both — `formatCost` on the Cost stat card, `formatUsd` in the Agents table. The values agree; only the rendering differs. Both were specified explicitly in the Spec F plan, so this was carried deliberately rather than resolved mid-task.

Pick one. `formatUsd`'s "4 decimals below $1, 2 above" is the more predictable rule; `formatCost`'s `<$0.0001` is more honest about sub-threshold amounts. Whichever wins, the other should be deleted rather than left as a trap.

## 2. In-flight agents render `0m`, not `--`
Migration 033's `get_agent_tree` does `coalesce(e.duration_ms, 0)::bigint`, so an agent still running comes back as `0` rather than NULL. `formatDuration`'s `null` branch is therefore unreachable on this path and the Agents table shows `0m` for an agent that simply hasn't finished.

Fix belongs in SQL (stop coalescing, let NULL through) rather than in the component, since `duration_ms` genuinely is unknown rather than zero. Check `buildAgentGraph`'s critical-path maths before changing it — it sums `durationMs` and currently relies on the coalesce.

## 3. Dead columns in the child-session query
`sessions/[id]/page.tsx` still selects `input_tokens`, `output_tokens` and `model` for child sessions, and the local type still declares them. Nothing reads them since `computeCost` was deleted — child costs now come from `getSessionCosts`. Harmless, trivially removable, left over from exactly the code Spec F deleted.

## 4. Graph caps at 300 nodes, table does not
`buildGraphFromNodes` slices to `DEFAULT_CAP = 300`; `AgentsTable` renders every row from the same array. On a very wide tree the table lists agents absent from the graph.

Values can never disagree — same array, same field, same formatter — so this is a membership difference, not a cost one, and the graph already surfaces `truncated` / `hiddenCount`. The table being the complete list is arguably the right asymmetry. Worth a note in the graph's truncation message pointing at the table.

## When to revisit
Item 1 whenever someone touches either formatter. Item 2 next time the Agents table is worked on — it is the only one a user would actually notice. Items 3 and 4 are cleanup of opportunity.
