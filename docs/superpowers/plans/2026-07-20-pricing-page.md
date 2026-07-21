# Honest Beta-State Pricing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the marketing site's invented three-tier pricing table with an honest "free during beta" page that makes no unbacked commitments.

**Architecture:** Rewrite `apps/marketing/src/pages/pricing.astro` in place (route and nav/footer links survive), delete the two now-unused pricing sub-components, and update the page's SEO meta description. Verification is build + a grep guard against invented figures + a local visual render — this Astro static site has no unit-test framework, so there is no TDD red/green cycle to run.

**Tech Stack:** Astro 6, Tailwind CSS 4 (via `@tailwindcss/vite`), Bun.

## Global Constraints

- Route `/pricing` MUST remain valid — `Nav.astro` and `Footer.astro` link to it; do not touch those links.
- The page MUST NOT contain any dollar figure, event cap, retention window, team-size limit, or tier name. Specifically none of: `$49`, `50,000`, `1,000,000`, `30-day`, `90-day`, `SSO`, `SLA`, `trial`.
- Beta promise wording is fixed verbatim: "When we introduce paid plans, we'll let you know before anything changes." Notice only — no grandfathering or credit.
- Contact CTA target is `mailto:alex@pando.codes`.
- Reuse existing brand utility classes (`brand-fg`, `brand-fg-muted`, `brand-accent`, `brand-surface`, `brand-border`, etc.) and existing components (`Nav`, `CtaBanner`, `Footer`) — match the visual language of `index.astro`.
- All commands run from `apps/marketing/` unless stated. Working directory root: `/Users/noboa/Business/Pando/trenchcoat/Engineering/trenchcoat-app`.

---

## File Structure

- `src/pages/pricing.astro` — **rewritten.** New body + new `<Base description>`. Keeps imports for `Base`, `Nav`, `CtaBanner`, `Footer`; drops imports for `PricingCard` and `FeatureRow`.
- `src/components/pricing/PricingCard.astro` — **deleted.**
- `src/components/pricing/FeatureRow.astro` — **deleted.**
- `src/components/pricing/` — **removed** (empty after deletions).

Only `pricing.astro` imports the two components (verified by grep in the spec). No other file references them.

---

### Task 1: Rewrite the pricing page body and meta description

**Files:**
- Modify (full rewrite): `apps/marketing/src/pages/pricing.astro`

**Interfaces:**
- Consumes (unchanged, already in repo): `../layouts/Base.astro` (props `title: string`, `description?: string`), `../components/Nav.astro`, `../components/CtaBanner.astro`, `../components/Footer.astro`.
- Produces: nothing consumed by later tasks. Task 2 depends only on the fact that this file no longer imports `PricingCard`/`FeatureRow`.

- [ ] **Step 1: Replace the entire file contents**

Overwrite `apps/marketing/src/pages/pricing.astro` with exactly:

```astro
---
import Base from '../layouts/Base.astro';
import Nav from '../components/Nav.astro';
import CtaBanner from '../components/CtaBanner.astro';
import Footer from '../components/Footer.astro';

const contactHref = 'mailto:alex@pando.codes';

const included = [
  'Session timeline with outcome signals',
  'Cache-aware cost attribution',
  'Agent spawn tree',
  'Skill analytics',
  'Eval tagging and scores',
  'Team sharing and API keys',
];
---
<Base
  title="Pricing"
  description="Trenchcoat is free while in beta — every feature, no usage caps, no credit card."
>
  <Nav />
  <main>
    <section class="py-20">
      <div class="mx-auto max-w-3xl px-6 text-center">
        <p class="mb-4 text-xs font-medium uppercase tracking-widest text-brand-accent">Pricing</p>
        <h1 class="text-4xl font-semibold text-brand-fg" style="letter-spacing: -0.03em">
          Free while Trenchcoat is in beta
        </h1>
        <p class="mt-4 text-xl text-brand-fg-muted">
          Every feature, no usage caps, no credit card. Connect the plugin and start today.
        </p>
      </div>

      <div class="mx-auto mt-12 max-w-2xl px-6">
        <div class="rounded-xl border border-brand-border bg-brand-surface p-8">
          <p class="leading-relaxed text-brand-fg-muted">
            Trenchcoat is free to use while we're in beta. Every feature is
            available and nothing is metered. When we introduce paid plans,
            we'll let you know before anything changes.
          </p>
        </div>
      </div>

      <div class="mx-auto mt-16 max-w-2xl px-6">
        <h2 class="text-2xl font-semibold text-brand-fg" style="letter-spacing: -0.02em">
          What you get today
        </h2>
        <ul class="mt-6 flex flex-col gap-3">
          {included.map(item => (
            <li class="flex items-start gap-3">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="mt-0.5 h-5 w-5 shrink-0 text-brand-accent"
                aria-hidden="true"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
              <span class="leading-relaxed text-brand-fg">{item}</span>
            </li>
          ))}
        </ul>
      </div>

      <div class="mx-auto mt-16 max-w-2xl px-6 text-center">
        <p class="text-lg text-brand-fg-muted">
          Building something bigger, or need to talk about your team?
        </p>
        <a
          href={contactHref}
          class="mt-4 inline-block rounded-lg border border-brand-border-strong px-6 py-3 text-base font-medium text-brand-fg-muted transition-colors hover:border-brand-fg-faint hover:text-brand-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
        >
          Get in touch
        </a>
      </div>
    </section>

    <CtaBanner />
  </main>
  <Footer />
</Base>
```

