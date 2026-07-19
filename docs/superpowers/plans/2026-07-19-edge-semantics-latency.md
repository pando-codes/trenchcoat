# Edge Semantics + Latency Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable per-agent latency (by carrying the existing `agent_id` onto the Agent `tool_end`) and opt-in edge labels on spawns, then surface both in the dashboard.

**Architecture:** Capture-side additions to two hooks (purely additive fields inside the free-form event `data`), read-side RPC enrichment, then UI. No ingest/table migration is needed for capture; migrations are read-side only.

**Tech Stack:** Python 3 plugin hooks + pytest; Supabase/Postgres plpgsql RPCs; Next.js 16 RSC + Recharts + react-flow; `bun test`.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-19-edge-semantics-latency-design.md`. This plan implements Spec B only.
- **Do NOT read `tool_input["subagent_type"]`** — it is provably absent at PreToolUse (0 of 435 observed Agent events). Any code depending on it silently never fires.
- **Latency attribution key is `agent_id`**, already minted in `pre_tool_use.py` and already present on `subagent_stop`. The gap is only that `tool_end` lacks it. Do not add `agent_type` to `tool_end`.
- **Edge label marker:** exactly `[tc:delegate]`, `[tc:verify]`, `[tc:critique]` (case-insensitive). Anything else → no `edge_label`, never guessed. Parsing runs ONLY for `tool_name == "Agent"`.
- **Capture changes are additive inside `data`** — no ingest Zod change, no events-table migration.
- **Agent identity normalization** stays `coalesce(nullif(trim(e.data->>'agent_type'), ''), 'general-purpose')` (matches migrations 020/021).
- **`get_top_agents` and `get_agent_timeseries` return `json`** → adding fields needs NO `drop function`. **`get_session_tree` returns `TABLE(...)`** → adding a column REQUIRES `drop function if exists` first (precedent: migration 023).
- **Migrations** append-only, sequential from `024`.
- **Tests:** plugin → `cd claude-plugin && uv run --with pytest pytest tests/`; app → `cd apps/app && bun test <file>`. App service tests mock Supabase via `createMockSupabase(tableMocks, rpcMocks)`. No React-component or DB test harness — UI verified by `bunx tsc --noEmit` (a ~30-error `bun:test` baseline is pre-existing) + manual run; RPCs by service shape tests + manual SQL smoke.
- **Null latency renders `--`, never `0`.**
- **Commit** after each task with the shown message.

---

## File Structure

**Modified — capture**
- `claude-plugin/hooks/post_tool_use.py` — copy `agent_id` + `edge_label` from pending onto `tool_end`.
- `claude-plugin/hooks/pre_tool_use.py` — parse/strip edge marker, emit `edge_label`, pass to pending.
- `claude-plugin/lib/telemetry.py` — `parse_edge_label()` helper; `push_pending(..., edge_label=None)`.
- `claude-plugin/tests/test_telemetry.py` — unit + hook-integration tests.
- `claude-plugin/.claude-plugin/plugin.json` — version 1.1.0 → 1.2.0.

**New — read-side**
- `supabase/migrations/024_agent_latency.sql` — latency fields in `get_top_agents` + `get_agent_timeseries`.
- `supabase/migrations/025_tree_edge_label.sql` — `edge_label` column on `get_session_tree`.

**Modified — read-side / UI**
- `apps/app/src/types/analytics.ts` — latency fields on `AgentStat`/`AgentTimeseriesPoint`; `edge_label` on `SessionTreeNode`.
- `apps/app/src/lib/services/analytics.service.ts` — map the new fields.
- `apps/app/src/lib/__tests__/analytics.service.test.ts`
- `apps/app/src/app/(dashboard)/agents/page.tsx` — latency column + version-gate hint.
- `apps/app/src/app/(dashboard)/agents/[type]/page.tsx` — latency tile + chart.
- `apps/app/src/components/charts/agent-trend-chart.tsx` — dark-mode theming fix (Spec A carry-forward).
- `apps/app/src/lib/graph/spawn-graph.ts` (+ its test) — carry `edgeLabel` onto edges.
- `apps/app/src/components/graph/spawn-graph-view.tsx` — render edge labels.
- `apps/docs/content/docs/plugin-sdk/{event-schema,hook-reference}.mdx`, `apps/docs/content/docs/api-reference/events.mdx` — corrections + new fields.

---

## Task 1: `agent_id` on the Agent `tool_end`

The latency enabler. `post_tool_use.py` already pops the pending entry (which already holds `agent_id`) but never copies it.

**Files:**
- Modify: `claude-plugin/hooks/post_tool_use.py`
- Test: `claude-plugin/tests/test_telemetry.py`

**Interfaces:**
- Produces: `tool_end` events carry `agent_id` when the popped pending entry has one.

- [ ] **Step 1: Write the failing integration test**

Add to `class TestHookIntegration` in `claude-plugin/tests/test_telemetry.py`:

```python
    def _read_events(self, tmp_path):
        tc_dir = tmp_path / ".claude" / "trenchcoat"
        lines = []
        for f in sorted(tc_dir.glob("events-*.jsonl")):
            lines.extend(json.loads(l) for l in f.read_text().splitlines() if l.strip())
        return lines

    def test_agent_tool_end_carries_agent_id(self, tmp_path):
        """PreToolUse(Agent) mints agent_id; PostToolUse must copy it onto tool_end."""
        self._run_hook(tmp_path, "pre_tool_use.py", {
            "session_id": "test-s", "tool_name": "Agent",
            "tool_input": {"description": "d", "prompt": "do the thing"},
        })
        r = self._run_hook(tmp_path, "post_tool_use.py", {
            "session_id": "test-s", "tool_name": "Agent",
            "tool_input": {"description": "d", "prompt": "do the thing"},
            "tool_response": "ok",
        })
        assert r.returncode == 0, f"stderr: {r.stderr}"

        events = self._read_events(tmp_path)
        starts = [e for e in events if e["event"] == "tool_start"]
        ends = [e for e in events if e["event"] == "tool_end"]
        assert starts and ends
        assert starts[0]["data"].get("agent_id"), "tool_start should mint agent_id"
        assert ends[0]["data"].get("agent_id") == starts[0]["data"]["agent_id"], \
            "tool_end must carry the same agent_id as tool_start"

    def test_non_agent_tool_end_has_no_agent_id(self, tmp_path):
        self._run_hook(tmp_path, "pre_tool_use.py", {
            "session_id": "test-s", "tool_name": "Bash", "tool_input": {"command": "echo hi"},
        })
        self._run_hook(tmp_path, "post_tool_use.py", {
            "session_id": "test-s", "tool_name": "Bash",
            "tool_input": {"command": "echo hi"}, "tool_response": "hi",
        })
        ends = [e for e in self._read_events(tmp_path) if e["event"] == "tool_end"]
        assert ends and "agent_id" not in ends[0]["data"]
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd claude-plugin && uv run --with pytest pytest tests/test_telemetry.py -k agent_id -q`
Expected: FAIL — `tool_end` has no `agent_id`.

- [ ] **Step 3: Implement**

In `claude-plugin/hooks/post_tool_use.py`, inside the `if pending:` block add the `agent_id` read, and stamp it after `event_data` is built:

```python
    correlation_id = None
    duration_ms    = None
    agent_id       = None

    if pending:
        correlation_id = pending.get("correlation_id")
        started_ns     = pending.get("started_at")
        agent_id       = pending.get("agent_id")
        if started_ns:
            duration_ms = (time.monotonic_ns() - started_ns) / 1_000_000
