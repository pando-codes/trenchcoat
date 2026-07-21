# Marketing Site — Honest "Coming Soon" Integrations

**Date:** 2026-07-20
**Author:** Alex Noboa (with Claude)
**Status:** Approved design, pending implementation plan

## Problem

The repo contains two real, tested integration packages:

- `trenchcoat-openai-agents` (v0.1.0) — instrumentation for the OpenAI Agents
  SDK (`TrenchcoatHooks`, `instrument`), 24 tests.
- `trenchcoat-copilot-extension` (v0.1.0) — a GitHub Copilot Extension as a
  FastAPI app (`create_app`, GitHub auth, streaming), 35 tests.

Neither is published to PyPI (both return 404), so the public cannot install or
use them. Meanwhile the homepage hero subheading already claims multi-platform
support that has not shipped:

> "...AI agent usage, token spend, and session activity — from Claude Code to
> your entire stack."

So the site simultaneously **overclaims** (hero implies the whole stack is
covered) and **undersells** (the real multi-platform work is invisible). Both
are fixed by representing the packages honestly as in-development and correcting
the hero.

## Decision

Add a homepage "coming soon" **Integrations** section that presents the two
packages as clearly-labeled *in development*, and soften the hero to reflect
that Claude Code is what ships today.

Rejected alternatives:

- **Publish to PyPI, then market as live.** Correct eventually, but gated on a
  release decision — out of scope for a marketing change.
- **Stay Claude-Code-only, just soften the hero.** Fixes the overclaim but keeps
  the real multi-platform work invisible.
- **Leave the hero as-is.** Leaves a false claim standing.
- **Dedicated `/integrations` page.** A whole new route/nav item for two
  unreleased items — heavier than the content warrants now.

## New section design

New component `apps/marketing/src/components/Integrations.astro`, rendered in
`index.astro` between `<Features />` and `<CtaBanner />`.

Structure:

- Eyebrow "Coming soon"; heading "More ways to plug in"; one-line subline noting
  Trenchcoat is expanding beyond Claude Code.
- Two cards, each carrying a mandatory **"In development"** pill and a visually
  distinct treatment from the shipped Features cards (dashed border + muted
  surface) so they unmistakably read as not-yet-available:
  - **OpenAI Agents SDK** — "Instrument agents built on the OpenAI Agents SDK
    and stream their telemetry into Trenchcoat."
  - **GitHub Copilot** — "A Copilot Extension that reports agent activity from
    your GitHub workflow into Trenchcoat."
- No per-card CTA (informational only; the `CtaBanner` below handles
  conversion).

Cards use human-facing integration names, not the unpublished pip package names.

## Hero change

`apps/marketing/src/components/Hero.astro` — the `subheading` default's tail
changes only:

- From: `...session activity — from Claude Code to your entire stack.`
- To:   `...session activity — starting with Claude Code.`

Headline, CTAs, and all other hero copy are unchanged.

## Honesty guardrails

The section MUST NOT contain, anywhere on the page's Integrations content or the
hero:

- `entire stack` (the removed overclaim)
- `pip install`, `available now`, `available today`, or any install instruction
- any version number for the packages
- any link or button implying the packages can be obtained today

Each integration card MUST show the "In development" pill.

## Files

- **Create:** `apps/marketing/src/components/Integrations.astro`
- **Modify:** `apps/marketing/src/pages/index.astro` — import + render
  `<Integrations />` between `<Features />` and `<CtaBanner />`.
- **Modify:** `apps/marketing/src/components/Hero.astro` — subheading tail only.

## Verification

1. `bun run build` succeeds in `apps/marketing`.
2. Rendered `dist/index.html` contains: "OpenAI Agents SDK", "GitHub Copilot",
   two "In development" pills, and the new hero tail "starting with Claude
   Code".
3. Grep guard on rendered `dist/index.html`: zero occurrences of `entire stack`,
   `pip install`, `available now`, `available today`.
4. Local visual render: the two cards read as clearly not-yet-shipped (pill +
   muted/dashed styling), section sits below Features and above the CTA banner,
   no layout regression.

## Scope boundary

Marketing site only. No changes to the packages, no PyPI publishing, no docs.
Purely how the site represents the packages. Consistent with the honest framing
established by the pricing and Features work.