- [ ] **Step 2: Confirm no forbidden strings remain and stale imports are gone**

Run from `apps/marketing/`:

```bash
grep -nE '\$49|50,000|1,000,000|30-day|90-day|\bSSO\b|\bSLA\b|\btrial\b|PricingCard|FeatureRow' src/pages/pricing.astro
```

Expected: no output (exit code 1). Any match is a failure — fix before continuing.

- [ ] **Step 3: Build the site**

Run from `apps/marketing/`:

```bash
bun run build
```

Expected: build completes with no errors; output ends with the Astro "Complete!" summary and `dist/pricing/index.html` is regenerated. An import error for `PricingCard`/`FeatureRow` here means Step 1 wasn't saved correctly.

- [ ] **Step 4: Commit**

Run from repo root:

```bash
git add apps/marketing/src/pages/pricing.astro
git commit -m "fix(marketing): replace invented pricing tiers with honest beta-free page"
```

---

### Task 2: Delete the orphaned pricing components

**Files:**
- Delete: `apps/marketing/src/components/pricing/PricingCard.astro`
- Delete: `apps/marketing/src/components/pricing/FeatureRow.astro`
- Remove: `apps/marketing/src/components/pricing/` (empty directory)

**Interfaces:**
- Consumes: depends on Task 1 having removed the last imports of these components.
- Produces: nothing.

- [ ] **Step 1: Verify nothing still imports the components**

Run from `apps/marketing/`:

```bash
grep -rn "PricingCard\|FeatureRow" src/
```

Expected: no output (exit code 1). If anything matches, stop — Task 1 is incomplete and deleting now would break the build.

- [ ] **Step 2: Delete the components and their directory**

Run from repo root:

```bash
git rm apps/marketing/src/components/pricing/PricingCard.astro \
       apps/marketing/src/components/pricing/FeatureRow.astro
rmdir apps/marketing/src/components/pricing 2>/dev/null || true
```

(`git rm` stages the deletions; `rmdir` clears the now-empty dir if the filesystem still shows it.)

- [ ] **Step 3: Rebuild to confirm nothing broke**

Run from `apps/marketing/`:

```bash
bun run build
```

Expected: build completes with no errors.

- [ ] **Step 4: Commit**

Run from repo root:

```bash
git add -A apps/marketing/src/components/
git commit -m "chore(marketing): remove orphaned pricing tier components"
```

---

### Task 3: Visual verification of the rendered page

**Files:** none modified. This is a read-only confirmation gate.

**Interfaces:** none.

- [ ] **Step 1: Start the preview server**

Run from `apps/marketing/` in the background:

```bash
bun run preview
```

Astro `preview` serves the built `dist/` (default port 4321). Note the printed local URL.

- [ ] **Step 2: Render and read the page**

Open the preview URL's `/pricing` route in a browser (or the claude-in-chrome tooling) and confirm by reading the rendered page:
- Headline reads "Free while Trenchcoat is in beta".
- The commitment paragraph contains the exact sentence "When we introduce paid plans, we'll let you know before anything changes."
- The "What you get today" list shows all six items.
- The contact button links to `mailto:alex@pando.codes`.
- No prices, caps, retention windows, tier names, SSO, SLA, or trial language appear anywhere.
- `Nav` and `Footer` still render, and the footer/nav still show a working "Pricing" link.

- [ ] **Step 3: Stop the preview server**

Terminate the background `bun run preview` process.

- [ ] **Step 4 (only if any tweak was needed): commit fixes**

If Step 2 surfaced a wording or layout problem, fix it in `pricing.astro`, rerun `bun run build`, then:

```bash
git add apps/marketing/src/pages/pricing.astro
git commit -m "fix(marketing): pricing page copy/layout adjustments from visual review"
```

If no tweak was needed, skip this step.

---

## Self-Review

**Spec coverage:**
- Header / commitment block / "what you get today" / contact → Task 1 Step 1. ✅
- Removes all invented figures → Task 1 Step 2 grep guard + Global Constraints. ✅
- Meta `<Base description>` rewritten → Task 1 Step 1 (`description="Trenchcoat is free while in beta…"`). ✅
- Route + nav/footer links survive → route unchanged, Task 1 touches only `pricing.astro`; Global Constraints forbids touching the links. ✅
- Delete `PricingCard`, `FeatureRow`, and the `pricing/` dir → Task 2. ✅
- Beta promise wording exact → Global Constraints + Task 1 Step 1 body + Task 3 Step 2 check. ✅
- Contact = `mailto:alex@pando.codes` → Task 1 Step 1 + Task 3 check. ✅
- Verification: build, grep guard, local render → Task 1 Step 3, Task 1 Step 2, Task 3. ✅
- Scope boundary (no Features/screenshot/packages changes) → no task touches them. ✅

**Placeholder scan:** No TBD/TODO; every code step shows full content; grep and build commands have explicit expected output. ✅

**Type consistency:** `contactHref` and `included` are the only locals, defined and used within Task 1's single file. Component/layout prop usage (`title`, `description`) matches `Base.astro`'s actual interface confirmed in the repo. ✅

**Note on brand classes:** `border-brand-border-strong` and `hover:border-brand-fg-faint` on the contact button are copied verbatim from the existing secondary CTA in `Hero.astro`, so they are known-valid utility classes in this project.
