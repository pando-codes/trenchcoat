# No test harness for SQL functions

## Idea
`supabase/` contains only `migrations/` and `snippets/`. There is no way to run assertions against the RPCs, so every SQL invariant in this codebase is verified by hand once, at authoring time, and never again.

The pricing logic is the sharpest example. `price_tokens` (migration 033) must return **NULL** for a model absent from `model_pricing`, not `0` — the whole point of extracting it was to stop unpriced models rendering as a confident `$0.00`. That invariant is currently guarded by nothing. Someone adding a well-intentioned `coalesce(..., 0)` would restore the original bug with all 441 TypeScript tests still green.

Spec F §6 specified four SQL cases for `price_tokens` (synced rates, null-rate fallback, unknown model, null model). They were run manually against a local Supabase during implementation and are not repeatable.

## Why deferred
Consistent with existing repo convention — migrations 031, 029, 027 and the rest have no tests either, so Spec F was not the right place to introduce a whole new test tier.

## Options
1. **pgTAP** — the standard answer, runs in the database, `supabase test db` supports it. Heaviest to set up.
2. **A bun test file that connects to the local Supabase and calls the RPCs.** Reuses the existing runner and the `bun test` command everyone already runs. Requires a running local stack, so it either becomes a separate opt-in script or the suite skips when no DB is reachable.
3. **Fixture-and-golden-file**: apply migrations to a scratch DB, run a fixed set of queries, diff against committed expected output. Cheap, catches regressions, poor failure messages.

Option 2 is probably the best fit for how this repo already works, with the caveat that a test which silently skips when the DB is absent protects nobody in CI — there is no CI here today (no `.github/workflows/`), which is worth deciding about at the same time.

## Highest-value cases to cover first
- `price_tokens`: unpriced model → NULL, not 0.
- `price_tokens`: null cache rates → 1.25× / 0.10× of input.
- `get_session_cost`: `null` cache columns and `0` cache columns produce the same cost but remain distinguishable in the output.
- `get_agent_tree`: the `eff` CTE's `nullif(input_tokens, 0)` fallback to `result_input_tokens` — the guard that fixed the original $0-cost bug.

## When to revisit
Before [unifying the remaining cost surfaces on `price_tokens`](enhancement-unify-cost-basis-on-price-tokens.md). That work touches five RPCs at once, and doing it without a way to assert the pricing invariants is how the confident-zero bug comes back.