```

and after the existing `event_data` dict literal:

```python
    if agent_id:
        event_data["agent_id"] = agent_id
```

(Keep the existing `spawner_id`/`spawner_type` context block and `write_event("tool_end", ...)` call unchanged.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd claude-plugin && uv run --with pytest pytest tests/test_telemetry.py -k agent_id -q`
Expected: PASS. Then the full plugin suite: `cd claude-plugin && uv run --with pytest pytest tests/ -q` — all pass.

- [ ] **Step 5: Commit**

```bash
git add claude-plugin/hooks/post_tool_use.py claude-plugin/tests/test_telemetry.py
git commit -m "feat(plugin): carry agent_id onto Agent tool_end for latency attribution"
```

---

## Task 2: `parse_edge_label` helper + pending support

Pure parsing logic, unit-tested, before any hook wiring.

**Files:**
- Modify: `claude-plugin/lib/telemetry.py`
- Test: `claude-plugin/tests/test_telemetry.py`

**Interfaces:**
- Produces: `parse_edge_label(text) -> tuple[str | None, str]` returning `(label, text_with_marker_removed)`; `push_pending(session_id, tool_name, correlation_id, agent_id=None, edge_label=None)`.

- [ ] **Step 1: Write the failing unit tests**

Add to `claude-plugin/tests/test_telemetry.py`:

```python
class TestParseEdgeLabel:
    def test_parses_each_valid_label(self):
        for label in ("delegate", "verify", "critique"):
            got, rest = telemetry.parse_edge_label(f"[tc:{label}] go do it")
            assert got == label
            assert "[tc:" not in rest

    def test_is_case_insensitive(self):
        got, _ = telemetry.parse_edge_label("[TC:Verify] check this")
        assert got == "verify"

    def test_matches_mid_prompt(self):
        got, rest = telemetry.parse_edge_label("please [tc:critique] this patch")
        assert got == "critique"
        assert rest == "please  this patch".replace("  ", " ") or "[tc:" not in rest

    def test_unknown_label_is_ignored_and_text_untouched(self):
        got, rest = telemetry.parse_edge_label("[tc:bogus] hello")
        assert got is None
        assert rest == "[tc:bogus] hello"

    def test_no_marker_returns_none_and_original_text(self):
        got, rest = telemetry.parse_edge_label("just a prompt")
        assert got is None
        assert rest == "just a prompt"

    def test_first_match_wins(self):
        got, _ = telemetry.parse_edge_label("[tc:verify] then [tc:delegate]")
        assert got == "verify"

    def test_handles_none_and_non_string(self):
        assert telemetry.parse_edge_label(None) == (None, "")
        assert telemetry.parse_edge_label(123)[0] is None


class TestPendingEdgeLabel:
    def test_push_with_edge_label_roundtrip(self, tmp_path, monkeypatch):
        monkeypatch.setenv("HOME", str(tmp_path))
        telemetry.push_pending("s1", "Agent", "corr-1", agent_id="ag-1", edge_label="verify")
        entry = telemetry.pop_pending("s1", "Agent")
        assert entry["edge_label"] == "verify"
        assert entry["agent_id"] == "ag-1"

    def test_push_without_edge_label_has_no_key(self, tmp_path, monkeypatch):
        monkeypatch.setenv("HOME", str(tmp_path))
        telemetry.push_pending("s1", "Agent", "corr-1")
        entry = telemetry.pop_pending("s1", "Agent")
        assert "edge_label" not in entry
```

> Note: `TestPendingEdgeLabel` mirrors the existing `TestPendingStack` fixtures — match how that class sets `HOME`/paths in this file; if it uses a different isolation mechanism, use the same one rather than `monkeypatch.setenv`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd claude-plugin && uv run --with pytest pytest tests/test_telemetry.py -k "EdgeLabel" -q`
Expected: FAIL — `parse_edge_label` does not exist.

- [ ] **Step 3: Implement**

In `claude-plugin/lib/telemetry.py`, add near the other sanitize/helper functions:

```python
EDGE_LABELS = ("delegate", "verify", "critique")
_EDGE_MARKER_RE = re.compile(r"\[tc:([A-Za-z]{1,16})\]")


def parse_edge_label(text) -> tuple[str | None, str]:
    """Extract a [tc:<label>] edge marker from text.

    Returns (label, text_without_marker). Only the three known labels are
    recognized; anything else is ignored and the text is returned unchanged.
    """
    if not isinstance(text, str):
        return None, "" if text is None else str(text)
    match = _EDGE_MARKER_RE.search(text)
    if not match:
        return None, text
    label = match.group(1).lower()
    if label not in EDGE_LABELS:
        return None, text
    cleaned = (text[: match.start()] + text[match.end() :]).strip()
    return label, cleaned
