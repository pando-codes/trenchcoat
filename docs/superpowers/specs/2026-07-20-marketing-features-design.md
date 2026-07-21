# Marketing Features Section — Reflect the Real Product

**Date:** 2026-07-20
**Author:** Alex Noboa (with Claude)
**Status:** Approved design, pending implementation plan

## Problem

`apps/marketing/src/components/Features.astro` shows three cards — session
tracking, cost attribution, team access — and repeats a single chevron icon on
each. It predates most of the shipped product: evals, the agent spawn tree,
skill analytics, cache-aware cost, and the session timeline are all invisible.
The pricing page already advertises the session timeline and evals, so the
homepage currently under-sells relative to a sibling page.

## Decision

Replace the three cards with a curated **six**, each grounded in a shipped
dashboard surface, using a **capability + outcome** voice (name the capability,
then one line on what it lets the team do). Give each card its own icon,
mirroring the dashboard sidebar's lucide icons. Keep the existing grid, card
styling, and section layout unchanged.

Rejected alternatives:

- **Rewritten three.** Tightest, but still omits evals, skills, and teams.
- **All eight surfaces.** Complete but diluting — Activity and Tools are weak
  cards next to evals and the agent tree.
- **Bento layout.** More editorial, but real new CSS and breakpoint risk for a
  contained content fix.

## Card set and copy (final)

Order top-to-bottom, left-to-right (two rows of three):

| # | Title | Icon (lucide) | Copy |
|---|---|---|---|
| 1 | Session timeline | Terminal | Replay any session turn by turn — every tool call, error, and stop reason, with time spent per phase. |
| 2 | Cache-aware cost | DollarSign | Real cost per session and per agent, priced from live model rates with cache reads and writes counted. |
| 3 | Agent tracing | Bot | Trace the full spawn tree a session launches — model, tool count, cost, and latency for every subagent. |
| 4 | Evals | FlaskConical | Tag sessions and record eval scores through the API to track agent quality over time. |
| 5 | Skill analytics | Sparkles | See which skills your agents reach for, and how often, across every session. |
| 6 | Team access | Users | Share dashboards, manage API keys, and control who sees what. |

Accuracy anchors: #1 = sessions timeline with outcome signals (turn grouping,
tool preview, errors, phases, stop reasons); #2 = July cache-aware cost work
(`price_tokens`, cache token capture); #3 = agent spawn tree with per-agent
model/tool count/cost/latency; #4 = eval tagging + `POST /api/v1/evals/scores`;
#5 = skill stats; #6 = existing "Team access" copy, kept because it is already
true.

## Structure

Single file: `apps/marketing/src/components/Features.astro`.

- The grid, card container classes, icon-tile classes
  (`bg-brand-accent-tint`, `text-brand-accent`, `h-5 w-5`), heading and body
  text classes are all **unchanged**. `md:grid-cols-3` already wraps six cards
  into two rows.
- The `features` array grows from 3 to 6 entries. Each entry gains an
  `icon` field whose value is the raw inner SVG markup (paths/lines/circles)
  for that card's icon. The `.map()` renders each card's icon via
  `set:html={feature.icon}` inside the existing `<svg>` wrapper.
- No new dependency. The Astro marketing app does not import `lucide-react`;
  icon geometry is inlined as raw SVG, exactly as `Footer.astro` already does
  for its sun/moon toggle. Paths below are lifted verbatim from the installed
  `lucide-react` (the same icons the dashboard sidebar renders).
- No section heading is added; the current bare-grid layout is preserved.

### Icon geometry (verbatim from lucide, viewBox `0 0 24 24`)

Each card's `<svg>` uses the icon-tile's existing wrapper attributes. To match
lucide's native stroke look, the wrapper for these icons uses
`fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
stroke-linejoin="round"` (lucide's defaults), replacing the current chevron
wrapper's `stroke-width="3.5" stroke-linecap="square" stroke-linejoin="miter"`.

- **Terminal:** `<path d="M12 19h8"/><path d="m4 17 6-6-6-6"/>`
- **DollarSign:** `<line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>`
- **Bot:** `<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>`
- **FlaskConical:** `<path d="M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2"/><path d="M6.453 15h11.094"/><path d="M8.5 2h7"/>`
- **Sparkles:** `<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/>`
- **Users:** `<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M16 3.128a4 4 0 0 1 0 7.744"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/>`

Each card's `<svg>` carries `aria-hidden="true"` (decorative), as the current
icons do — the adjacent `<h3>` title carries the meaning.

## Verification

1. `bun run build` succeeds in `apps/marketing`.
2. Rendered `dist/index.html` contains all six card titles and all six copy
   strings.
3. Each of the six distinct icon path signatures appears once in the rendered
   HTML (no single icon repeated six times).
4. Render the homepage locally and confirm two clean rows of three cards with
   distinct icons, correct copy, and no layout regression.

## Scope boundary

Homepage Features section only (`Features.astro`). Does not touch the hero,
the placeholder dashboard screenshot, the OpenAI/Copilot packages, or any
dashboard/docs surface — those remain separate follow-up work. The card copy
is deliberately consistent with the already-shipped pricing page's "what you
get today" list.
