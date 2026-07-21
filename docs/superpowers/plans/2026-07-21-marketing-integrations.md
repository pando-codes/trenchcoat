# Coming-Soon Integrations Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Represent the two unpublished integration packages honestly as an "in development" homepage section, and correct the hero's "entire stack" overclaim.

**Architecture:** Add a new `Integrations.astro` component (two "In development" cards, visually distinct from the shipped Features cards), render it between `<Features />` and `<CtaBanner />` in `index.astro`, and change one clause of the hero subheading. Verification is build + rendered-HTML grep (present/absent guards) + a local visual pass — this static Astro app has no unit-test framework.

**Tech Stack:** Astro 6, Tailwind CSS 4 (via `@tailwindcss/vite`), Bun.

## Global Constraints

- Marketing site only. No changes to the packages, no PyPI publishing, no docs.
- Two integration cards, using human-facing names (NOT pip package names): "OpenAI Agents SDK" and "GitHub Copilot".
- Each card MUST show an "In development" pill.
- Card copy verbatim:
  - OpenAI Agents SDK — "Instrument agents built on the OpenAI Agents SDK and stream their telemetry into Trenchcoat."
  - GitHub Copilot — "A Copilot Extension that reports agent activity from your GitHub workflow into Trenchcoat."
- Section placed between `<Features />` and `<CtaBanner />` in `index.astro`.
- Hero subheading tail changes from `— from Claude Code to your entire stack.` to `— starting with Claude Code.` (only that clause; headline and CTAs unchanged).
- The homepage MUST NOT contain any of: `entire stack`, `pip install`, `available now`, `available today`, or any package version number in this section.
- Reuse existing brand utility classes; match the visual language of `Features.astro` / `CtaBanner.astro`. No per-card CTA.
- All commands run from `apps/marketing/` unless stated. Repo root: `/Users/noboa/Business/Pando/trenchcoat/Engineering/trenchcoat-app`.

---

## File Structure

- `apps/marketing/src/components/Integrations.astro` — **new.** Self-contained "coming soon" section: eyebrow + heading + subline + two dashed "In development" cards.
- `apps/marketing/src/pages/index.astro` — **modify.** Import and render `<Integrations />` between `<Features />` and `<CtaBanner />`.
- `apps/marketing/src/components/Hero.astro` — **modify.** Subheading default tail only.

---

### Task 1: Add the Integrations section and correct the hero claim

**Files:**
- Create: `apps/marketing/src/components/Integrations.astro`
- Modify: `apps/marketing/src/pages/index.astro`
- Modify: `apps/marketing/src/components/Hero.astro`

**Interfaces:**
- Consumes: nothing from other tasks. `Integrations.astro` takes no props (matches `Features.astro`).
- Produces: a default-exported Astro component `Integrations` rendered by `index.astro`.

- [ ] **Step 1: Create the Integrations component**

Create `apps/marketing/src/components/Integrations.astro` with exactly:

```astro
---
const integrations = [
  {
    name: 'OpenAI Agents SDK',
    description: 'Instrument agents built on the OpenAI Agents SDK and stream their telemetry into Trenchcoat.',
  },
  {
    name: 'GitHub Copilot',
    description: 'A Copilot Extension that reports agent activity from your GitHub workflow into Trenchcoat.',
  },
];
---
<section class="py-20">
  <div class="mx-auto max-w-4xl px-6">
    <div class="text-center">
      <p class="mb-4 text-xs font-medium uppercase tracking-widest text-brand-accent">Coming soon</p>
      <h2 class="text-3xl font-semibold text-brand-fg" style="letter-spacing: -0.02em">More ways to plug in</h2>
      <p class="mt-4 text-lg text-brand-fg-muted">Trenchcoat is expanding beyond Claude Code.</p>
    </div>
    <div class="mt-12 grid grid-cols-1 gap-8 md:grid-cols-2">
      {integrations.map(integration => (
        <div class="flex flex-col gap-4 rounded-xl border border-dashed border-brand-border-strong bg-brand-surface-2 p-8">
          <span class="inline-flex w-fit items-center rounded-full bg-brand-accent-tint px-3 py-1 text-xs font-medium text-brand-accent">
            In development
          </span>
          <h3 class="text-lg font-semibold text-brand-fg">{integration.name}</h3>
          <p class="leading-relaxed text-brand-fg-muted">{integration.description}</p>
        </div>
      ))}
    </div>
  </div>
</section>
```

- [ ] **Step 2: Render Integrations in index.astro**

In `apps/marketing/src/pages/index.astro`, add the import after the `Features` import (line 6):

```astro
import Features from '../components/Features.astro';
import Integrations from '../components/Integrations.astro';
import CtaBanner from '../components/CtaBanner.astro';
```

And render it between `<Features />` and `<CtaBanner />`:

```astro
    <Features />
    <Integrations />
    <CtaBanner />
```

- [ ] **Step 3: Correct the hero subheading tail**

