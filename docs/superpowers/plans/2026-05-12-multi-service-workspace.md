# Multi-Service Workspace Reorganization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the current single Next.js app repo into a bun workspaces monorepo with three service slots: app (Next.js, existing), marketing (Astro, stub), and docs (Nextra/Fumadocs, stub).

**Architecture:** The repo root becomes the workspace root. All app-specific files move into `apps/app/` via `git mv` (preserving history). Two stub service directories are created at `apps/marketing/` and `apps/docs/`. Infra files (`supabase/`, `plugin-example/`, `docs/`) stay at root. A single `bun.lock` at workspace root covers all packages.

**Tech Stack:** bun workspaces, Next.js 16 (app), git mv for history-preserving migration

---

## File Map

| Action | Path |
|---|---|
| Create (dir) | `apps/app/` |
| Move | `src/` → `apps/app/src/` |
| Move | `public/` → `apps/app/public/` |
| Move | `next.config.ts` → `apps/app/next.config.ts` |
| Move | `next-env.d.ts` → `apps/app/next-env.d.ts` |
| Move | `tsconfig.json` → `apps/app/tsconfig.json` |
| Move | `components.json` → `apps/app/components.json` |
| Move | `postcss.config.mjs` → `apps/app/postcss.config.mjs` |
| Move | `eslint.config.mjs` → `apps/app/eslint.config.mjs` |
| Move | `vercel.json` → `apps/app/vercel.json` |
| Move + modify | `package.json` → `apps/app/package.json` (name → `@trenchcoat/app`) |
| Create | `package.json` (new workspace root) |
| Modify | `.gitignore` (fix `/.next/` path) |
| Delete (git rm) | `package-lock.json` |
| Create | `apps/marketing/package.json` |
| Create | `apps/docs/package.json` |
| Create | `packages/.gitkeep` |
| Modify | `CLAUDE.md` |

---

### Task 1: Move app files into apps/app/

**Files:**
- Create: `apps/app/` (directory)
- Move: all files listed in the File Map above
- Modify: `.gitignore`, `apps/app/package.json`

- [ ] **Step 1: Create the apps/app directory**

```bash
mkdir -p apps/app
```

Expected: no output, directory exists.

- [ ] **Step 2: git mv all app-specific files**

```bash
git mv src apps/app/src
git mv public apps/app/public
git mv next.config.ts apps/app/next.config.ts
git mv next-env.d.ts apps/app/next-env.d.ts
git mv tsconfig.json apps/app/tsconfig.json
git mv components.json apps/app/components.json
git mv postcss.config.mjs apps/app/postcss.config.mjs
git mv eslint.config.mjs apps/app/eslint.config.mjs
git mv vercel.json apps/app/vercel.json
git mv package.json apps/app/package.json
```

Expected: no output. Each `git mv` tracks the rename in the index so history is preserved.

- [ ] **Step 3: Rename the package in apps/app/package.json**

Open `apps/app/package.json` and change the `"name"` field:

```json
{
  "name": "@trenchcoat/app",
  ...
}
```

Only the `"name"` field changes. Everything else (scripts, dependencies, devDependencies) stays exactly as-is.

- [ ] **Step 4: Remove the stale package-lock.json**

```bash
git rm package-lock.json
```

Expected: `rm 'package-lock.json'`

- [ ] **Step 5: Fix the .gitignore**

The current `.gitignore` has `/.next/` which is root-relative and won't cover `apps/app/.next/` after the move. Fix it:

Replace this line:
```
/.next/
```

With:
```
apps/app/.next/
```

No other changes to `.gitignore` are needed — all other patterns (`.env*`, `*.tsbuildinfo`, `next-env.d.ts`, etc.) use no leading slash so they match anywhere in the tree.

- [ ] **Step 6: Verify git status looks correct**

```bash
git status
```

