# Spec E — Cache-Aware Agent Cost

**Date:** 2026-07-20
**Status:** Draft (awaiting review)
**Predecessors:** D1 (agent-native capture), D2 (agent-native lineage) — both shipped

## 1. Problem

The spawn graph now renders real agent lineage on production, but **every node shows `cost = $0.000000`**. Cost is the graph's primary visual encoding (node heat), so the feature reads as free.

Three compounding causes, all verified against live data:

1. **The current token source fails.** `subagent_stop` derives tokens by parsing the agent transcript, which returned `input=0 output=0 model=None turns=0` for every test agent. This is the ~20% parse-failure rate documented in D1 §3.5 — and it is **100%** for agents that use no tools.

2. **The accurate numbers are captured but unused.** The Agent `tool_response` carries a `usage` object with a real per-direction breakdown. Observed:
   ```
   input: 10   output: 68   cache_creation: 23886   cache_read:     0   (totalTokens 23964)
   input: 10   output: 63   cache_creation:  8769   cache_read: 15121   (totalTokens 23963)
   ```
   D2 deliberately refused to write `totalTokens` into `output_tokens` — correctly, since the arithmetic above confirms `totalTokens` is an **aggregate including cache**. Pricing 23,964 cache tokens at the output rate would have overstated cost by orders of magnitude.

3. **Cache cannot currently be priced.** `model_pricing` has only `input_cost_per_1m` / `output_cost_per_1m`. In the observed data **cache is ~99% of all tokens**, so capturing only input/output would still understate cost by orders of magnitude — $0.001 against a true cost dominated by cache-creation.

LiteLLM — already the source for the nightly pricing sync — publishes `cache_creation_input_token_cost` and `cache_read_input_token_cost` (for Haiku 4.5: 1.25× and 0.1× of input). The data exists; nothing consumes it.

## 2. Scope

**In scope**
- Capture the `usage` breakdown on the Agent `tool_end`, reduced to four numeric fields.
- `model_pricing` gains `cache_creation_cost_per_1m` and `cache_read_cost_per_1m`; the LiteLLM sync populates them.
- `agents` gains **result-owned** token columns so the existing single-writer rule is preserved.
- `get_agent_tree` prices cache-aware, preferring `subagent_stop` tokens and falling back to result tokens.
- Plugin `1.3.1` → `1.3.2`.

**Out of scope (explicitly)**
- `get_top_agents`, `get_agent_timeseries`, `get_eval_comparison`, `get_daily_cost` have the **same understatement** — they price `subagent_stop` tokens with no cache term. That is a larger, separate slice touching four RPCs and the sessions-level cost path. **The Agents page will still under-report until it lands.** Noted in §7.
- Backfill. Existing rows keep whatever tokens they have.
- Replacing transcript parsing in `subagent_stop` (the fallback ordering below makes it non-urgent).

## 3. Design

### 3.1 Capture

`sanitize_agent_result` gains `usage`, but **not as a passthrough** — the nested object contains `iterations`, `server_tool_use`, `service_tier`, `inference_geo`, `speed`. Only four numeric fields are extracted, flattened:

```
usage_input_tokens, usage_output_tokens,
usage_cache_creation_tokens, usage_cache_read_tokens
```

All numeric, all optional. This preserves the strict-allowlist discipline that D1's privacy review established — no free text can enter via a nested blob.

### 3.2 Pricing

`model_pricing` gains two nullable columns. Nullable, not defaulted, so "unknown cache rate" stays distinguishable from "free". The sync writes them when LiteLLM supplies them.

Where a cache rate is null, cost falls back to the documented Anthropic ratios (**cache-creation = 1.25× input, cache-read = 0.1× input**) rather than contributing zero — an approximation that is far closer to truth than dropping ~99% of the tokens. This fallback is applied in SQL and commented as an approximation.

### 3.3 Storage — ownership preserved

`agents` gains four columns written **only** by the Agent `tool_result` branch:

```
result_input_tokens, result_output_tokens,
result_cache_creation_tokens, result_cache_read_tokens
```

This deliberately avoids the dual-writer hazard the D2 review flagged: `subagent_stop` keeps sole ownership of `input_tokens`/`output_tokens`, `tool_result` keeps sole ownership of the `result_*` set, and the **read side** decides which to use. Partial upserts remain safe and order-independent.

### 3.4 Read-side

`get_agent_tree` computes cost from a coalesced source, preferring the stop-derived tokens when they are non-zero:

- `eff_input  = coalesce(nullif(input_tokens, 0),  result_input_tokens,  0)`
- `eff_output = coalesce(nullif(output_tokens, 0), result_output_tokens, 0)`
- cache terms come from `result_*` only (the transcript path never produced them)

Cost = `eff_input × in_rate + eff_output × out_rate + cache_creation × cc_rate + cache_read × cr_rate`, all per-term coalesced (the migration-023 null-zeroing bug must not regress).

`nullif(…, 0)` matters: a stop-derived `0` must be treated as "absent", not as a real zero, otherwise the fallback never engages — which is precisely today's bug.

Because `get_agent_tree` returns `TABLE(...)`, changing its columns requires `drop function if exists` first.

## 4. Testing

- **Plugin (pytest):** `usage` flattened to exactly the four numeric fields; nested `iterations`/`service_tier`/`inference_geo` never captured; absent `usage` yields no keys; the existing leak test still passes.
- **Promotion (bun):** `result_*` columns written only by the Agent `tool_result` branch; `subagent_stop` still owns `input_tokens`/`output_tokens`; no branch writes another's columns.
- **Sync (bun):** cache rates populated when LiteLLM provides them; absent rates leave the columns null rather than 0.
- **RPC:** service shape test; **live verification against production** using the existing test agents, whose true cost is known from their `usage` values.

## 5. Edge cases

- **Stop tokens present and non-zero** → used; result tokens ignored (transcript path is per-direction accurate when it works).
- **Both absent** → cost 0, as today. Nothing to invent.
- **Cache rate null** → 1.25× / 0.1× approximation, commented as such.
- **Pre-1.3.2 agents** → no `result_*` values; behaviour unchanged.

## 6. Expected result

For the observed test agent (`input 10, output 68, cache_creation 23886, cache_read 0` on Haiku 4.5 at $1/$5 per 1M):

```
10 × 1.00/1M  +  68 × 5.00/1M  +  23886 × 1.25/1M  +  0
≈ $0.00001    +  $0.00034      +  $0.02986        = ~$0.0302
```

So the graph should move from **$0.000000** to roughly **$0.03** per test agent — small in absolute terms, but non-zero and correctly dominated by cache creation, which is the honest shape of the cost.

## 7. Follow-on

- **The same cache-blind understatement affects `get_top_agents`, `get_agent_timeseries`, `get_eval_comparison`, and `get_daily_cost`.** The Agents page and eval comparison will keep under-reporting until a follow-up applies cache-aware pricing there too. This is the single largest remaining accuracy gap.
- Consider replacing `subagent_stop`'s transcript parsing entirely once `usage` proves reliable in the field.
- Edge-label markers match anywhere in a prompt, including inside quoted/instructional text — observed producing a false-positive label during live testing.