In `apps/marketing/src/components/Hero.astro` (line 12), replace the `subheading` default. Change only the tail clause:

- From:
```astro
  subheading = 'Trenchcoat gives engineering teams complete visibility into AI agent usage, token spend, and session activity — from Claude Code to your entire stack.',
```
- To:
```astro
  subheading = 'Trenchcoat gives engineering teams complete visibility into AI agent usage, token spend, and session activity — starting with Claude Code.',
```

- [ ] **Step 4: Build the site**

Run from `apps/marketing/`:

```bash
bun run build
```

Expected: build completes with no errors and prints the Astro "Complete!" summary. `dist/index.html` regenerates.

- [ ] **Step 5: Verify required content is present in the rendered HTML**

Run from `apps/marketing/`:

```bash
for s in "Coming soon" "More ways to plug in" "OpenAI Agents SDK" "GitHub Copilot" \
         "Instrument agents built on the OpenAI Agents SDK" \
         "A Copilot Extension that reports agent activity" \
         "starting with Claude Code"; do
  grep -qF "$s" dist/index.html && echo "OK: $s" || echo "MISSING: $s"
done
echo -n "In development pills: "; grep -oF "In development" dist/index.html | wc -l | tr -d ' '
```

Expected: seven `OK:` lines, no `MISSING:`, and `In development pills: 2`.

- [ ] **Step 6: Verify the forbidden phrases are absent**

Run from `apps/marketing/`:

```bash
grep -niE 'entire stack|pip install|available now|available today' dist/index.html && echo "FOUND FORBIDDEN" || echo "CLEAN"
```

Expected: `CLEAN` (grep matches nothing; the `entire stack` overclaim is gone).

- [ ] **Step 7: Commit**

Run from repo root:

```bash
git add apps/marketing/src/components/Integrations.astro \
        apps/marketing/src/pages/index.astro \
        apps/marketing/src/components/Hero.astro
git commit -m "feat(marketing): add in-development integrations section; soften hero claim"
```

---

### Task 2: Visual verification of the rendered homepage

**Files:** none modified. Read-only confirmation gate.

**Interfaces:** none.

- [ ] **Step 1: Start the preview server**

Run from `apps/marketing/` in the background:

```bash
bun run preview
```

Astro `preview` serves the built `dist/` (default port 4321). Note the printed local URL.

- [ ] **Step 2: Render and read the homepage**

Open the preview URL (root `/`) and confirm by reading the rendered page:
- The "Coming soon" / "More ways to plug in" section sits below the Features grid and above the CTA banner.
- Two cards: "OpenAI Agents SDK" and "GitHub Copilot", each with an "In development" pill and a dashed, muted treatment that visibly reads as not-yet-available (distinct from the solid Features cards above).
- The hero subheading ends "— starting with Claude Code." (no "entire stack").
- No layout regression across desktop width.

- [ ] **Step 3: Stop the preview server**

Terminate the background `bun run preview` process.

- [ ] **Step 4 (only if a tweak was needed): commit fixes**

If Step 2 surfaced a problem, fix it in the relevant file, rerun `bun run build`, then:

```bash
git add apps/marketing/src/
git commit -m "fix(marketing): integrations section adjustments from visual review"
```

If no tweak was needed, skip this step.

---

## Self-Review

**Spec coverage:**
- New Integrations section, two cards, human-facing names → Task 1 Step 1. ✅
- "In development" pill on each card → Task 1 Step 1 + Step 5 count check. ✅
- Card copy verbatim → Task 1 Step 1 + Step 5 grep. ✅
- Placement between Features and CtaBanner → Task 1 Step 2. ✅
- Hero tail change to "starting with Claude Code" → Task 1 Step 3 + Step 5 grep. ✅
- Honesty guardrails (no entire stack / pip install / available now / available today) → Task 1 Step 6 grep + Global Constraints. ✅
- Visually distinct from Features (dashed border + surface-2) → Task 1 Step 1 classes + Task 2 visual check. ✅
- No per-card CTA → Task 1 Step 1 (none present). ✅
- Verification: build, present-grep, absent-grep, visual → Task 1 Steps 4–6, Task 2. ✅
- Scope boundary (marketing only) → no task touches packages/docs. ✅

**Placeholder scan:** No TBD/TODO; full component code shown; every verification command has explicit expected output. ✅

**Type consistency:** `integrations` array of `{ name, description }` is the only local, consumed by one `.map()` in the same file. Component name `Integrations` matches the import and render in `index.astro`. Hero edit touches only the `subheading` default string. ✅

**Note on brand classes:** `border-brand-border-strong`, `bg-brand-surface-2`, `bg-brand-accent-tint`, `text-brand-accent`, `text-brand-fg`, `text-brand-fg-muted` are all in active use elsewhere in the marketing components (Hero, Features, CtaBanner, pricing card), so they are known-valid utility classes in this project. `border-dashed` is a stock Tailwind utility.