Expected output (abbreviated):
```
Changes to be committed:
  renamed:    components.json -> apps/app/components.json
  renamed:    eslint.config.mjs -> apps/app/eslint.config.mjs
  renamed:    next-env.d.ts -> apps/app/next-env.d.ts
  renamed:    next.config.ts -> apps/app/next.config.ts
  renamed:    package.json -> apps/app/package.json
  renamed:    postcss.config.mjs -> apps/app/postcss.config.mjs
  renamed:    public -> apps/app/public
  renamed:    src -> apps/app/src
  renamed:    tsconfig.json -> apps/app/tsconfig.json
  renamed:    vercel.json -> apps/app/vercel.json
  deleted:    package-lock.json

Changes not staged for commit:
  modified:   .gitignore
  modified:   apps/app/package.json
```

- [ ] **Step 7: Commit**

```bash
git add .gitignore apps/app/package.json
git commit -m "chore: move app into apps/app, rename package @trenchcoat/app"
```

---

### Task 2: Create the workspace root package.json

**Files:**
- Create: `package.json` (workspace root)

- [ ] **Step 1: Create root package.json**

Create `/package.json` at the repo root with this exact content:

```json
{
  "name": "trenchcoat-workspace",
  "private": true,
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "dev:app": "bun run --filter @trenchcoat/app dev",
    "dev:marketing": "bun run --filter @trenchcoat/marketing dev",
    "dev:docs": "bun run --filter @trenchcoat/docs dev",
    "build": "bun run --filter '*' build",
    "lint": "bun run --filter '*' lint"
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "chore: add workspace root package.json"
```

---

### Task 3: Create service stubs and packages directory

**Files:**
- Create: `apps/marketing/package.json`
- Create: `apps/docs/package.json`
- Create: `packages/.gitkeep`

- [ ] **Step 1: Create the marketing stub**

Create `apps/marketing/package.json`:

```json
{
  "name": "@trenchcoat/marketing",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "echo 'marketing not scaffolded yet'",
    "build": "echo 'marketing not scaffolded yet'"
  }
}
```

- [ ] **Step 2: Create the docs stub**

Create `apps/docs/package.json`:

```json
{
  "name": "@trenchcoat/docs",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "echo 'docs not scaffolded yet'",
    "build": "echo 'docs not scaffolded yet'"
  }
}
```

- [ ] **Step 3: Create the packages directory**

```bash
touch packages/.gitkeep
```

- [ ] **Step 4: Commit**

```bash
git add apps/marketing/package.json apps/docs/package.json packages/.gitkeep
git commit -m "chore: add marketing and docs stubs, reserve packages dir"
```

---

### Task 4: Reinstall dependencies and verify the app runs

**Files:**
- Regenerate: `bun.lock` (bun updates this during install)

- [ ] **Step 1: Remove the old node_modules**

The existing `node_modules/` at the repo root is from the old non-workspace install. Remove it so bun can do a clean workspace install:

```bash
rm -rf node_modules
```

Expected: no output, `node_modules/` directory gone.

- [ ] **Step 2: Run bun install at workspace root**

```bash
bun install
```

Expected: bun resolves all workspaces, installs dependencies, creates a fresh `node_modules/` at the repo root. Output ends with something like:
```
bun install v1.x.x
+ @trenchcoat/app
...
N packages installed
```

If `bun.lock` changed, that's expected — bun regenerates it for the workspace layout.

- [ ] **Step 3: Start the app dev server**

```bash
bun run dev:app
```

Expected: Next.js starts on port 3000. Output includes:
```
▶ Local: http://localhost:3000
```

Open `http://localhost:3000` in a browser and confirm the dashboard loads. Then stop the server with `Ctrl+C`.

- [ ] **Step 4: Run a production build**

```bash
bun run --filter @trenchcoat/app build
```

Expected: Next.js build completes with no errors. Output ends with:
```
✓ Compiled successfully
Route (app) ...
```

- [ ] **Step 5: Commit the updated bun.lock if it changed**

```bash
git status
```

If `bun.lock` appears as modified:

```bash
git add bun.lock
git commit -m "chore: regenerate bun.lock for workspace layout"
```

If it didn't change, skip this step.

---

### Task 5: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the Commands section**

