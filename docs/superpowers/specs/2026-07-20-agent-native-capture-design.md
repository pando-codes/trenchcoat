# Spec D1 — Agent-Native Capture

**Date:** 2026-07-20
**Status:** Draft (awaiting review)
**Slice:** D1 of 2 (D2 = agent-native lineage storage + spawn-graph re-base)
**Supersedes (partially):** the session-parentage model in `2026-07-19-agent-observability-core-design.md` and the correlation assumptions in `2026-07-19-edge-semantics-latency-design.md`

## 1. Problem

Trenchcoat's plugin reconstructs, with stateful guesswork, several identifiers that Claude Code supplies natively — and reads two keys that do not exist. The result is silently wrong or absent data.

Verified against the Claude Code 2.1.215 binary's own hook schemas and 24 days of captured telemetry:

| What the plugin does | What is actually true |
|---|---|
| Correlates Pre→Post via a LIFO pending stack keyed by `tool_name` | **`tool_use_id` is a required field on BOTH PreToolUse and PostToolUse** — globally unique per call |
| Computes duration with `time.monotonic_ns()` across two separate processes | PostToolUse supplies **`duration_ms`** directly (schema-optional — see §6) |
| `subagent_stop.py` *guesses* the agent via `peek_pending_by_tool` | **SubagentStop carries a required `agent_id`** |
| Reads `hook_input["stop_hook_reason"]` | **That key does not exist.** Zero occurrences in the 247MB binary. The real key is `stop_hook_active`. All **161** captured `subagent_stop` events read `reason: "unknown"` — the field has never once worked |
| Passes parentage to children via a global `.agent_spawn_context.json` | **Dead code.** Subagents are not sessions and never fire `SessionStart`, so nothing ever reads it |
| Attributes every tool call to the parent session | Base hook input carries **`agent_id`/`agent_type`** whenever a hook fires *inside* a subagent. In one session, **1,214 of 1,424 tool calls were subagent calls**, all collapsed into the parent |
| `sanitize_tool_result` reduces the Agent result to a byte count | That result contains `agentId`, `totalTokens`, `totalDurationMs`, `toolStats`, `resolvedModel` — all discarded |

Two further defects: `push_pending`/`pop_pending` perform an **unlocked read-modify-write** of a shared JSON file (while `write_event` correctly uses `flock`) — a real lost-update race with ~1,400 events per session; and the `SubagentStart` hook exists but is not registered.

**Correction to the record:** Spec B documented a parallel-spawn mis-attribution bug. Investigation shows true fan-out (multiple Agent calls in one assistant turn) does not occur in any captured data, and for the strict nesting that does occur **LIFO is accidentally correct** (68/68 Agent calls correctly paired). The bug is *latent*, not manifest. Where it **is** demonstrably broken today is **background/async agents**: the Agent tool returns in ~37ms while the child runs for minutes, so by the time `SubagentStop` fires the pending entry is long gone — `peek_pending_by_tool` yields `None`, or shares one wrong id across siblings.

## 2. Scope

**In scope — capture only.** This slice makes the plugin emit truthful, natively-keyed data. It changes no read-side RPC, no dashboard, and no existing DB column.

- Emit `tool_use_id` on `tool_start`/`tool_end`.
- Prefer Claude Code's native `duration_ms`; fall back to the existing computation (§6).
- Emit base `agent_id`/`agent_type` on **every** event, so subagent-originated activity is attributable.
- `subagent_stop`: read the real `agent_id`; replace `stop_hook_reason` with `stop_hook_active`.
- On the Agent `tool_end`, capture `agentId` plus the numeric/enum result metrics (`totalTokens`, `totalDurationMs`, `toolStats`, `resolvedModel`, `status`) — never prompt or content text.
- Register the `SubagentStart` hook (`agent_id`, `agent_type`).
- Re-key the pending map on `tool_use_id` and guard it with `flock`.
- Delete the dead spawn-context code (`write_/read_/clear_agent_spawn_context`) and the `parent_session_id`/`agent_id` fields it fed onto `session_start`.
- Bump plugin `1.2.0` → `1.3.0`.

