# Marketing Site Design

**Date:** 2026-05-12
**Status:** Approved

## Overview

Scaffold and ship `apps/marketing/` as the public marketing site for Trenchcoat at `trenchcoat.com`. The site's sole job is to convert visitors — both developers and engineering managers — into free-tier signups at `app.trenchcoat.com/signup`. MVP scope is two pages: Homepage and Pricing.

## Goals & Audience

**Primary visitors:** Developers evaluating Trenchcoat themselves AND engineering managers/CTOs deciding whether to adopt it for their team. The site must speak to both without sacrificing clarity for either.

**Primary conversion goal:** Self-serve signup (freemium). No demo booking, no waitlist. Every CTA points to `app.trenchcoat.com/signup`.

**Secondary conversion:** `app.trenchcoat.com` is the product. The marketing site is a thin shell — keep it lean and keep copy close to the truth of the product.

## Tech Stack

| Concern | Choice |
|---|---|
| Framework | Astro 5 |
| Styling | Tailwind CSS v4 |
| Components | Pure `.astro` — no React, no islands |
| Fonts | Inter (Google Fonts, loaded in `Base.astro`) |
| Images | Astro `<Image>` with assets in `src/assets/` (optimizer runs at build time) |
| Deployment | Vercel static (`@astrojs/vercel/static`), Root Directory: `apps/marketing` |
| Domain | `trenchcoat.com` |

No component library. No JS framework integration. All CTAs are plain `<a>` links to `app.trenchcoat.com`.

## Directory Structure

```
apps/marketing/
├── src/
│   ├── pages/
│   │   ├── index.astro          ← homepage
│   │   └── pricing.astro        ← pricing page
│   ├── components/
│   │   ├── Nav.astro
│   │   ├── Footer.astro
│   │   ├── Hero.astro           ← headline/subhead/CTA passed as props (A/B ready)
│   │   ├── ProductScreenshot.astro
│   │   ├── Features.astro       ← 3-column feature grid
│   │   ├── CtaBanner.astro
│   │   └── pricing/
│   │       ├── PricingCard.astro
│   │       └── FeatureRow.astro
│   └── layouts/
│       └── Base.astro           ← HTML shell, <head>, fonts, meta tags
├── src/
│   └── assets/
│       └── (screenshot images — optimized by Astro <Image> at build time)
├── public/
│   └── (favicon, og-image, other static assets served as-is)
├── astro.config.mjs
├── tailwind.config.mjs
└── package.json                 ← name: "@trenchcoat/marketing" (stub already exists)
```

## Visual Design

**Style:** Light & professional. White backgrounds, clean typography, minimal decoration. Comparable to Stripe, Intercom, Notion.

**Colors:** Neutral gray scale extended with indigo as the brand accent (matches primary action color in `apps/app/`). Defined in `tailwind.config.mjs`.

**Typography:** Inter. Heading scale via Tailwind's `text-` utilities. No custom font size config needed.

## Homepage (`/`)

**Section order:** Nav → Hero → Product Screenshot → Features → CTA Banner → Footer

### Nav
- Left: Trenchcoat wordmark/logo
- Right: `Pricing` link | `Docs` link (→ `docs.trenchcoat.com`) | `Sign up` button (→ `app.trenchcoat.com/signup`)

### Hero
Copy passed as props to enable A/B testing without touching the component:
- **Headline (default):** "Monitor, meter, and report on every AI agent in your org"
- **Subheading:** "Trenchcoat gives engineering teams complete visibility into AI agent usage, token spend, and session activity — from Claude Code to your entire stack."
- **Primary CTA:** "Get started free" → `app.trenchcoat.com/signup`
- **Secondary CTA:** "View docs" → `docs.trenchcoat.com`
- **Below CTA:** "No credit card required"

Alternative hero variants (A/B candidates):
- Cost angle: "Know exactly what your AI agents are costing you"
- Visibility angle: "Complete observability for your AI agent stack"

### Product Screenshot
Real screenshot of the Trenchcoat dashboard (sessions overview or cost page), displayed inside a browser chrome mockup frame. Stored in `src/assets/` so Astro's `<Image>` component can optimize it at build time (format conversion, lazy loading, correct `width`/`height` to prevent CLS).

### Features (3 columns)
1. **Session tracking** — "See every session, every agent, every tool call in one place"
2. **Cost attribution** — "Know exactly what each agent and model is costing your team"
3. **Team access** — "Share dashboards, manage API keys, control who sees what"

### CTA Banner
- Headline: "Get visibility into your AI agents in minutes"
- Subhead: "Connect the Trenchcoat plugin, events start flowing immediately"
- Button: "Start for free" → `app.trenchcoat.com/signup`

### Footer
Logo + copyright | Links: Pricing, Docs, GitHub (plugin-example repo)

## Pricing Page (`/pricing`)

**Header:** "Simple pricing that scales with your team"
**Subhead:** "Start free, upgrade when you need more"

Three tier cards displayed side by side:

### Free
- Up to [X] events/month
- 1 team member
- 30-day data retention
- Community support
- CTA: "Get started" → `app.trenchcoat.com/signup`

### Pro *(highlighted as "Most popular")*
- Up to [Y] events/month
- Up to [N] team members
- 90-day data retention
- Email support + cost analytics
- CTA: "Start free trial" → `app.trenchcoat.com/signup`

### Enterprise
- Unlimited events
- Unlimited team members
- Custom data retention + SSO
- Priority support / SLA
- CTA: "Contact us" → email or Calendly link

**Below cards:** Feature comparison table — rows are features, columns are tiers, cells are checkmarks or values. No FAQ section in MVP.

*Note: Actual event limits and prices are set by the product team and passed as data to the `PricingCard` component. The design accommodates any values.*

## Vercel Deployment

Separate Vercel project from the app:
- Project name: `trenchcoat-marketing`
- Root Directory: `apps/marketing`
- Framework: Astro (auto-detected)
- Domain: `trenchcoat.com`
- Env vars: none required at launch

Deploy only after the site is scaffolded and builds successfully. The current stub's `echo` build script will cause a build failure if deployed prematurely.

## Out of Scope (MVP)

- Blog / content hub
- Animation or scroll effects
- Dark mode
- Internationalization
- Analytics integration (can be added to `Base.astro` later)
- A/B testing infrastructure (hero copy is prop-driven, framework is the future work)
