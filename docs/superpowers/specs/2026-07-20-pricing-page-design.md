# Pricing Page — Honest Beta State

**Date:** 2026-07-20
**Author:** Alex Noboa (with Claude)
**Status:** Approved design, pending implementation plan

## Problem

`apps/marketing/src/pages/pricing.astro` publishes a three-tier pricing table
(Free / Pro / Enterprise) with specific numbers — $49/mo, 50,000–1,000,000
event caps, 30/90-day retention, SSO, SLA, a Pro free trial. None of it is
backed by anything:

- No pricing has been decided. The tiers were placeholder scaffolding; the file
  even carries the comments `// Update these values ... before launch`.
- There is no billing, plan, quota, or retention code anywhere in the app or
  database (no Stripe, no `plan_tier`, no retention enforcement — verified by
  grep across `apps/app/src` and `supabase/migrations`).
- The site is publicly live at trenchcoat.io (no traffic yet), so the page is
  reachable and is making commitments the product cannot honor.

The `<Base description>` meta string — "Simple pricing that scales with your
team. Start free, upgrade when you need more." — is itself a claim, surfaced in
search results and social previews.

## Decision

Replace the tiered page with an honest **"free during beta"** page. Keep the
`/pricing` route and its nav/footer links so the URL survives for a future
pricing v2. Make exactly one forward-looking promise: existing users get notice
before paid plans start.

Rejected alternatives:

- **Delete the page + nav link.** Cheapest, but 404s any existing link and
  leaves a gap in the nav that reads as unfinished. Throws away a URL that will
  matter later.
- **Keep tiers behind a "planned pricing" disclaimer.** Preserves design work,
  but the numbers aren't decided — a banner over invented figures still anchors
  visitors on $49 and a 50k cap we may never ship. Weakest form of honesty.

## Page design

Route unchanged: `src/pages/pricing.astro`. New structure, top to bottom:

1. **Header** — eyebrow "Pricing"; headline "Free while Trenchcoat is in beta";
   one-line subhead: free to use today, no usage caps, no credit card.
2. **Commitment block** — a single short paragraph (not a card grid): every
   feature is available, nothing is metered, and when paid plans arrive existing
   users will be notified before anything changes. This notice clause is the
   only forward-looking promise on the page.
3. **"What you get today"** — a plain list of what actually ships, replacing the
   fake comparison table. Sourced from the real product:
   - Session timeline with outcome signals
   - Cache-aware cost attribution
   - Agent spawn tree
   - Skill analytics
   - Eval tagging and scores
   - Team sharing and API keys
4. **Contact** — "Building something bigger, or need to talk about your team?" →
   `mailto:alex@pando.codes`. Replaces the fake Enterprise tier with the thing
   that tier was actually for.
5. Existing `CtaBanner` and `Footer`, unchanged.

**Explicitly absent** from the page: any dollar figure, event cap, retention
window, team-size limit, or tier name. Retention especially — the old page
promised 30/90-day windows and there is no retention policy in the code, so
saying nothing is the only honest option.

**Beta promise wording (approved):** "When we introduce paid plans, we'll let
you know before anything changes." Notice only — no grandfathering or early-user
credit commitment.

## Files

**Rewritten**

- `src/pages/pricing.astro` — new body, and its `<Base description>` meta string
  (currently "Simple pricing that scales with your team...") replaced to match
  the beta-free framing.

**Deleted**

- `src/components/pricing/PricingCard.astro`
- `src/components/pricing/FeatureRow.astro`
- the now-empty `src/components/pricing/` directory

Only `pricing.astro` imported these (verified by grep). Recoverable from git
history for a future pricing v2.

**Untouched**

- `Nav.astro`, `Footer.astro` — keep their `/pricing` links; the route survives.
- `Hero.astro` — "Get started free" and "No credit card required" stay accurate
  under this design (they would have become false the moment the tiered page's
  billing shipped).

## Verification

1. `bun run build` succeeds in `apps/marketing`.
2. Grep across `apps/marketing/src` for invented figures returns nothing:
   `$49`, `50,000`, `1,000,000`, `30-day`, `90-day`, `SSO`, `SLA`, `trial`.
3. Render the page locally and read it to confirm intent, not just the diff.

## Scope boundary

Pricing page only. The stale homepage Features list, the placeholder dashboard
screenshot, and the unmentioned OpenAI/Copilot packages are known-broken and are
separate follow-up work — deliberately out of scope here to keep this a
contained fix. The "what you get today" list doubles as raw material for the
later Features refresh.