```

Ensure `import re` is present at the top of the module.

Then extend `push_pending` to accept and persist the label:

```python
def push_pending(session_id: str, tool_name: str, correlation_id: str,
                 agent_id: str | None = None, edge_label: str | None = None) -> None:
```

and inside, after the existing `if agent_id:` block:

```python
    if edge_label:
        entry["edge_label"] = edge_label
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd claude-plugin && uv run --with pytest pytest tests/test_telemetry.py -k "EdgeLabel" -q` → PASS.
Then full suite: `cd claude-plugin && uv run --with pytest pytest tests/ -q` → all pass.

- [ ] **Step 5: Commit**

```bash
git add claude-plugin/lib/telemetry.py claude-plugin/tests/test_telemetry.py
git commit -m "feat(plugin): add parse_edge_label helper and pending edge_label support"
```

---

## Task 3: Wire edge labels through the hooks + version bump

**Files:**
- Modify: `claude-plugin/hooks/pre_tool_use.py`, `claude-plugin/hooks/post_tool_use.py`, `claude-plugin/.claude-plugin/plugin.json`
- Test: `claude-plugin/tests/test_telemetry.py`

**Interfaces:**
- Consumes: `parse_edge_label`, `push_pending(..., edge_label=)` (Task 2); `agent_id` copy (Task 1).
- Produces: `edge_label` on `tool_start` and `tool_end` for labeled Agent spawns; marker stripped from `input_preview`.

- [ ] **Step 1: Write the failing integration tests**

Add to `class TestHookIntegration`:

```python
    def test_agent_edge_label_lands_on_start_and_end(self, tmp_path):
        self._run_hook(tmp_path, "pre_tool_use.py", {
            "session_id": "test-s", "tool_name": "Agent",
            "tool_input": {"description": "d", "prompt": "[tc:verify] check the patch"},
        })
        self._run_hook(tmp_path, "post_tool_use.py", {
            "session_id": "test-s", "tool_name": "Agent",
            "tool_input": {"description": "d", "prompt": "[tc:verify] check the patch"},
            "tool_response": "ok",
        })
        events = self._read_events(tmp_path)
        start = next(e for e in events if e["event"] == "tool_start")
        end = next(e for e in events if e["event"] == "tool_end")
        assert start["data"]["edge_label"] == "verify"
        assert end["data"]["edge_label"] == "verify"
        assert "[tc:" not in (start["data"].get("input_preview") or ""), \
            "marker must be stripped from the privacy preview"

    def test_agent_without_marker_has_no_edge_label(self, tmp_path):
        self._run_hook(tmp_path, "pre_tool_use.py", {
            "session_id": "test-s", "tool_name": "Agent",
            "tool_input": {"description": "d", "prompt": "no marker here"},
        })
        start = next(e for e in self._read_events(tmp_path) if e["event"] == "tool_start")
        assert "edge_label" not in start["data"]

    def test_marker_ignored_for_non_agent_tool(self, tmp_path):
        self._run_hook(tmp_path, "pre_tool_use.py", {
            "session_id": "test-s", "tool_name": "Bash",
            "tool_input": {"command": "echo [tc:verify]"},
        })
        start = next(e for e in self._read_events(tmp_path) if e["event"] == "tool_start")
        assert "edge_label" not in start["data"]
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd claude-plugin && uv run --with pytest pytest tests/test_telemetry.py -k "edge_label or marker" -q`
Expected: FAIL — no `edge_label` emitted.

- [ ] **Step 3: Implement in `pre_tool_use.py`**

Import the helper alongside the existing telemetry imports (`parse_edge_label`). Then in the `if tool_name == "Agent":` branch, parse the label from the RAW prompt and rebuild the preview from the cleaned input:

```python
    if tool_name == "Agent":
        edge_label, cleaned_prompt = parse_edge_label(tool_input.get("prompt"))
        if edge_label:
            # Rebuild the preview from input with the marker removed so it
            # neither leaks nor consumes the truncation budget.
            cleaned_input = dict(tool_input)
            cleaned_input["prompt"] = cleaned_prompt
            tool_data["input_preview"] = sanitize_tool_input(cleaned_input, config)
            tool_data["edge_label"] = edge_label

        agent_id = generate_correlation_id()
        tool_data["agent_id"] = agent_id
        push_pending(session_id, tool_name, correlation_id,
                     agent_id=agent_id, edge_label=edge_label)
        write_event("tool_start", session_id, tool_data)
        write_agent_spawn_context(
            parent_session_id=session_id,
            agent_id=agent_id,
            spawner_id=spawner_id,
            spawner_type=spawner_type,
        )
```

- [ ] **Step 4: Implement in `post_tool_use.py`**

Alongside the Task 1 `agent_id` read, add:

```python
        edge_label = pending.get("edge_label")
```
(initialize `edge_label = None` next to `agent_id = None`), and after the `agent_id` stamp:

```python
    if edge_label:
        event_data["edge_label"] = edge_label
```

- [ ] **Step 5: Bump the plugin version**

In `claude-plugin/.claude-plugin/plugin.json`, change `"version": "1.1.0"` to `"version": "1.2.0"`.

- [ ] **Step 6: Run to verify it passes**

Run: `cd claude-plugin && uv run --with pytest pytest tests/ -q`
Expected: all pass (including Task 1 and 2 tests).

- [ ] **Step 7: Commit**

```bash
git add claude-plugin/hooks/pre_tool_use.py claude-plugin/hooks/post_tool_use.py claude-plugin/.claude-plugin/plugin.json claude-plugin/tests/test_telemetry.py
git commit -m "feat(plugin): emit edge_label on Agent spawns; bump plugin to 1.2.0"
```

---

## Task 4: Per-agent latency in the analytics RPCs

**Files:**
- Create: `supabase/migrations/024_agent_latency.sql`
- Modify: `apps/app/src/types/analytics.ts`, `apps/app/src/lib/services/analytics.service.ts`
- Test: `apps/app/src/lib/__tests__/analytics.service.test.ts`

**Interfaces:**
- Produces: `AgentStat` gains `p50_latency_ms`, `p99_latency_ms`, `latency_sample_count`; `AgentTimeseriesPoint` gains `p50_latency_ms`, `latency_sample_count`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/024_agent_latency.sql`. Both functions return `json`, so `create or replace` is sufficient — no drops.