In `CLAUDE.md`, find the Commands section and update it to reflect the new workspace structure:

Replace:
```markdown
- `bun run dev` — start Next.js dev server (port 3000)
- `bun run build` — production build
- `bun run lint` — ESLint (flat config, Next.js core-web-vitals + typescript presets)
```

With:
```markdown
- `bun run dev:app` — start the Next.js dashboard dev server (port 3000). Run from repo root.
- `bun run --filter @trenchcoat/app build` — production build for the app service
- `bun run --filter @trenchcoat/app lint` — ESLint for the app service
- `bun install` — install all workspace dependencies (run from repo root)
```

- [ ] **Step 2: Update any file paths in CLAUDE.md that changed**

Search `CLAUDE.md` for references to paths that moved. Specifically update:

- `src/middleware.ts` → `apps/app/src/middleware.ts`
- `src/lib/supabase/` → `apps/app/src/lib/supabase/`
- `src/lib/services/` → `apps/app/src/lib/services/`
- `src/app/api/v1/` → `apps/app/src/app/api/v1/`
- `src/components/` → `apps/app/src/components/`
- `src/lib/` → `apps/app/src/lib/`
- Any other `src/` prefixed paths

Do not change references to `supabase/`, `plugin-example/`, or `docs/` — those stayed at the root.

- [ ] **Step 3: Add a Workspace Structure section**

Add this section near the top of `CLAUDE.md`, after the "What This Project Is" section:

```markdown
## Workspace Structure

This is a bun workspaces monorepo. Three services live under `apps/`:

| Directory | Framework | Domain |
|---|---|---|
| `apps/app/` | Next.js 16 | `app.trenchcoat.com` |
| `apps/marketing/` | Astro (stub) | `trenchcoat.com` |
| `apps/docs/` | Nextra or Fumadocs (stub) | `docs.trenchcoat.com` |

Shared infrastructure (`supabase/`, `plugin-example/`) stays at the repo root. Run `bun install` from the repo root to install all workspace dependencies.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for monorepo workspace structure"
```

---

### Task 6: Configure Vercel projects (manual, dashboard steps)

This task has no code changes. It creates three separate Vercel projects all pointed at the same GitHub repo.

- [ ] **Step 1: Create the app Vercel project**

In the Vercel dashboard:
1. "Add New Project" → import the `trenchcoat-app` GitHub repo
2. Set **Root Directory** to `apps/app`
3. Framework: Next.js (auto-detected)
4. Add all environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `CRON_SECRET`
5. Set custom domain: `app.trenchcoat.com`

If a Vercel project already exists for this repo, update its Root Directory setting to `apps/app` and verify env vars are present.

- [ ] **Step 2: Create the marketing Vercel project**

In the Vercel dashboard:
1. "Add New Project" → import the same `trenchcoat-app` GitHub repo (a second time)
2. Set **Root Directory** to `apps/marketing`
3. Framework: Astro (auto-detected once scaffolded; select manually if not)
4. No Supabase env vars needed initially
5. Set custom domain: `trenchcoat.com` (root domain)

Skip deployment until `apps/marketing/` is actually scaffolded — the stub's `echo` script will cause a build failure.

- [ ] **Step 3: Create the docs Vercel project**

In the Vercel dashboard:
1. "Add New Project" → import the same `trenchcoat-app` GitHub repo (a third time)
2. Set **Root Directory** to `apps/docs`
3. Framework: Next.js (Nextra/Fumadocs are both Next.js based)
4. No Supabase env vars needed initially
5. Set custom domain: `docs.trenchcoat.com`

Skip deployment until `apps/docs/` is actually scaffolded.

---

## Done

After Task 5 (and Task 6 when ready), the repo is fully reorganized. Verify the final structure:

```bash
ls apps/
# app  docs  marketing

ls apps/app/src/
# app  components  lib  middleware.ts  types

ls packages/
# .gitkeep

cat package.json | grep name
# "name": "trenchcoat-workspace"

cat apps/app/package.json | grep name
# "name": "@trenchcoat/app"
```
