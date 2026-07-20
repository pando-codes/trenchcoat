# Label the remaining cache-blind cost surfaces

## Idea
Spec F §7 called for labelling the surfaces that still price input + output only, and Task 9 labelled two of them: `/cost` and `/agents`. Two more show cache-blind cost with no label:

- **Overview** (`apps/app/src/app/(dashboard)/page.tsx`) — the Daily Cost card calls `get_daily_cost`, the same cache-blind RPC that `/cost` is labelled for.
- **Eval comparison** (`apps/app/src/app/(dashboard)/evals/[id]/page.tsx`) — renders `total_cost_usd` from `get_eval_comparison`.

The spec named only `/cost` and `/agents`, so these were in-scope-by-omission rather than a deliberate exclusion.

## Why it matters more than it looks
Overview is the most-viewed page in the app and the first thing a new user sees. It now understates cost by the same order of magnitude as the old sessions list did — while `/sessions`, one click away, shows the cache-aware number. An unexplained 10× gap between the landing page and the detail page reads as a bug in the product, not a known limitation.

The eval case is subtler and arguably worse: variant comparison is a *decision-making* surface. Two variants with different cache-hit profiles will compare incorrectly against each other, not just report low in absolute terms.

## What we already have
- The exact copy pattern, from Task 9 on `/cost`:
  > Excludes cache tokens. Session-level costs on **Sessions** are cache-aware and will be higher.
- Both pages already have a heading/subtitle block to hang it on.

## When to revisit
Immediately — this is a few lines of copy and it closes an obvious credibility gap. Note that it is only a stopgap: [unifying every surface on `price_tokens`](enhancement-unify-cost-basis-on-price-tokens.md) removes all four labels. If that work is starting within a week or so, skip this and do it properly instead.