```sql
-- 024: Per-agent latency, attributed via agent_id (Agent tool_result ⋈ subagent_stop).
-- Requires trenchcoat plugin >= 1.2.0, which stamps agent_id onto tool_end.

create or replace function public.get_top_agents(
  p_user_id uuid,
  p_from date,
  p_to date,
  p_limit integer default 20
) returns json as $$
declare
  result json;
  v_period_days integer;
  v_prev_from date;
  v_prev_to date;
begin
  v_period_days := p_to - p_from;
  v_prev_to     := p_from - interval '1 day';
  v_prev_from   := v_prev_to - (v_period_days * interval '1 day');

  select coalesce(json_agg(t), '[]') into result
  from (
    select
      cur.agent_type,
      cur.count,
      round(cur.avg_tool_count::numeric, 1) as avg_tool_count,
      round(cur.avg_turns::numeric, 1) as avg_turns,
      cur.total_input_tokens,
      cur.total_output_tokens,
      round(cur.total_cost_usd::numeric, 6) as total_cost_usd,
      lat.p50_latency_ms,
      lat.p99_latency_ms,
      coalesce(lat.latency_sample_count, 0) as latency_sample_count,
      case
        when prev.count > 0 then
          round(((cur.count::numeric - prev.count::numeric) / prev.count::numeric * 100), 1)
        else null
      end as trend
    from (
      select
        coalesce(nullif(trim(e.data->>'agent_type'), ''), 'general-purpose') as agent_type,
        count(*) as count,
        avg((e.data->>'tool_count_total')::numeric) as avg_tool_count,
        avg((e.data->>'turns')::numeric) as avg_turns,
        sum(coalesce((e.data->>'input_tokens')::numeric, 0)) as total_input_tokens,
        sum(coalesce((e.data->>'output_tokens')::numeric, 0)) as total_output_tokens,
        sum(
          coalesce((e.data->>'input_tokens')::numeric, 0) * coalesce(mp.input_cost_per_1m, 0) / 1000000.0 +
          coalesce((e.data->>'output_tokens')::numeric, 0) * coalesce(mp.output_cost_per_1m, 0) / 1000000.0
        ) as total_cost_usd
      from public.events e
      left join public.model_pricing mp on mp.model_id = (e.data->>'model')
      where e.user_id = p_user_id
        and e.timestamp::date between p_from and p_to
        and e.event_type = 'subagent_stop'
      group by coalesce(nullif(trim(e.data->>'agent_type'), ''), 'general-purpose')
    ) cur
    left join (
      select
        coalesce(nullif(trim(data->>'agent_type'), ''), 'general-purpose') as agent_type,
        count(*) as count
      from public.events
      where user_id = p_user_id
        and timestamp::date between v_prev_from and v_prev_to
        and event_type = 'subagent_stop'
      group by coalesce(nullif(trim(data->>'agent_type'), ''), 'general-purpose')
    ) prev on prev.agent_type = cur.agent_type
    left join (
      select
        coalesce(nullif(trim(ss.data->>'agent_type'), ''), 'general-purpose') as agent_type,
        round(percentile_cont(0.5)  within group (order by tr.duration_ms)::numeric, 0) as p50_latency_ms,
        round(percentile_cont(0.99) within group (order by tr.duration_ms)::numeric, 0) as p99_latency_ms,
        count(*) as latency_sample_count
      from public.events tr
      join public.events ss
        on  ss.user_id    = tr.user_id
        and ss.session_id = tr.session_id
        and ss.event_type = 'subagent_stop'
        and ss.data->>'agent_id' = tr.data->>'agent_id'
      where tr.user_id    = p_user_id
        and tr.event_type = 'tool_result'
        and tr.tool_name  = 'Agent'
        and tr.duration_ms is not null
        and tr.data->>'agent_id' is not null
        and tr.timestamp::date between p_from and p_to
      group by coalesce(nullif(trim(ss.data->>'agent_type'), ''), 'general-purpose')
    ) lat on lat.agent_type = cur.agent_type
    order by cur.count desc
    limit p_limit
  ) t;

  return result;
end;
$$ language plpgsql security definer;


create or replace function public.get_agent_timeseries(
  p_user_id    uuid,
  p_agent_type text,
  p_from       date,
  p_to         date
) returns json as $$
declare
  result json;
begin
  select coalesce(json_agg(t order by t.bucket), '[]') into result
  from (
    select
      b.bucket,
      b.invocations,
      b.input_tokens,
      b.output_tokens,
      b.cost_usd,
      lat.p50_latency_ms,
      coalesce(lat.latency_sample_count, 0) as latency_sample_count
    from (
      select
        e.timestamp::date as bucket,
        count(*) as invocations,
        sum(coalesce((e.data->>'input_tokens')::numeric, 0))::bigint  as input_tokens,
        sum(coalesce((e.data->>'output_tokens')::numeric, 0))::bigint as output_tokens,
        round(sum(
          coalesce((e.data->>'input_tokens')::numeric, 0)  * coalesce(mp.input_cost_per_1m, 0)  / 1000000.0 +
          coalesce((e.data->>'output_tokens')::numeric, 0) * coalesce(mp.output_cost_per_1m, 0) / 1000000.0
        )::numeric, 6) as cost_usd
      from public.events e
      left join public.model_pricing mp on mp.model_id = (e.data->>'model')
      where e.user_id    = p_user_id
        and e.event_type = 'subagent_stop'
        and coalesce(nullif(trim(e.data->>'agent_type'), ''), 'general-purpose') = p_agent_type
        and e.timestamp::date between p_from and p_to
      group by e.timestamp::date
    ) b
    left join (
      select
        tr.timestamp::date as bucket,
        round(percentile_cont(0.5) within group (order by tr.duration_ms)::numeric, 0) as p50_latency_ms,
        count(*) as latency_sample_count
      from public.events tr
      join public.events ss
        on  ss.user_id    = tr.user_id
        and ss.session_id = tr.session_id
        and ss.event_type = 'subagent_stop'
        and ss.data->>'agent_id' = tr.data->>'agent_id'
      where tr.user_id    = p_user_id
        and tr.event_type = 'tool_result'
        and tr.tool_name  = 'Agent'
        and tr.duration_ms is not null
        and tr.data->>'agent_id' is not null
        and coalesce(nullif(trim(ss.data->>'agent_type'), ''), 'general-purpose') = p_agent_type
        and tr.timestamp::date between p_from and p_to
      group by tr.timestamp::date
    ) lat on lat.bucket = b.bucket
  ) t;
  return result;
end;
$$ language plpgsql security definer;
```

