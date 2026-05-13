# Multi-Platform Agent Support Design

**Date:** 2026-05-13
**Status:** Approved

## Summary

Expand Trenchcoat beyond Claude Code by adding support for two new integration tracks:

- **Track A** — OpenAI Agents SDK: passive instrumentation via native hooks, near-full parity with Claude Code
- **Track C** — GitHub Copilot Extension / M365 Copilot Studio: agent-as-observer model, Trenchcoat hosts an observable agent inside those platforms

Target customer: engineering teams building and operating production AI agents.

---

## Architecture

### Integration models

The two tracks have fundamentally different models:

**Track A (passive instrumentation):** Teams add `TrenchcoatHooks` to their existing OpenAI Agents SDK runs. Events fire transparently alongside agent execution with no behavior change and no rerouting.

**Track C (agent-as-observer):** GitHub Copilot and M365 Copilot do not expose lifecycle hooks for monitoring existing usage. Instead, Trenchcoat builds an observable agent that lives inside those platforms. Teams use `@trenchcoat` in Copilot Chat to invoke it. Because Trenchcoat owns the execution, all events are fully observable. The onboarding story is "route AI tasks through the Trenchcoat agent" rather than "instrument what Copilot does."

### No new API routes

Both tracks push to the existing `POST /api/v1/events` endpoint with the existing event schema. No backend changes are required.

---

## Track A — OpenAI Agents SDK

### Package

`trenchcoat-openai-agents` — a standalone Python package.

### Components

**`TrenchcoatHooks`** implements the SDK's `RunHooks` interface. Fires on the following lifecycle methods and maps them to Trenchcoat events:

| SDK hook | Trenchcoat event | Notes |
|---|---|---|
| `on_agent_start` | `session_start` | Generates a UUID `session_id` (SDK provides none) |
| `on_tool_start` | `tool_use` | Captures tool name + sanitized input preview |
| `on_tool_end` | `tool_result` | Captures result size (not content) |
| `on_handoff` | `subagent_stop` | Records from/to agent names |
| `on_agent_end` | `session_end` | Attaches `input_tokens`, `output_tokens` from `RunResult.usage`; triggers flush |

**`TrenchcoatAgentHooks`** implements `AgentHooks` for teams running multi-agent pipelines who need per-agent attribution alongside the top-level run hooks.

**`instrument(api_key, api_url=None)`** installs `TrenchcoatHooks` globally via the SDK's `set_default_hooks()`. `api_url` defaults to the value in config and is only needed when overriding (e.g., self-hosted deployments). Teams that call this once at startup don't need to thread hooks through every `Runner.run()` call.

**Shared core (reused from Claude Code plugin):** in-process batch queue, `flush_push_queue()`, config loading, `sanitize_tool_input()`. The package depends on this shared core; it is not duplicated.

### Usage

```python
# Option 1: per-run
from trenchcoat_openai_agents import TrenchcoatHooks

hooks = TrenchcoatHooks(api_key="ct_live_...")
result = await Runner.run(agent, input="...", hooks=hooks)

# Option 2: global (instrument once at startup)
from trenchcoat_openai_agents import instrument
instrument(api_key="ct_live_...")
```

### Data flow

Events accumulate in the in-process batch queue during the run. On `on_agent_end`, the queue flushes to `POST /api/v1/events` in batches of up to 100 events (configurable). Partial failures retain the unsent tail in the queue for the next flush.

---

## Track C — GitHub Copilot Extension / M365 Copilot Studio

### GitHub Copilot Extension

A GitHub App deployed once per GitHub org (self-hosted or Trenchcoat-managed). Implements the Copilot Extension streaming protocol (`POST /`).

**Event mapping per conversation:**

| Conversation moment | Trenchcoat event |
|---|---|
| First message in thread | `session_start` |
| Each user turn | `prompt_submit` |
| Each assistant response | `assistant_stop` (+ token counts from API response) |
| Conversation close | `session_end` |

Tool calls made by the Trenchcoat agent within a conversation map to `tool_use` / `tool_result` as in Track A.

**Deployment:** Trenchcoat provides a hosted managed extension to minimize operator friction. Teams can also self-host for data-residency requirements.

### M365 Copilot Studio

Same event emission logic, deployed as an Azure Bot Framework custom engine agent inside Copilot Studio. Shares the event emission layer with the Copilot Extension server.

---

## Error Handling

**Telemetry must never break the agent run.** This is the single non-negotiable constraint.

- Every hook method wraps its body in a silent `try/except`. Failures log to stderr and are dropped; they never propagate to the caller.
- For Track C, the Extension server streams its response independently of the Trenchcoat flush. Event emission happens asynchronously after the final streaming chunk is sent.
- Config errors (missing API key, unreachable endpoint) are detected at initialization and emit one warning at startup rather than per-event noise.

---

## Testing

### Track A

- **Unit tests:** assert each hook fires with correct event type and payload shape. Mock the batch queue — no network required.
- **Integration test:** run a minimal OpenAI agent with `TrenchcoatHooks` against a local mock HTTP server; assert all expected events arrive in the correct order with correct token counts.

### Track C

- **Unit tests:** POST mock GitHub Copilot payloads to the extension server; assert the emitted event sequence matches the expected schema.
- **End-to-end test:** full conversation turn → events flushed to mock API; assert session lifecycle events are correct.

The existing test suite in `apps/app/src/` covers the API ingestion side. No changes needed there.

---

## Out of Scope

- Cursor Agents — no public agent hook API; would require a proxy/intercept approach not covered here.
- LangChain / AutoGen / Google ADK — viable but deferred; prioritized behind the platforms above.
- Dashboard UI changes for new platform sources — separate spec.
- Pricing changes for new integration tiers — separate spec.
