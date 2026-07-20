# Unify all cost surfaces on price_tokens

## Idea
Spec F made session-level cost cache-aware and introduced `public.price_tokens(model, input, output, cache_creation, cache_read)` (migration 033) as the single pricing authority. Only two consumers use it: `get_agent_tree` and `get_session_cost`.

Five RPCs still price input + output only:

- `get_daily_cost`
- `get_cost_by_model`
- `get_top_agents`
- `get_agent_timeseries`
- `get_eval_comparison`

Repoint each at `price_tokens`. Doing so removes the "excl. cache" labels Spec F added to `/cost` and `/agents`, and closes the visible seam where a session's cost on `/sessions` exceeds its contribution to the `/cost` daily total.

## Why deferred
Spec F §7 deferred this deliberately, for two reasons that both still apply in part:

1. **There was no cache-token traffic to validate against.** Plugin 1.3.3 had not shipped. That changes as soon as 1.3.3 is in real use — check before starting.
2. **Each aggregate needs its own cache-token source verified independently.** This is the real work, and it is not uniform:
   - `get_daily_cost` and `get_cost_by_model` aggregate over `sessions`, which now has `cache_creation_tokens` / `cache_read_tokens`. These two are close to mechanical.
   - `get_top_agents` and `get_agent_timeseries` aggregate over **`subagent_stop` events**, not the `agents` table. Those events carry no cache breakdown — only `agents.result_*` does. Either these RPCs move to reading `agents`, or `subagent_stop` starts emitting cache tokens (the transcript parser already computes them as of 1.3.3; only `stop.py` emits them today).
   - `get_eval_comparison` aggregates over sessions joined to `eval_scores`; it follows once `sessions` is the basis.

## Watch for
- **The null-vs-zero contract.** `null` cache columns mean "plugin older than 1.3.3", `0` means "genuinely no cache". An aggregate that sums `null` as `0` silently reintroduces understated cost, but now averaged across a date range where it is much harder to notice than on a single session.
- **`price_tokens` returns NULL for an unpriced model.** A `sum()` over a set containing one unpriced session must not become NULL for the whole day. Decide explicitly whether unpriced rows are excluded (and surfaced as a count) or coerced.
- Historic sessions will price cache-free forever. A daily chart will show a step change on the day 1.3.3 rolled out — worth annotating rather than letting it read as a spend spike.

## When to revisit
Once plugin 1.3.3 has been in real use long enough to produce a few days of cache-token traffic. Start with `get_daily_cost` / `get_cost_by_model`; the two agent RPCs are a bigger decision and could be their own slice.
