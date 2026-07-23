# Bug: PR preview deployments 500 — Supabase env vars missing on Preview scope

**Status:** Open · **Severity:** Medium (previews unusable; production unaffected) · **Filed:** 2026-07-23

## Symptom

Every Vercel **preview** deployment (PR branches) returns a 500 on any page the
middleware runs on:

```
500: INTERNAL_SERVER_ERROR
Code: MIDDLEWARE_INVOCATION_FAILED
```

Vercel aggregated runtime errors show the cause (route `/middleware`):

```
Error: Your project's URL and Key are required to create a Supabase client!
```

First seen **2026-05-11**, so this predates any recent feature work — it surfaced
during the per-machine-filtering PR (#11) only because that was the first time a
preview URL was opened. Production (`app.trenchcoat.io`) is unaffected.

## Root cause

`apps/app/src/lib/supabase/middleware.ts` builds a Supabase client from
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. These env
vars are configured in Vercel for the **Production** environment only, not
**Preview**. On preview deployments they are `undefined`, so `createServerClient`
throws and the Edge middleware fails on every matched route.

Note: preview deployments also sit behind Vercel Deployment Protection (SSO), so
the failure is only visible to users logged into the Vercel team — an
unauthenticated request is redirected (302) before reaching the middleware.

## Fix

In Vercel → project **trenchcoat** → Settings → Environment Variables, add (or
re-scope) these with the **Preview** target checked, then redeploy the branch:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY` (server-side; needed for the `/api/v1/*` routes)
- `CRON_SECRET` (if any preview exercises the pricing cron route)

Point Preview at the same Supabase project as Production, or stand up a dedicated
Supabase project/branch for previews if isolation from prod data is wanted.

Requires the actual secret values from the Vercel dashboard — cannot be done from
the repo.

## Optional hardening

Make the failure legible instead of a raw 500: have `updateSession` detect missing
env and short-circuit (e.g. skip auth refresh, or redirect to a "misconfigured"
notice) rather than letting `createServerClient` throw inside the Edge middleware.
</content>