- [ ] **Step 2: Extend the types**

In `apps/app/src/types/analytics.ts`:

```ts
// AgentStat: add
  p50_latency_ms: number | null;
  p99_latency_ms: number | null;
  latency_sample_count: number;

// AgentTimeseriesPoint: add
  p50_latency_ms: number | null;
  latency_sample_count: number;
```

- [ ] **Step 3: Write the failing service tests**

Add to `apps/app/src/lib/__tests__/analytics.service.test.ts`:

```ts
describe("getTopAgents latency fields", () => {
  it("maps latency fields through", async () => {
    const rows = [{
      agent_type: "searcher", count: 12, avg_tool_count: 6, avg_turns: 4, trend: null,
      total_input_tokens: 100, total_output_tokens: 20, total_cost_usd: 0.42,
      p50_latency_ms: 1200, p99_latency_ms: 4300, latency_sample_count: 12,
    }];
    const supabase = createMockSupabase({}, { get_top_agents: { data: rows } });
    const result = await getTopAgents(supabase, USER_ID, FROM, TO, 50);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data[0].p50_latency_ms).toBe(1200);
      expect(result.data[0].p99_latency_ms).toBe(4300);
      expect(result.data[0].latency_sample_count).toBe(12);
    }
  });

  it("defaults missing latency to null/0 (old plugin data)", async () => {
    const rows = [{
      agent_type: "old", count: 3, avg_tool_count: 1, avg_turns: 1, trend: null,
      total_input_tokens: 0, total_output_tokens: 0, total_cost_usd: 0,
    }];
    const supabase = createMockSupabase({}, { get_top_agents: { data: rows } });
    const result = await getTopAgents(supabase, USER_ID, FROM, TO, 50);
    if (result.success) {
      expect(result.data[0].p50_latency_ms).toBeNull();
      expect(result.data[0].latency_sample_count).toBe(0);
    }
  });
});

describe("getAgentTimeseries latency fields", () => {
  it("maps p50 latency and sample count", async () => {
    const rows = [{
      bucket: "2025-04-01", invocations: 3, input_tokens: 10, output_tokens: 2,
      cost_usd: 0.05, p50_latency_ms: 900, latency_sample_count: 3,
    }];
    const supabase = createMockSupabase({}, { get_agent_timeseries: { data: rows } });
    const result = await getAgentTimeseries(supabase, USER_ID, "searcher", FROM, TO);
    if (result.success) {
      expect(result.data[0].p50_latency_ms).toBe(900);
      expect(result.data[0].latency_sample_count).toBe(3);
    }
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `cd apps/app && bun test src/lib/__tests__/analytics.service.test.ts`
Expected: FAIL — latency fields undefined.

- [ ] **Step 5: Map the fields in the service**

In `getTopAgents`'s row mapping add:

```ts
    p50_latency_ms: (row.p50_latency_ms as number | null) ?? null,
    p99_latency_ms: (row.p99_latency_ms as number | null) ?? null,
    latency_sample_count: (row.latency_sample_count as number) ?? 0,
```

In `getAgentTimeseries`'s row mapping add:

```ts
    p50_latency_ms: (row.p50_latency_ms as number | null) ?? null,
    latency_sample_count: (row.latency_sample_count as number) ?? 0,
```

- [ ] **Step 6: Run tests + manual SQL smoke**

Run: `cd apps/app && bun test src/lib/__tests__/analytics.service.test.ts` → PASS.
Apply migration locally; in `psql`: `select public.get_top_agents('<user-uuid>','2026-06-01','2026-07-19',10);`
Expected: objects now include `p50_latency_ms`/`p99_latency_ms`/`latency_sample_count` (nulls/0 are valid if no v1.2.0 data exists yet).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/024_agent_latency.sql apps/app/src/types/analytics.ts apps/app/src/lib/services/analytics.service.ts apps/app/src/lib/__tests__/analytics.service.test.ts
git commit -m "feat(agents): add per-agent latency percentiles via agent_id join"
```

---

## Task 5: `edge_label` on `get_session_tree`

**Files:**
- Create: `supabase/migrations/025_tree_edge_label.sql`
- Modify: `apps/app/src/types/analytics.ts`
- Test: `apps/app/src/lib/__tests__/analytics.service.test.ts`

**Interfaces:**
- Produces: `SessionTreeNode` gains `edge_label: string | null` — the label of the spawn that created this node.

- [ ] **Step 1: Write the migration**

`get_session_tree` returns `TABLE(...)`, so the return-column change REQUIRES a drop first. Create `supabase/migrations/025_tree_edge_label.sql` — copy the full function body from `024`'s predecessor (`supabase/migrations/023_tree_cost.sql`) and add the one join + column:

```sql
-- 025: expose the spawn edge_label on each session-tree node.
drop function if exists public.get_session_tree(uuid, text);
create or replace function public.get_session_tree(
  p_user_id    uuid,
  p_session_id text
) returns table (
  session_id         text,
  parent_session_id  text,
  spawner_id         text,
  spawner_type       text,
  depth              int,
  started_at         timestamptz,
  ended_at           timestamptz,
  duration_ms        bigint,
  tool_count         bigint,
  skill_count        bigint,
  subagent_count     bigint,
  input_tokens       bigint,
  output_tokens      bigint,
  estimated_cost_usd numeric,
  edge_label         text
) language sql stable as $$
  with recursive tree as (
    select s.session_id, s.parent_session_id, s.spawner_id, s.spawner_type,
           0 as depth, s.started_at, s.ended_at
    from public.sessions s
    where s.session_id = p_session_id and s.user_id = p_user_id
    union all
    select s.session_id, s.parent_session_id, s.spawner_id, s.spawner_type,
           t.depth + 1, s.started_at, s.ended_at
    from public.sessions s
    join tree t on s.parent_session_id = t.session_id
    where s.user_id = p_user_id
  )
  select
    t.session_id, t.parent_session_id, t.spawner_id, t.spawner_type, t.depth,
    t.started_at, t.ended_at,
    coalesce(max(s2.duration_ms), 0)::bigint                   as duration_ms,
    count(e.id) filter (where e.event_type = 'tool_use')       as tool_count,
    count(e.id) filter (where e.event_type = 'skill_use')      as skill_count,
    count(e.id) filter (where e.event_type = 'subagent_stop')  as subagent_count,
    coalesce(max(s2.input_tokens),  0)::bigint                 as input_tokens,
    coalesce(max(s2.output_tokens), 0)::bigint                 as output_tokens,
    round((
      coalesce(max(s2.input_tokens),  0) * coalesce(max(mp.input_cost_per_1m),  0) / 1000000.0 +
      coalesce(max(s2.output_tokens), 0) * coalesce(max(mp.output_cost_per_1m), 0) / 1000000.0
    )::numeric, 6) as estimated_cost_usd,
    max(el.edge_label) as edge_label
  from tree t
  left join public.events e   on e.session_id  = t.session_id and e.user_id = p_user_id
  left join public.sessions s2 on s2.session_id = t.session_id and s2.user_id = p_user_id
  left join public.model_pricing mp on mp.model_id = s2.model
  left join lateral (
    select ev.data->>'edge_label' as edge_label
    from public.events ev
    where ev.user_id = p_user_id
      and ev.event_type in ('tool_use', 'tool_result')
      and ev.data->>'agent_id' = t.spawner_id
      and ev.data->>'edge_label' is not null
    limit 1
  ) el on true
  group by t.session_id, t.parent_session_id, t.spawner_id, t.spawner_type,
           t.depth, t.started_at, t.ended_at
  order by t.depth, t.started_at;
$$;
```

Note the lateral join keys on `t.spawner_id = <agent_id>`, which is exactly how `write_agent_spawn_context` links a child session to its spawning Agent call. Nodes with `spawner_type <> 'agent'` (or no label) yield `null`.

- [ ] **Step 2: Extend the type**

In `apps/app/src/types/analytics.ts`, add to `SessionTreeNode`:

```ts
  edge_label: string | null;
```

- [ ] **Step 3: Write the failing service test**

Add to `apps/app/src/lib/__tests__/analytics.service.test.ts`:

```ts
describe("getSessionTree edge_label", () => {
  it("passes edge_label through", async () => {
    const rows = [{
      session_id: "child", parent_session_id: "root", spawner_id: "ag-1", spawner_type: "agent",
      depth: 1, started_at: "2025-04-01T00:00:00Z", ended_at: null, duration_ms: 10,
      tool_count: 0, skill_count: 0, subagent_count: 0,
      input_tokens: 0, output_tokens: 0, estimated_cost_usd: 0, edge_label: "verify",
    }];
    const supabase = createMockSupabase({}, { get_session_tree: { data: rows } });
    const result = await getSessionTree(supabase, USER_ID, "root");
    if (result.success) expect(result.data[0].edge_label).toBe("verify");
  });
});
```

- [ ] **Step 4: Run to verify it fails, then passes**

Run: `cd apps/app && bun test src/lib/__tests__/analytics.service.test.ts`
Expected: FAIL on the type/field until the migration + type are in place. `getSessionTree` casts rows directly (`data as SessionTreeNode[]`), so once the type has `edge_label` the test passes with no service-code change — confirm that is the case; if the service maps fields explicitly, add the mapping.

- [ ] **Step 5: Manual SQL smoke**

Apply migration; `select * from public.get_session_tree('<user-uuid>','<root-session-id>');` → includes an `edge_label` column (null for unlabeled/legacy spawns).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/025_tree_edge_label.sql apps/app/src/types/analytics.ts apps/app/src/lib/__tests__/analytics.service.test.ts
git commit -m "feat(graph): expose spawn edge_label on session tree nodes"
```

---

## Task 6: Agents page — latency column + plugin-upgrade hint

**Files:**
- Modify: `apps/app/src/app/(dashboard)/agents/page.tsx`
- Create: `apps/app/src/lib/format/__tests__/latency.test.ts`, add `formatLatency` to `apps/app/src/lib/format/agents.ts`

**Interfaces:**
- Produces: `formatLatency(ms: number | null, sampleCount: number): string`.

- [ ] **Step 1: Write the failing formatter test**

Create `apps/app/src/lib/format/__tests__/latency.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { formatLatency } from "../agents";

