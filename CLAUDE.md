# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

Trenchcoat is a SaaS platform for monitoring, metering, and reporting on AI Agent usage. It ingests telemetry events from agent plugins (via API keys), stores them in Supabase, and presents analytics through a Next.js dashboard.

**Supported platforms:** Claude Code (primary). Multi-platform expansion planned.

**Core tracking goals:**
1. Sessions — humans interacting with AI in a session
2. Agents — which agents are invoked within a session
3. Component usage — skills, commands, tools, MCPs, hooks, subagents
4. Token attribution — tokens consumed by each component type (skills, commands, tools, MCPs, hooks, subagents)
5. Cost — session cost derived from model token rates

The companion plugin lives in `claude-plugin/` and collects local session data via Claude Code hooks.

## Workspace Structure

This is a bun workspaces monorepo. Three services live under `apps/`:

| Directory | Framework | Domain |
|---|---|---|
| `apps/app/` | Next.js 16 | `app.trenchcoat.io` |
| `apps/marketing/` | Astro (stub, not yet scaffolded) | `trenchcoat.io` |
| `apps/docs/` | Nextra or Fumadocs (stub, not yet scaffolded) | `docs.trenchcoat.io` |
| `packages/` | (empty, reserved for shared code) | — |

Shared infrastructure (`supabase/`, `claude-plugin/`) stays at the repo root. The `docs/` directory at the repo root contains internal developer documentation (setup guides, specs, plans) — it is separate from the `apps/docs/` service. Run `bun install` from the repo root to install all workspace dependencies.

## Commands

- `bun run dev:app` — start the Next.js dashboard dev server (port 3000). Run from repo root.
- `bun run --filter @trenchcoat/app build` — production build for the app service
- `bun run --filter @trenchcoat/app lint` — ESLint for the app service
- `bun run build` — production build for all services (workspace-wide)
- `bun run lint` — ESLint for all services (workspace-wide)
- `bun install` — install all workspace dependencies (run from repo root)

**Package manager:** bun (primary). Use `bun install`, `bun add`, `bun remove` instead of npm equivalents.

## Environment Variables

Copy `.env.local.example` to `apps/app/.env.local` and fill in:
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — Supabase publishable key (formerly anon key)
- `SUPABASE_SECRET_KEY` — Supabase secret key (server-side only, used by admin client for event ingestion; formerly service role key)
- `CRON_SECRET` — Secret for Vercel Cron job authentication (used by `/api/v1/admin/sync-pricing` to validate the `Authorization: Bearer <secret>` header)

## Architecture

### Frontend (Next.js 16 App Router)

- **Route group `(dashboard)/`** — authenticated dashboard pages (overview, sessions, tools, activity, teams, settings). Layout redirects to `/login` if no session.
- **`/login`, `/signup`** — public auth pages using Supabase Auth.
- **`/auth/callback`** — OAuth callback route.
- **Middleware** (`apps/app/src/middleware.ts`) delegates to `apps/app/src/lib/supabase/middleware.ts` for session refresh. API routes (`/api/v1/*`) and auth routes are excluded from middleware.

### API Layer (`apps/app/src/app/api/v1/`)

All API routes use `createApiHandler()` from `apps/app/src/lib/api-middleware.ts`, which provides:
- API key authentication via `X-API-Key` header (keys prefixed `ct_live_`, SHA-256 hashed in DB)
- Scope-based authorization (e.g., `write:events`, `read:analytics`)
- Rate limiting (standard/premium/ingestion tiers)
- Zod body validation
- Standardized JSON responses via `apps/app/src/lib/api-response.ts` (`{ data }` or `{ error: { code, message } }`)

Key endpoints:
- `POST /api/v1/events` — bulk event ingestion (up to 1000 events per request)
- `GET /api/v1/sessions` — list sessions
- `GET /api/v1/analytics/overview` — overview stats
- `GET /api/v1/analytics/tools` — tool usage stats

### Service Layer (`apps/app/src/lib/services/`)

Business logic separated from route handlers. Services accept a Supabase client and return `ServiceResult<T>` (discriminated union: `{ success: true, data }` or `{ success: false, error }`).

- `events.service.ts` — event ingestion + session upsert + daily aggregate update
- `sessions.service.ts`, `analytics.service.ts`, `teams.service.ts`, `api-keys.service.ts`

### Supabase Clients (`apps/app/src/lib/supabase/`)

Three client variants — use the correct one based on context:
- `server.ts` — cookie-based server client for RSC/Server Actions (uses `@supabase/ssr`)
- `client.ts` — browser client for client components
- `admin.ts` — service-role singleton for API route handlers (bypasses RLS)

### Database (Supabase/Postgres)

Migrations are in `supabase/migrations/` (001–013). Key tables:
- `events` — partitioned by month (`created_at`), high-volume telemetry events
- `sessions` — one row per Claude Code session, upserted during event ingestion
- `daily_aggregates` — pre-computed daily rollups (sessions, events, tool breakdown, hourly distribution). Updated via `update_daily_aggregate()` RPC.
- `api_keys` — hashed keys with scopes and rate limit tiers
- `teams`, `team_members`, `user_profiles`

### UI Components

- shadcn/ui (new-york style, Tailwind v4, CSS variables for theming)
- Charts use Recharts (`apps/app/src/components/charts/`)
- Dashboard chrome in `apps/app/src/components/dashboard/` (sidebar, topbar, date picker)
- Server Actions for teams and API keys in `apps/app/src/lib/actions/`

### Event Types (Claude Code plugin)

Known event types flowing through the `events` table: `session_start`, `session_end`, `tool_use`, `tool_result`, `subagent_stop`, `assistant_stop`. Event-specific payload stored in `data jsonb`. Token counts and model info expected in `data` once token attribution is implemented.

### Claude Plugin (`claude-plugin/`)

A Claude Code plugin that collects telemetry locally via hooks (session_start, session_end, tool_use, etc.) and sends batched events to the SaaS API. Written in Python. Contains its own commands, skills, and hook scripts.

## Path Aliases

`@/*` maps to `./src/*` within `apps/app/` (configured in `apps/app/tsconfig.json` and `apps/app/components.json`).
