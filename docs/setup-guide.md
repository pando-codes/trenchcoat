# Claude Telemetry — Setup Guide

Self-host your own instance of Claude Telemetry to track Claude Code usage across your team.

## Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project (free tier works)
- Python 3.10+ (for the Claude Code plugin)

## 1. Clone and install

```bash
git clone https://github.com/pando-codes/claude-telemetry-saas.git
cd claude-telemetry-saas
npm install
```

## 2. Set up Supabase

### Create a project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) and create a new project
2. Note your **Project URL** and **anon/public key** (Settings → API)
3. Note your **service role key** (Settings → API → service_role, keep this secret)

### Run the migrations

Apply the database migrations in order. You can do this through the Supabase SQL Editor (Dashboard → SQL Editor) by pasting each file, or using the Supabase CLI:

```bash
# Using the Supabase CLI
supabase db push
```

Or manually run each migration file in `supabase/migrations/` (001 through 009) in the SQL Editor.

The migrations create:
- `user_profiles` — auto-created on signup
- `api_keys` — hashed API keys with scopes
- `teams` and `team_members` — team management
- `events` — partitioned by month for high-volume telemetry
- `sessions` — one row per Claude Code session
- `daily_aggregates` — pre-computed daily rollups for fast dashboard queries
- Postgres functions for analytics (`get_overview_stats`, `get_top_tools`, `update_daily_aggregate`)
- A cron job to auto-create future event partitions

### Enable authentication

1. In Supabase Dashboard → Authentication → Providers, enable **Email** (enabled by default)
2. Optionally enable OAuth providers (GitHub, Google, etc.)

## 3. Configure environment variables

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

| Variable | Where to find it | Used for |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API | All Supabase clients |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API → anon/public | Browser client, server components (respects RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → service_role | API route handlers for event ingestion (bypasses RLS) |

## 4. Start the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Sign up for an account — your user profile is auto-created.

## 5. Create an API key

1. Log in to the dashboard
2. Go to **Settings → API Keys**
3. Click **Create API Key**
4. Name it (e.g., "My Laptop") and select scopes:

   | Scope | Description | Notes |
   |---|---|---|
   | `write:events` | Send telemetry events to the ingestion API | **Required** for the Claude Code plugin |
   | `read:events` | Retrieve raw event records via the API | Not needed for the plugin |
   | `read:sessions` | List and retrieve session records via the API | — |
   | `read:analytics` | Query overview stats, tool usage breakdowns, and daily aggregates | — |
   | `admin` | Unrestricted access to all endpoints | Only grant to fully trusted applications |

   For plugin use, select **`write:events`** only.
5. Copy the `ct_live_...` key — it is only shown once

## 6. Install the Claude Code plugin

The plugin lives in `claude-plugin/`. It collects telemetry locally via Claude Code hooks and sends batched events to the SaaS on session end.

### Install globally

```bash
claude plugin add /path/to/claude-telemetry-saas/claude-plugin
```

Or symlink it into your Claude plugins directory:

```bash
ln -s /path/to/claude-telemetry-saas/claude-plugin ~/.claude/plugins/claude-telemetry
```

### Configure the plugin

The plugin stores its config at `~/.claude/telemetry/config.json`. Set your SaaS URL and API key:

```bash
# Create/edit the config
mkdir -p ~/.claude/telemetry
cat > ~/.claude/telemetry/config.json << 'EOF'
{
  "enabled": true,
  "privacy": {
    "log_prompt_content": false,
    "tool_input_preview_chars": 100,
    "log_tool_results": false
  },
  "retention_days": 30,
  "api_url": "https://your-deployed-url.vercel.app",
  "api_key": "ct_live_your_api_key_here",
  "push_batch_size": 100
}
EOF
```

Replace `api_url` with your deployment URL (or `http://localhost:3000` for local dev) and `api_key` with the key from step 5.

### Verify the connection

```bash
curl -s -o /dev/null -w "%{http_code}" -X POST \
  "https://your-deployed-url.vercel.app/api/v1/events" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ct_live_your_api_key_here" \
  -d '{"events":[{"ts":"'"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"'","event":"session_start","session_id":"test","seq":0,"data":{}}]}'
```

A `201` response means the connection works. `401` means the API key is invalid.

## 7. Deploy (optional)

### Vercel

```bash
npm i -g vercel
vercel
```

Set the three environment variables in your Vercel project settings.

### Other platforms

Any Node.js hosting that supports Next.js works. Set the environment variables and run:

```bash
npm run build
npm run start
```

## How it works

Once configured, the plugin captures telemetry automatically:

1. **During a session** — hooks fire on events (session start/end, tool use, prompt submit, agent calls, etc.) and write to local JSONL files at `~/.claude/telemetry/events-YYYY-MM-DD.jsonl`
2. **On session end** — all queued events are batch-POSTed to `POST /api/v1/events` (up to 1000 per request)
3. **Server-side** — the API validates the key, inserts events, upserts session records, and updates daily aggregates
4. **Dashboard** — view your analytics at the web UI (overview stats, tool usage, activity heatmap, session history)

### Privacy

The plugin is privacy-first by default:
- No prompt content is logged (`log_prompt_content: false`)
- Tool inputs are truncated to 100 chars
- Tool results only record byte size, never content
- All data stays local unless `api_key` is configured
- Local JSONL files are retained for `retention_days` (default 30), then auto-deleted

### Event types

| Event | When it fires |
|---|---|
| `session_start` | Claude Code session begins |
| `session_end` | Session ends |
| `tool_use` | Before a tool is called |
| `tool_result` | After a tool returns |
| `prompt_submit` | User submits a prompt |
| `assistant_stop` | Assistant finishes responding |
| `subagent_stop` | A subagent (Task tool) completes |
| `pre_compact` | Context window is about to be compacted |
| `error` | An error occurs |

### API authentication

All `/api/v1/*` endpoints require an `X-API-Key` header with a valid `ct_live_...` key. Keys are SHA-256 hashed in the database and checked against scopes per endpoint. Rate limits apply based on the key's tier (standard: 60 req/min, premium: 200 req/min, ingestion: 200 req/min).

#### Scopes

| Scope | Grants access to | Endpoint(s) |
|---|---|---|
| `write:events` | `POST /api/v1/events` — ingest telemetry | Event ingestion |
| `read:events` | `GET /api/v1/events` — read raw events | Raw event access |
| `read:sessions` | `GET /api/v1/sessions` — list sessions | Session records |
| `read:analytics` | `GET /api/v1/analytics/*` — stats and aggregates | Analytics endpoints |
| `admin` | All endpoints, bypasses scope checks | Everything |

Keys with the `admin` scope bypass per-endpoint scope checks. A key without a required scope receives a `403 Forbidden` response with `error.code: "insufficient_permissions"`.
