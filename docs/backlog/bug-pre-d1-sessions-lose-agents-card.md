# Sessions predating Spec D1 show no Agents card

## Idea
Spec F rebuilt the session detail Agents card on `get_agent_tree`, which reads the `agents` table (introduced in migration 028, Spec D2). `AgentsTable` returns `null` for an empty array, so a session with no `agents` rows renders no card at all.

Sessions ingested before Spec D1/D2 have `subagent_stop` events but no `agents` rows. Their Agents card — previously reconstructed from those events, showing agent type, tool counts, turns and top tools — silently disappeared.

## Why deferred
Spec F §3.5 explicitly directed deleting the `subagent_stop` reconstruction, and the trade was deliberate: the old card priced agents client-side on a cache-blind basis, which is exactly the disagreement Spec F existed to remove. Keeping both paths would have meant keeping two cost bases on the same page.

The open question is what historic sessions should show, and the honest options differ a lot in cost:
1. **Nothing** (current behaviour) — defensible if nobody looks at pre-D1 sessions.
2. **An explicit empty state** — "Agent detail isn't available for sessions recorded before plugin 1.3.0" — cheap, and better than a card that just vanishes.
3. **Backfill `agents` rows from historic `subagent_stop` events** — recovers the data properly, but those events lack `agent_id` lineage and the cache token breakdown, so the backfilled rows would price cache-blind and have no parent links. That reintroduces a second cost basis, just in the database instead of the client.

Option 2 is probably right. Option 3 looks appealing and mostly isn't.

## What we already have
- `subagent_stop` events remain in the `events` table for these sessions, with `agent_type`, `tool_counts`, `tool_count_total`, `turns`, `input_tokens`, `output_tokens`, `model`.
- The `agents` table has a `unique (user_id, agent_id)` constraint, so a backfill would need synthetic ids.

## When to revisit
When someone actually reports it, or before any public launch where users will scroll back through history. Worth checking first how many sessions predate migration 028 — if the answer is "almost none", option 1 stands.
