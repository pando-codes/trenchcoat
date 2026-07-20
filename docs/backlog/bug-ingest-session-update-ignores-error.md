# Session update on ingest swallows its error

## Idea
`ingestEvents` writes token totals, model and stop reason to the `sessions` row and never inspects the result:

```ts
await adminClient
  .from("sessions")
  .update(update)
  .eq("session_id", e.session_id)
  .eq("user_id", userId);
```

(`apps/app/src/lib/services/events.service.ts`, the `assistant_stop` loop — the same pattern repeats in the `session_start` and agent-lineage loops below it.)

Every one of these should at minimum log a failure. The ingest request still returns `201 { inserted: n }` because the events themselves inserted fine, so a total failure of the session-promotion path is invisible from both the API response and the logs.

## Why it matters
This turns a routine deploy-order slip into silent, permanent data loss.

Spec F added `cache_creation_tokens` / `cache_read_tokens` to that update payload. If the app ever deploys ahead of its migration — or PostgREST's schema cache is stale just after one — PostgREST rejects the **entire** update with `PGRST204`, so `input_tokens`, `output_tokens`, `model` and `stop_reason` stop being written for every session ingested during that window. Nothing logs it, nothing retries, and the data is not recoverable from the events table for sessions whose `assistant_stop` has already been consumed.

This was caught in the Spec F final review and avoided by applying migrations 032–034 to production before merging. The hazard itself is still present for the next column added.

## What we already have
- `ServiceResult` is already the convention in this layer for surfacing failures.
- The events insert directly above it *is* error-checked and returns `INGEST_FAILED`.

## When to revisit
Before the next migration that adds a column to the `sessions` update payload. Cheap fix — check the error and log it; deciding whether it should also fail the request is the only real design question, since a hard failure would make the plugin retry the whole batch.
