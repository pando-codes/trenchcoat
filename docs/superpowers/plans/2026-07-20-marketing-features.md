# Expanded Marketing Features Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the homepage's three stale, same-icon feature cards with a curated six that reflect the shipped product, each with its own icon.

**Architecture:** Rewrite the single component `apps/marketing/src/components/Features.astro`. Grow the `features` array from three to six entries, each carrying an `icon` field of raw inner-SVG markup; render it through Astro's `set:html` inside the existing icon-tile `<svg>` wrapper, whose attributes switch from the old 64×64 chevron to lucide's 24×24 round-stroke defaults. Grid, card, and text classes are untouched. Verification is build + rendered-HTML grep + a local visual pass — this static Astro app has no unit-test framework.

**Tech Stack:** Astro 6, Tailwind CSS 4 (via `@tailwindcss/vite`), Bun.

## Global Constraints

- Change ONLY `apps/marketing/src/components/Features.astro`. Do not touch the hero, screenshot, packages, or any dashboard/docs surface.
- Exactly six cards, in this order: Session timeline, Cache-aware cost, Agent tracing, Evals, Skill analytics, Team access.
- Card copy and icon geometry are fixed verbatim — use the exact strings from the spec (reproduced in full in Task 1). Do not paraphrase copy or redraw icons.
- Preserve the existing grid (`grid grid-cols-1 gap-12 md:grid-cols-3`), card container classes, icon-tile classes (`bg-brand-accent-tint`, `h-5 w-5 text-brand-accent`), and text classes. No section heading is added.
- Each card `<svg>` keeps `aria-hidden="true"` (decorative; the `<h3>` carries meaning).
- All commands run from `apps/marketing/` unless stated. Repo root: `/Users/noboa/Business/Pando/trenchcoat/Engineering/trenchcoat-app`.

---

## File Structure

- `apps/marketing/src/components/Features.astro` — **rewritten in full.** Self-contained; no other file imports from it beyond `index.astro` rendering `<Features />`, which is unaffected by internal changes.

---

### Task 1: Rewrite Features.astro with six cards and per-card icons

**Files:**
- Modify (full rewrite): `apps/marketing/src/components/Features.astro`

