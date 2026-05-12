# Docs Site Design

**Date:** 2026-05-12
**Status:** Approved

## Overview

Scaffold and ship `apps/docs/` as the Trenchcoat documentation site at `docs.trenchcoat.com`. The site serves two co-equal audiences — plugin developers and dashboard users — through a single unified sidebar. MVP scope: all four content sections fully written at launch (Getting Started, Plugin SDK & Hooks, API Reference, Dashboard Guide).

## Goals & Audience

**Primary audiences (co-equal):**
- **Plugin developers** — Claude Code users installing and configuring the Trenchcoat plugin, writing hooks, consuming the events API
- **Dashboard users** — Engineering managers and team leads using the Trenchcoat web app to monitor AI agent activity, manage API keys, and administer teams

**Navigation strategy:** Single unified sidebar (Approach A). A role-selector intro at the top of Getting Started directs each audience to their starting point. No top-level audience split — content overlap is too high at this stage to justify the complexity.

## Tech Stack

| Concern | Choice |
|---|---|
| Framework | Fumadocs (Next.js App Router) |
| MDX | fumadocs-mdx |
| Search | Fumadocs Orama (built-in, local full-text) |
| Styling | Tailwind CSS v4 |
| Font | Inter (via `next/font/google`) |
| Deployment | Vercel, Root Directory: `apps/docs` |
| Domain | `docs.trenchcoat.com` |
| Package name | `@trenchcoat/docs` |
| Dev port | 3002 (app=3000, marketing=3001) |

Fumadocs is chosen over Nextra for its flexibility and alignment with the `apps/app/` Next.js stack. Install the latest version at scaffold time. Orama provides zero-config search with no external service dependency at launch.

## Content Structure

```
docs.trenchcoat.com/
│
├── Getting Started
│   ├── Introduction           ← what Trenchcoat is, two-path role selector
│   ├── Quickstart: Plugin     ← install plugin, connect API key, see first session
│   └── Quickstart: Dashboard  ← create account, read your first session, invite team
│
├── Plugin SDK & Hooks
│   ├── Overview               ← how the Claude Code plugin works end-to-end
│   ├── Installation           ← step-by-step plugin install
│   ├── Configuration          ← config options, API key setup, environment variables
│   ├── Event Schema           ← all event types with payload shapes (session_start, tool_use, etc.)
│   └── Hook Reference         ← each hook: when it fires, what it captures, example output
│
├── API Reference
│   ├── Authentication         ← API keys, X-API-Key header, scopes, rate limits
│   ├── Events                 ← POST /api/v1/events — bulk ingestion, schema, errors
│   ├── Sessions               ← GET /api/v1/sessions — params, response shape
│   └── Analytics              ← GET /api/v1/analytics/overview + /tools
│
└── Dashboard Guide
    ├── Overview page          ← reading the stats cards and charts
    ├── Sessions               ← session list, session detail, filtering
    ├── Tools & Usage          ← tool breakdown charts, interpreting data
    ├── API Keys               ← creating, rotating, scoping, revoking keys
    └── Teams                  ← inviting members, roles, removing members
```

Content depth at launch: all pages fully written (not stubbed). The event schema and API reference can be derived from the existing codebase (`events.service.ts`, `api-middleware.ts`, Supabase migrations).

## Branding

Fumadocs CSS custom properties overridden to match the Trenchcoat brand:

- **Font:** Inter via `next/font/google`, applied as `font-sans` — matches the marketing site
- **Primary/accent color:** Indigo-600 (`oklch(0.488 0.243 264.376)`) — the same value used as `--sidebar-primary` in the app and as the CTA color throughout marketing
- **Background/text:** White background, slate-900 text — same as marketing
- **Logo:** Trenchcoat wordmark in top-left nav, linking to `trenchcoat.com`
- **Dark mode:** Fumadocs has built-in dark mode toggle; apply dark-mode brand overrides consistent with the app's dark theme (dark background `oklch(0.145 0 0)`, indigo primary unchanged)

Color values pulled from `apps/app/src/app/globals.css` and `apps/marketing/src/components/` to ensure cross-property consistency.

## Directory Structure

```
apps/docs/
├── app/
│   ├── layout.tsx             ← Fumadocs RootLayout with Inter font + brand theme
│   ├── page.tsx               ← /docs landing (redirect or role-selector page)
│   └── docs/
│       └── [[...slug]]/
│           └── page.tsx       ← MDX page renderer
├── content/docs/
│   ├── getting-started/
│   │   ├── index.mdx          ← Introduction
│   │   ├── quickstart-plugin.mdx
│   │   └── quickstart-dashboard.mdx
│   ├── plugin-sdk/
│   │   ├── overview.mdx
│   │   ├── installation.mdx
│   │   ├── configuration.mdx
│   │   ├── event-schema.mdx
│   │   └── hook-reference.mdx
│   ├── api-reference/
│   │   ├── authentication.mdx
│   │   ├── events.mdx
│   │   ├── sessions.mdx
│   │   └── analytics.mdx
│   └── dashboard-guide/
│       ├── overview.mdx
│       ├── sessions.mdx
│       ├── tools-and-usage.mdx
│       ├── api-keys.mdx
│       └── teams.mdx
├── lib/
│   └── source.ts              ← Fumadocs source config (content → sidebar nav)
├── components/                ← custom MDX components if needed
├── public/
│   └── favicon.ico
├── source.config.ts           ← fumadocs-mdx configuration
├── next.config.ts
├── tailwind.config.ts
└── package.json               ← @trenchcoat/docs, dev port 3002
```

## Workspace Integration

Add to root `package.json`:
```json
"dev:docs": "bun run --filter @trenchcoat/docs dev"
```

The stub `apps/docs/package.json` already exists with `@trenchcoat/docs` as the name — update its scripts to add real `dev`, `build`, and `lint` commands after scaffolding.

## Deployment

Vercel project: Root Directory `apps/docs`. Deploy as Next.js (Node.js runtime) — Fumadocs requires a server runtime for its search API route. Domain: `docs.trenchcoat.com` via DNS CNAME. No environment variables needed at launch (Orama search is local, no Algolia keys).

## Out of Scope

- Versioned docs (single version at launch)
- Algolia search (Orama local search is sufficient until traffic warrants it)
- i18n / localization
- Interactive API explorer / Swagger UI
- Auto-generated API reference from OpenAPI spec (write by hand from existing route handlers)