describe("formatLatency", () => {
  it("renders seconds with one decimal at/above 1000ms", () => {
    expect(formatLatency(4300, 10)).toBe("4.3s");
  });
  it("renders milliseconds below 1000ms", () => {
    expect(formatLatency(850, 10)).toBe("850ms");
  });
  it("renders -- when null", () => {
    expect(formatLatency(null, 0)).toBe("--");
  });
  it("renders -- when there are no samples", () => {
    expect(formatLatency(1200, 0)).toBe("--");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/app && bun test src/lib/format/__tests__/latency.test.ts` → FAIL (no export).

- [ ] **Step 3: Implement the formatter**

Append to `apps/app/src/lib/format/agents.ts`:

```ts
export function formatLatency(ms: number | null, sampleCount: number): string {
  if (ms === null || Number.isNaN(ms) || sampleCount <= 0) return "--";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/app && bun test src/lib/format/__tests__/latency.test.ts` → PASS.

- [ ] **Step 5: Add the column + hint to the page**

In `apps/app/src/app/(dashboard)/agents/page.tsx`:
- Import `formatLatency`.
- Add a header `<TableHead className="text-right">Latency p50 / p99</TableHead>` after the Tokens column, and bump the empty-state `colSpan` from 7 to 8.
- Add the matching cell after the Tokens cell:

```tsx
<TableCell className="text-right">
  {formatLatency(stat.p50_latency_ms, stat.latency_sample_count)}
  {" / "}
  {formatLatency(stat.p99_latency_ms, stat.latency_sample_count)}
</TableCell>
```

- Above the "Top Agents" card, render the upgrade hint when nothing has latency yet:

```tsx
{agents.length > 0 && agents.every((a) => a.latency_sample_count === 0) && (
  <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
    Per-agent latency needs Trenchcoat plugin v1.2.0 or newer. Update the plugin to start
    capturing it — existing data is unaffected.
  </div>
)}
```

- [ ] **Step 6: Typecheck**

Run: `cd apps/app && bunx tsc --noEmit` — no NEW errors above the pre-existing `bun:test` baseline. Note the app visual check is manual/pending.

- [ ] **Step 7: Commit**

```bash
git add apps/app/src/lib/format/ apps/app/src/app/\(dashboard\)/agents/page.tsx
git commit -m "feat(agents): show per-agent latency column with plugin upgrade hint"
```

---

## Task 7: Drill-down latency tile + chart (and dark-mode chart fix)

**Files:**
- Modify: `apps/app/src/app/(dashboard)/agents/[type]/page.tsx`, `apps/app/src/components/charts/agent-trend-chart.tsx`, `apps/app/src/lib/analytics/agent-timeseries.ts` (+ its test)

**Interfaces:**
- Consumes: `formatLatency` (Task 6), `AgentTimeseriesPoint.p50_latency_ms` (Task 4).
- Produces: `summariseAgentTimeseries` gains `medianLatencyMs: number | null` and `latencySampleCount: number`.

- [ ] **Step 1: Write the failing summary test**

Add to `apps/app/src/lib/analytics/__tests__/agent-timeseries.test.ts`:

```ts
it("summarises latency across buckets with samples", () => {
  const s = summariseAgentTimeseries([
    { bucket: "d1", invocations: 1, input_tokens: 0, output_tokens: 0, cost_usd: 0,
      p50_latency_ms: 1000, latency_sample_count: 2 },
    { bucket: "d2", invocations: 1, input_tokens: 0, output_tokens: 0, cost_usd: 0,
      p50_latency_ms: 2000, latency_sample_count: 2 },
  ]);
  expect(s.latencySampleCount).toBe(4);
  expect(s.medianLatencyMs).toBeCloseTo(1500); // sample-weighted mean of bucket medians
});

it("returns null latency when no samples exist", () => {
  const s = summariseAgentTimeseries([
    { bucket: "d1", invocations: 1, input_tokens: 0, output_tokens: 0, cost_usd: 0,
      p50_latency_ms: null, latency_sample_count: 0 },
  ]);
  expect(s.medianLatencyMs).toBeNull();
  expect(s.latencySampleCount).toBe(0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/app && bun test src/lib/analytics/__tests__/agent-timeseries.test.ts` → FAIL.

- [ ] **Step 3: Extend the summary**

In `apps/app/src/lib/analytics/agent-timeseries.ts`, add to `AgentTimeseriesSummary`:

```ts
  medianLatencyMs: number | null;
  latencySampleCount: number;
```

and compute a sample-weighted mean of the per-bucket medians (an approximation of the overall median — documented as such):

```ts
  let latencyWeighted = 0;
  let latencySamples = 0;
  for (const p of points) {
    if (p.p50_latency_ms !== null && p.latency_sample_count > 0) {
      latencyWeighted += p.p50_latency_ms * p.latency_sample_count;
      latencySamples += p.latency_sample_count;
    }
  }
```

then include in the returned object:

```ts
    medianLatencyMs: latencySamples > 0 ? latencyWeighted / latencySamples : null,
    latencySampleCount: latencySamples,
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/app && bun test src/lib/analytics/__tests__/agent-timeseries.test.ts` → PASS.

- [ ] **Step 5: Fix the chart's theming and allow a latency series**

In `apps/app/src/components/charts/agent-trend-chart.tsx`, widen the `dataKey` union to include `"p50_latency_ms"`, and bring the tooltip/axes in line with the sibling `agent-calls-chart.tsx` (read that file and copy its theming approach — `contentStyle` using `--color-popover`/`--color-border`/`--color-popover-foreground`, and axis `tick={{ fill: "var(--color-muted-foreground)" }}` with `className="text-xs"`). This closes the Spec A carry-forward Minor.

- [ ] **Step 6: Add the tile + chart to the drill-down**

In `apps/app/src/app/(dashboard)/agents/[type]/page.tsx`: import `formatLatency`; add a fifth stat tile `<Stat label="Median Latency" value={formatLatency(summary.medianLatencyMs, summary.latencySampleCount)} />`; and, when `summary.latencySampleCount > 0`, add a third chart card "Latency (p50) per day" using `<AgentTrendChart data={points} dataKey="p50_latency_ms" label="ms" />`.

- [ ] **Step 7: Typecheck + commit**

Run: `cd apps/app && bunx tsc --noEmit` (no new errors) and `bun test src/lib/analytics/__tests__/agent-timeseries.test.ts`.

```bash
git add apps/app/src/lib/analytics/ apps/app/src/components/charts/agent-trend-chart.tsx apps/app/src/app/\(dashboard\)/agents/\[type\]/page.tsx
git commit -m "feat(agents): add latency tile and trend to drill-down; theme trend chart"
```

---

## Task 8: Labeled edges in the spawn graph

**Files:**
- Modify: `apps/app/src/lib/graph/spawn-graph.ts` (+ `__tests__/spawn-graph.test.ts`), `apps/app/src/components/graph/spawn-graph-view.tsx`

**Interfaces:**
- Produces: `SpawnGraphEdge` gains `label: string | null`.

- [ ] **Step 1: Write the failing transform test**

Add to `apps/app/src/lib/graph/__tests__/spawn-graph.test.ts` (the local `node()` helper builds `SessionTreeNode`s — add `edge_label: p.edge_label ?? null` to it first):

```ts
it("carries a node's edge_label onto its inbound edge", () => {
  const tree = [
    node({ session_id: "root", depth: 0 }),
    node({ session_id: "a", parent_session_id: "root", depth: 1, edge_label: "verify" }),
    node({ session_id: "b", parent_session_id: "root", depth: 1 }),
  ];
  const g = buildSpawnGraph(tree);
  const ea = g.edges.find((e) => e.target === "a")!;
  const eb = g.edges.find((e) => e.target === "b")!;
  expect(ea.label).toBe("verify");
  expect(eb.label).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/app && bun test src/lib/graph/__tests__/spawn-graph.test.ts` → FAIL.

- [ ] **Step 3: Implement**

In `apps/app/src/lib/graph/spawn-graph.ts`, add `label: string | null;` to `SpawnGraphEdge`, and set it when building edges (the label belongs to the CHILD node, since it describes the spawn that created it):

```ts
    .map((n) => ({
      id: `${n.parent_session_id}->${n.session_id}`,
      source: n.parent_session_id as string,
      target: n.session_id,
      label: n.edge_label ?? null,
    }));
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/app && bun test src/lib/graph/__tests__/spawn-graph.test.ts` → all pass (previous cases plus the new one).

- [ ] **Step 5: Render labels in the view**

In `apps/app/src/components/graph/spawn-graph-view.tsx`, pass the label to react-flow's edge (`label: e.label ?? undefined`) and style it theme-awarely, e.g.:

```tsx
    const rawEdges: Edge[] = graph.edges.map((e) => ({
      id: e.id, source: e.source, target: e.target, animated: false,
      label: e.label ?? undefined,
      labelStyle: { fontSize: 10, fill: "var(--color-muted-foreground)" },
      labelBgStyle: { fill: "var(--color-background)" },
    }));
```

- [ ] **Step 6: Typecheck + commit**

Run: `cd apps/app && bunx tsc --noEmit` (no new errors).

```bash
git add apps/app/src/lib/graph/ apps/app/src/components/graph/spawn-graph-view.tsx
git commit -m "feat(graph): render spawn edge labels on the graph"
```

---

## Task 9: Correct and extend the plugin-SDK docs

The existing docs are materially wrong; fix them while documenting the new fields.

**Files:**
- Modify: `apps/docs/content/docs/plugin-sdk/event-schema.mdx`, `apps/docs/content/docs/plugin-sdk/hook-reference.mdx`, `apps/docs/content/docs/api-reference/events.mdx`

- [ ] **Step 1: Correct `event-schema.mdx`**

Against the real emitters (`claude-plugin/hooks/*.py`, `claude-plugin/lib/telemetry.py`) — read them and make the doc match:
- `tool_use`: key is **`input_preview`** (not `tool_input_preview`), truncated to **100** chars by default (config `privacy.tool_input_preview_chars`), plus `correlation_id`, optional `spawner_id`/`spawner_type`, and for the Agent tool `agent_id` and optional **`edge_label`**.
- `tool_result`: `tool_name`, `correlation_id`, `duration_ms`, `result_size`, optional `spawner_id`/`spawner_type`, and for Agent **`agent_id`** and optional **`edge_label`** (new in plugin 1.2.0).
- `subagent_stop`: real keys are `agent_type`, `reason`, `tool_counts`, `tool_count_total`, `turns`, `input_tokens`, `output_tokens`, `model`, optional `agent_id` — replace the fictional `{subagent_id, model, tokens_used}`.

- [ ] **Step 2: Correct `hook-reference.mdx`**

- Remove the nonexistent `Notification` hook; list the real eight from `claude-plugin/hooks/hooks.json`: `SessionStart`, `SessionEnd`, `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `SubagentStop`, `PreCompact`, and note `SubagentStop` has its own `subagent_stop.py` (not folded into `stop.py`).
- Fix "500 characters" → 100.
- Fix the claim that hook input arrives "as environment variables" → it is **JSON on stdin** (`telemetry.read_hook_input`).

- [ ] **Step 3: Fix `events.mdx`** — replace `tool_input_preview` with `input_preview`.

- [ ] **Step 4: Document the edge-label convention**

In `event-schema.mdx`, add a short section: a spawning agent may embed `[tc:delegate]`, `[tc:verify]`, or `[tc:critique]` anywhere in a Task prompt; the plugin records it as `edge_label` and strips the marker from the stored preview. Unknown markers are ignored. Requires plugin ≥ 1.2.0.

- [ ] **Step 5: Verify + commit**

Re-read each edited section against the actual hook source to confirm every documented field name exists in code.

```bash
git add apps/docs/content/docs/
git commit -m "docs: correct plugin-sdk event/hook reference and document edge labels"
```

---

## Self-Review

**Spec coverage:**
- §4.1 `agent_id` on tool_end → Task 1 ✓
- §4.2 edge-label parse/strip/propagate + marker enum → Tasks 2, 3 ✓
- §4.3 latency percentiles in both json-returning RPCs (no drop) → Task 4 ✓
- §4.4 `edge_label` on `get_session_tree` (with required drop) → Task 5 ✓
- §4.5 Agents latency column, drill-down tile/chart, graph edge labels, version-gate hint → Tasks 6, 7, 8 ✓
- §4.6 docs corrections + new-field docs → Task 9 ✓
- §3 plugin version bump 1.1.0→1.2.0 → Task 3 ✓
- §7 edge cases: null latency → `--` (Task 6 formatter, tested); zero samples suppress percentiles (Task 6); orphaned tool_result excluded (Task 4 inner join); marker ignored for non-Agent tools (Task 3, tested) ✓
- §8.2 AgentTrendChart dark-mode fix → Task 7 ✓

**Placeholder scan:** none — every code step carries real code; Task 5 Step 1 and Task 7 Step 5 direct the implementer to copy from a named existing file rather than inventing.

**Type consistency:** `AgentStat`/`AgentTimeseriesPoint` latency fields defined Task 4, consumed Tasks 6/7; `SessionTreeNode.edge_label` defined Task 5, consumed Task 8; `SpawnGraphEdge.label` defined and consumed within Task 8; `formatLatency` defined Task 6, consumed Tasks 6/7; `parse_edge_label`/`push_pending(edge_label=)` defined Task 2, consumed Task 3.

**Known deferrals (not gaps):** retroactive backfill is impossible for pre-1.2.0 events (spec §3); Spec A carry-forwards `get_entity_rollup` wiring and the drill-down's tool-fingerprint/recent-invocations remain open for a later slice.