**Out of scope**
- Storage, RPCs, dashboard, and the spawn-graph re-base → **D2**.
- Retroactive repair of historical events (the 161 `reason: "unknown"` rows stay wrong; nothing can recover them).
- Removing the pending mechanism entirely (blocked on §6's verification; deleting it is a D2-or-later follow-up).

## 3. Design

### 3.1 Correlation: `tool_use_id`

`pre_tool_use.py` and `post_tool_use.py` both read `hook_input["tool_use_id"]` and emit it in event `data`. The pending map becomes a **dict keyed by `tool_use_id`** rather than a LIFO list, making ordering irrelevant under arbitrary parallelism *and* nesting. All reads/writes of the pending file are wrapped in `flock`, matching `write_event`.

`correlation_id` continues to be emitted for one release so existing read-side queries keep working; `tool_use_id` is the field new work should join on.

### 3.2 Duration

Prefer `hook_input.get("duration_ms")`. If absent, fall back to the existing monotonic computation from the pending entry. Emit which source was used (`duration_source: "native" | "computed"`) so §6 can be settled empirically in production rather than guessed.

### 3.3 Subagent attribution

Every `write_event` call site gains the base-input `agent_id`/`agent_type` when present. Their presence *is* the signal that the event originated inside a subagent (per Claude Code's own schema note: use `agent_id`, not `agent_type`, to distinguish subagent calls — `agent_type` is also set on the main thread of `--agent` sessions).

This is what makes D2's lineage possible: it converts "1,214 anonymous tool calls" into attributable per-agent activity.

### 3.4 SubagentStop and SubagentStart

`subagent_stop.py` reads the required `agent_id` directly instead of peeking the pending stack, and reads `stop_hook_active` (boolean) in place of the nonexistent `stop_hook_reason`. The emitted field is renamed `stop_hook_active` — the old `reason` field is dropped rather than kept with a permanently-wrong value.

A new `subagent_start.py` hook emits `agent_id` + `agent_type` at spawn time, giving D2 a spawn-time record independent of completion.

### 3.5 Agent result metrics

`post_tool_use.py`, for `tool_name == "Agent"` only, extracts a bounded allowlist from `tool_response`:

`agentId`, `status`, `resolvedModel`, `totalDurationMs`, `totalTokens`, `totalToolUseCount`, `toolStats`, `isAsync`.

**Allowlist, never passthrough** — `prompt`, `content`, `description`, and `outputFile` are explicitly excluded from `agent_result`, preserving the plugin's `log_prompt_content: False` stance. The async result shape differs from the synchronous one (`status: "async_launched"` carries no `totalTokens`/`toolStats`), so every field is optional and absence is normal. This "never captured" guarantee is scoped to `agent_result` specifically, not to the Agent tool event pair as a whole: `tool_start.input_preview` still JSON-serializes the full Agent `tool_input`, so the first ~100 characters — covering `description` and the start of the caller's `prompt` — are captured there, governed by the existing `tool_input_preview_chars` privacy setting like any other tool.

This matters beyond convenience: transcript parsing — today's only token source — **fails on ~20% of subagent stops** (`agent_type: ''` with zero tokens/turns). These metrics come straight from the source.

### 3.6 Deleting the dead path

`write_agent_spawn_context`, `read_agent_spawn_context`, `clear_agent_spawn_context`, and their `session_start.py` consumers are removed, along with the `parent_session_id`/`agent_id` fields they wrote onto `session_start`. Nothing reads them: subagents never fire `SessionStart`, and `parent_session_id` has **zero real occurrences across all 24 captured event files**.

Risk acknowledged: if some other Claude Code entrypoint (SDK-spawned agent, `claude --agent`) did start a real child session, this would remove its parentage. No such case appears in any captured data. D2 re-establishes lineage on the correct key (`agent_id` → `parentAgentId`) regardless.

## 4. What this does NOT fix

Being explicit, because Spec A and B both shipped on the broken model:

- **The spawn graph stays empty after this slice.** It renders session trees, and subagents are not sessions. D2 re-bases it on agent lineage.
- **Spec B's edge-label join stays inert** for the same reason. D2 re-points it at `agent_id`.
- Historical data is not repaired.

## 5. Testing

The plugin has a real pytest suite (`claude-plugin/tests/test_telemetry.py`, `uv run --with pytest pytest tests/`, 117 passing) with a subprocess hook-integration harness (`_run_hook`). Required coverage:

- `tool_use_id` emitted on both `tool_start` and `tool_end`, and equal across the pair.
- Pending correlation is correct when two Agent calls **interleave out of LIFO order** (the case today's stack gets wrong) — the regression test that would have caught this.
- Native `duration_ms` preferred; fallback used and `duration_source` labelled correctly when absent.
- Base `agent_id`/`agent_type` emitted when present, absent when not.
- `subagent_stop` carries the payload's `agent_id`; emits `stop_hook_active`; no `reason` key.
- Agent result allowlist: metrics captured for both the sync and async shapes; `prompt`/`content`/`outputFile` never present in any emitted event.
- `subagent_start` emits `agent_id`/`agent_type`.
- Concurrency: parallel `push_pending`/`pop_pending` under `flock` lose no entries.
- Non-Agent tools unaffected throughout.

## 6. Open question for planning

**Is native `duration_ms` reliably present?** It is `optional` in Claude Code's schema, and captured data cannot answer this — no deployed plugin version has ever read it (the 15,024 durations on disk are all the plugin's own computation). Planning must verify empirically against a live hook payload. Until then the fallback stays, which is why the pending mechanism is re-keyed rather than deleted. If `duration_source` shows `native` universally in the field, a follow-up can delete the pending file entirely — removing the last stateful correlation surface.

## 7. Follow-on

- **D2 — Agent-native lineage:** an agent-keyed store (`agent_id`, `parent_agent_id`, `agent_type`, `spawn_depth`, tokens, duration), the spawn graph re-based on it, and Spec B's edge labels + latency re-pointed at `agent_id`. Supersedes the session-tree RPCs.
- Delete the pending mechanism once §6 resolves.
- Optionally read `agent-<id>.meta.json` (undocumented sidecar: `toolUseId`, `agentId`, `parentAgentId`, `spawnDepth`) as a best-effort spawn-graph source — treat as unreliable (absent for the ~4% of stops with empty `agent_type`).
- Repo-wide: migrations 022–027 still unverified against a real Postgres.
