# Multi-Service Workspace Reorganization

**Date:** 2026-05-12
**Status:** Approved

## Overview

Transform the current single Next.js app repo into a bun workspaces monorepo hosting three frontend services: the dashboard app, a marketing site, and a docs site. Each service deploys independently to its own Vercel project and subdomain.

## Services

| Service | Framework | Domain | Vercel Root Directory |
|---|---|---|---|
| `app` | Next.js 16 (existing) | `app.trenchcoat.com` | `apps/app` |
| `marketing` | Astro (new) | `trenchcoat.com` | `apps/marketing` |
| `docs` | Nextra or Fumadocs (new) | `docs.trenchcoat.com` | `apps/docs` |

Docs framework: Fumadocs is preferred (App Router native, consistent with the existing app) but not decided — confirmed when scaffolded.

## Directory Structure

```
trenchcoat-app/                  ← repo root = workspace root
├── apps/
│   ├── app/                     ← Next.js dashboard (files moved from root)
│   │   ├── src/
│   │   ├── public/
│   │   ├── next.config.ts
│   │   ├── next-env.d.ts
│   │   ├── tsconfig.json
│   │   ├── components.json
│   │   ├── postcss.config.mjs
│   │   ├── eslint.config.mjs
│   │   ├── vercel.json
│   │   └── package.json         ← name: "@trenchcoat/app"
│   ├── marketing/               ← Astro (scaffolded separately)
│   │   └── package.json         ← name: "@trenchcoat/marketing"
│   └── docs/                    ← Nextra or Fumadocs (scaffolded separately)
│       └── package.json         ← name: "@trenchcoat/docs"
├── packages/                    ← empty, reserved for future shared code
├── claude-plugin/              ← stays (Claude Code plugin, not a web app)
├── supabase/                    ← stays (shared infra)
├── docs/                        ← stays (internal dev docs/specs)
├── CLAUDE.md
├── README.md
├── bun.lock                     ← single unified lockfile
└── package.json                 ← workspace root
```

## Package Config

### Root `package.json`

```json
{
  "name": "trenchcoat-workspace",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev:app": "bun run --filter @trenchcoat/app dev",
    "dev:marketing": "bun run --filter @trenchcoat/marketing dev",
    "dev:docs": "bun run --filter @trenchcoat/docs dev",
    "build": "bun run --filter '*' build",
    "lint": "bun run --filter '*' lint"
  }
}
```

### `apps/app/package.json`

Current root `package.json` moved here with one change: `"name"` renamed from `"claude-telemetry-saas"` to `"@trenchcoat/app"`. All dependencies unchanged.

### `apps/marketing/package.json` and `apps/docs/package.json`

Minimal stubs created at migration time. Filled out properly when those apps are scaffolded.

## File Migration

### Moves to `apps/app/`

| From (root) | To |
|---|---|
| `src/` | `apps/app/src/` |
| `public/` | `apps/app/public/` |
| `next.config.ts` | `apps/app/next.config.ts` |
| `next-env.d.ts` | `apps/app/next-env.d.ts` |
| `tsconfig.json` | `apps/app/tsconfig.json` |
| `components.json` | `apps/app/components.json` |
| `postcss.config.mjs` | `apps/app/postcss.config.mjs` |
| `eslint.config.mjs` | `apps/app/eslint.config.mjs` |
| `vercel.json` | `apps/app/vercel.json` |
| `package.json` | `apps/app/package.json` |

### Stays at Root

`supabase/`, `claude-plugin/`, `docs/`, `CLAUDE.md`, `README.md`

### Deleted

- `package-lock.json` — stale npm artifact, bun doesn't use it
- `node_modules/` — rebuilt at workspace root via `bun install` after migration
- `.next/` — build artifact, not committed

**No internal import paths change.** All `@/*` aliases in `src/` resolve via `tsconfig.json`'s `paths` config, which moves with the app. No source edits required.

## Vercel Deployment

Three separate Vercel projects, all connected to the same GitHub repo:

| Vercel Project | Root Directory | Domain | Notes |
|---|---|---|---|
| `trenchcoat-app` | `apps/app` | `app.trenchcoat.com` | Gets all Supabase env vars + CRON_SECRET |
| `trenchcoat-marketing` | `apps/marketing` | `trenchcoat.com` | Minimal env vars |
| `trenchcoat-docs` | `apps/docs` | `docs.trenchcoat.com` | Minimal env vars |

The cron job in `apps/app/vercel.json` is scoped to the `trenchcoat-app` project only.

Each project gets independent deploy previews per branch.

## Shared Code

No shared packages at migration time. The `packages/` directory is created empty (with a `.gitkeep`) as a reserved location. Shared code is extracted into `packages/` only when a clear need emerges across two or more apps.

## Monorepo Tooling

Bun workspaces only — no Turborepo or Nx. Sufficient for three apps with no shared packages. Can add Turborepo later if build caching becomes a pain point.