**Interfaces:**
- Consumes: nothing from other tasks. `index.astro` already renders `<Features />` and needs no change (the component's public usage is unchanged).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Replace the entire file contents**

Overwrite `apps/marketing/src/components/Features.astro` with exactly:

```astro
---
const features = [
  {
    title: 'Session timeline',
    description: 'Replay any session turn by turn — every tool call, error, and stop reason, with time spent per phase.',
    icon: '<path d="M12 19h8"/><path d="m4 17 6-6-6-6"/>',
  },
  {
    title: 'Cache-aware cost',
    description: 'Real cost per session and per agent, priced from live model rates with cache reads and writes counted.',
    icon: '<line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  },
  {
    title: 'Agent tracing',
    description: 'Trace the full spawn tree a session launches — model, tool count, cost, and latency for every subagent.',
    icon: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
  },
  {
    title: 'Evals',
    description: 'Tag sessions and record eval scores through the API to track agent quality over time.',
    icon: '<path d="M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2"/><path d="M6.453 15h11.094"/><path d="M8.5 2h7"/>',
  },
  {
    title: 'Skill analytics',
    description: 'See which skills your agents reach for, and how often, across every session.',
    icon: '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/>',
  },
  {
    title: 'Team access',
    description: 'Share dashboards, manage API keys, and control who sees what.',
    icon: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M16 3.128a4 4 0 0 1 0 7.744"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/>',
  },
];
---

<section class="py-20">
  <div class="mx-auto max-w-6xl px-6">
    <div class="grid grid-cols-1 gap-12 md:grid-cols-3">
      {features.map(feature => (
        <div class="flex flex-col gap-4 rounded-xl border border-brand-border bg-brand-surface p-8">
          <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-accent-tint">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="h-5 w-5 text-brand-accent"
              aria-hidden="true"
              set:html={feature.icon}
            />
          </div>
          <h3 class="text-lg font-semibold text-brand-fg">{feature.title}</h3>
          <p class="leading-relaxed text-brand-fg-muted">{feature.description}</p>
        </div>
      ))}
    </div>
  </div>
</section>
```

Note: `set:html` is an Astro directive that injects the raw markup as the `<svg>`'s children; the element is written self-closing because its children come from the directive. The em dashes (`—`) in the copy are intentional and are valid UTF-8.

- [ ] **Step 2: Build the site**

Run from `apps/marketing/`:

```bash
bun run build
```

Expected: build completes with no errors and prints the Astro "Complete!" summary. `dist/index.html` is regenerated.

- [ ] **Step 3: Verify all six titles and copy strings render**

Run from `apps/marketing/`:

```bash
for s in "Session timeline" "Cache-aware cost" "Agent tracing" "Evals" "Skill analytics" "Team access" \
         "Replay any session turn by turn" "priced from live model rates" "Trace the full spawn tree" \
         "record eval scores through the API" "which skills your agents reach for" "control who sees what"; do
  grep -qF "$s" dist/index.html && echo "OK: $s" || echo "MISSING: $s"
done
```

Expected: twelve `OK:` lines, no `MISSING:`.

- [ ] **Step 4: Verify the six icons are distinct (no icon repeated six times)**

Run from `apps/marketing/`. Each pattern is a signature unique to one icon:

```bash
for sig in 'M12 19h8' 'M17 5H9.5' 'width="16" height="12"' 'M14 2v6a2' 'M11.017 2.814' 'M16 21v-2a4'; do
  n=$(grep -oF "$sig" dist/index.html | wc -l | tr -d ' ')
  echo "$n × $sig"
done
```

Expected: each signature appears exactly `1 ×`. (Six distinct icons rendered once each; the old build repeated a single chevron six times, which this replaces.)

- [ ] **Step 5: Commit**

Run from repo root:

```bash
git add apps/marketing/src/components/Features.astro
git commit -m "feat(marketing): expand Features to six real capabilities with distinct icons"
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

Open the preview URL (root `/`) and confirm by reading the rendered Features section:
- Six cards laid out as two clean rows of three on desktop width.
- Each card shows a distinct icon (terminal, dollar sign, bot, flask, sparkles, users) — no two cards share the same glyph.
- Titles and copy match the six specified cards exactly.
- No layout regression: cards align with the hero/CTA sections above and below, card padding and border styling unchanged.

- [ ] **Step 3: Stop the preview server**

Terminate the background `bun run preview` process.

- [ ] **Step 4 (only if a tweak was needed): commit fixes**

If Step 2 surfaced a rendering or layout problem, fix it in `Features.astro`, rerun `bun run build`, then:

```bash
git add apps/marketing/src/components/Features.astro
git commit -m "fix(marketing): Features section rendering adjustments from visual review"
```

If no tweak was needed, skip this step.

---

## Self-Review

**Spec coverage:**
- Six cards, exact order → Task 1 Step 1 array + Global Constraints. ✅
- Exact copy per card → Task 1 Step 1 (verbatim) + Step 3 grep. ✅
- Distinct per-card icons from lucide geometry → Task 1 Step 1 `icon` fields + Step 4 uniqueness check. ✅
- Grid/card/icon-tile/text classes unchanged → Task 1 Step 1 preserves them; Global Constraints forbids other edits. ✅
- svg wrapper switches to lucide 24×24 round-stroke defaults → Task 1 Step 1 (`viewBox="0 0 24 24"`, `stroke-width="2"`, round caps/joins). ✅
- `aria-hidden="true"` retained → Task 1 Step 1 + Global Constraints. ✅
- No section heading added → Task 1 Step 1 (none present). ✅
- Verification: build, content grep, icon-uniqueness grep, visual render → Task 1 Steps 2–4, Task 2. ✅
- Scope boundary (only Features.astro) → no task touches anything else. ✅

**Placeholder scan:** No TBD/TODO; the full file content is shown; every verification command has explicit expected output. ✅

**Type consistency:** The only local is the `features` array; each of its six objects has the same shape `{ title, description, icon }`, all consumed by one `.map()` in the same file. `set:html={feature.icon}` matches the `icon` field name. ✅
