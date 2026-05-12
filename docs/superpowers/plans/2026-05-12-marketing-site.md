# Marketing Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold `apps/marketing/` as the Trenchcoat public marketing site with a Homepage and Pricing page, deployable to Vercel at `trenchcoat.com`.

**Architecture:** Astro 6 static site with Tailwind CSS v4 (via Vite plugin). Pure `.astro` components — no React, no islands, no JavaScript shipped to the browser. The stub `package.json` at `apps/marketing/` already exists; this plan fills it out. All CTAs are `<a>` links to `app.trenchcoat.com`.

**Tech Stack:** Astro 6, Tailwind CSS v4 (`@tailwindcss/vite`), bun workspaces, Vercel static hosting.

---

## File Map

| Action | File |
|---|---|
| Modify | `apps/marketing/package.json` |
| Create | `apps/marketing/astro.config.mjs` |
| Create | `apps/marketing/src/styles/global.css` |
| Create | `apps/marketing/src/layouts/Base.astro` |
| Create | `apps/marketing/src/components/Nav.astro` |
| Create | `apps/marketing/src/components/Footer.astro` |
| Create | `apps/marketing/src/components/Hero.astro` |
| Create | `apps/marketing/src/components/ProductScreenshot.astro` |
| Create | `apps/marketing/src/assets/dashboard.png` (screenshot, captured manually) |
| Create | `apps/marketing/src/components/Features.astro` |
| Create | `apps/marketing/src/components/CtaBanner.astro` |
| Create | `apps/marketing/src/pages/index.astro` |
| Create | `apps/marketing/src/components/pricing/PricingCard.astro` |
| Create | `apps/marketing/src/components/pricing/FeatureRow.astro` |
| Create | `apps/marketing/src/pages/pricing.astro` |
| Create | `apps/marketing/public/favicon.svg` |

---

### Task 1: Scaffold Astro project

**Files:**
- Modify: `apps/marketing/package.json`
- Create: `apps/marketing/astro.config.mjs`
- Create: `apps/marketing/src/styles/global.css`
- Create: `apps/marketing/public/favicon.svg`
- Create: `apps/marketing/src/pages/index.astro` (minimal stub to verify dev server)

- [ ] **Step 1: Update package.json with Astro dependencies**

Run from the repo root:

```bash
cd apps/marketing && bun add astro && bun add -D tailwindcss @tailwindcss/vite
```

Then open `apps/marketing/package.json` and update the `scripts` section:

```json
{
  "name": "@trenchcoat/marketing",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "astro dev --port 3001",
    "build": "astro build",
    "preview": "astro preview",
    "lint": "echo 'no linter configured'"
  },
  "dependencies": {
    "astro": "..."
  },
  "devDependencies": {
    "@tailwindcss/vite": "...",
    "tailwindcss": "..."
  }
}
```

(The `bun add` commands above write the actual versions into package.json — just update the `scripts` block.)

- [ ] **Step 2: Create astro.config.mjs**

Create `apps/marketing/astro.config.mjs`:

```js
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  vite: {
    plugins: [tailwindcss()],
  },
});
```

- [ ] **Step 3: Create global CSS**

Create `apps/marketing/src/styles/global.css`:

```css
@import "tailwindcss";
```

- [ ] **Step 4: Create a minimal favicon**

Create `apps/marketing/public/favicon.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="8" fill="#4f46e5"/>
  <text x="16" y="22" text-anchor="middle" font-family="sans-serif" font-size="18" font-weight="bold" fill="white">T</text>
</svg>
```

- [ ] **Step 5: Create a minimal stub index page to verify the dev server**

Create `apps/marketing/src/pages/index.astro`:

```astro
---
import '../styles/global.css';
---
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Trenchcoat</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  </head>
  <body class="bg-white font-sans text-slate-900">
    <h1 class="p-8 text-4xl font-bold">Trenchcoat</h1>
  </body>
</html>
```

- [ ] **Step 6: Verify the dev server starts**

Run from the repo root:

```bash
bun run dev:marketing
```

Expected output:
```
 astro  v6.x.x ready in NNNms

 ┃ Local    http://localhost:3001/
```

Open `http://localhost:3001` and confirm you see "Trenchcoat" in large bold text. Stop the server with `Ctrl+C`.

- [ ] **Step 7: Commit**

```bash
git add apps/marketing/
git commit -m "feat(marketing): scaffold Astro project with Tailwind v4"
```

---

### Task 2: Base layout, Nav, and Footer

**Files:**
- Create: `apps/marketing/src/layouts/Base.astro`
- Create: `apps/marketing/src/components/Nav.astro`
- Create: `apps/marketing/src/components/Footer.astro`

- [ ] **Step 1: Create Base.astro layout**

Create `apps/marketing/src/layouts/Base.astro`:

```astro
---
import '../styles/global.css';

interface Props {
  title: string;
  description?: string;
}

const {
  title,
  description = 'Monitor, meter, and report on every AI agent in your org.',
} = Astro.props;
---
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content={description} />
    <title>{title} — Trenchcoat</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
      rel="stylesheet"
    />
  </head>
  <body class="bg-white font-sans text-slate-900 antialiased" style="font-family: 'Inter', sans-serif;">
    <slot />
  </body>
</html>
```

- [ ] **Step 2: Create Nav.astro**

Create `apps/marketing/src/components/Nav.astro`:

```astro
---
const navLinks = [
  { href: '/pricing', label: 'Pricing' },
  { href: 'https://docs.trenchcoat.com', label: 'Docs' },
];
const signupUrl = 'https://app.trenchcoat.com/signup';
---
<nav class="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur">
  <div class="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
    <a href="/" class="text-lg font-semibold text-slate-900">Trenchcoat</a>
    <div class="flex items-center gap-6">
      {navLinks.map(link => (
        <a
          href={link.href}
          class="text-sm text-slate-600 transition-colors hover:text-slate-900"
        >
          {link.label}
        </a>
      ))}
      <a
        href={signupUrl}
        class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
      >
        Sign up
      </a>
    </div>
  </div>
</nav>
```

- [ ] **Step 3: Create Footer.astro**

Create `apps/marketing/src/components/Footer.astro`:

```astro
---
const currentYear = new Date().getFullYear();
const footerLinks = [
  { href: '/pricing', label: 'Pricing' },
  { href: 'https://docs.trenchcoat.com', label: 'Docs' },
  { href: 'https://github.com/pando-codes/trenchcoat', label: 'GitHub' },
];
---
<footer class="border-t border-slate-200 bg-white">
  <div class="mx-auto flex max-w-6xl items-center justify-between px-6 py-8">
    <p class="text-sm text-slate-500">© {currentYear} Trenchcoat. All rights reserved.</p>
    <div class="flex gap-6">
      {footerLinks.map(link => (
        <a
          href={link.href}
          class="text-sm text-slate-500 transition-colors hover:text-slate-900"
        >
          {link.label}
        </a>
      ))}
    </div>
  </div>
</footer>
```

- [ ] **Step 4: Update index.astro to use Base layout and show Nav/Footer**

Overwrite `apps/marketing/src/pages/index.astro`:

```astro
---
import Base from '../layouts/Base.astro';
import Nav from '../components/Nav.astro';
import Footer from '../components/Footer.astro';
---
<Base title="Trenchcoat">
  <Nav />
  <main>
    <div class="py-32 text-center">
      <h1 class="text-5xl font-bold">Coming soon</h1>
    </div>
  </main>
  <Footer />
</Base>
```

- [ ] **Step 5: Verify in browser**

Run `bun run dev:marketing` from repo root. Open `http://localhost:3001` and confirm:
- Nav appears at the top with logo, Pricing link, Docs link, Sign up button
- Footer appears at the bottom with links
- No console errors

Stop the server.

- [ ] **Step 6: Commit**

```bash
git add apps/marketing/src/layouts/ apps/marketing/src/components/Nav.astro apps/marketing/src/components/Footer.astro apps/marketing/src/pages/index.astro
git commit -m "feat(marketing): add Base layout, Nav, and Footer"
```

---

### Task 3: Hero component

**Files:**
- Create: `apps/marketing/src/components/Hero.astro`

- [ ] **Step 1: Create Hero.astro**

Create `apps/marketing/src/components/Hero.astro`:

```astro
---
interface Props {
  headline?: string;
  subheading?: string;
  primaryCtaLabel?: string;
  secondaryCtaLabel?: string;
  secondaryCtaHref?: string;
}

const {
  headline = 'Monitor, meter, and report on every AI agent in your org',
  subheading = 'Trenchcoat gives engineering teams complete visibility into AI agent usage, token spend, and session activity — from Claude Code to your entire stack.',
  primaryCtaLabel = 'Get started free',
  secondaryCtaLabel = 'View docs',
  secondaryCtaHref = 'https://docs.trenchcoat.com',
} = Astro.props;

const signupUrl = 'https://app.trenchcoat.com/signup';
---
<section class="py-24 text-center">
  <div class="mx-auto max-w-3xl px-6">
    <h1 class="text-5xl font-bold leading-tight tracking-tight text-slate-900">
      {headline}
    </h1>
    <p class="mt-6 text-xl leading-relaxed text-slate-600">
      {subheading}
    </p>
    <div class="mt-10 flex items-center justify-center gap-4">
      <a
        href={signupUrl}
        class="rounded-lg bg-indigo-600 px-6 py-3 text-base font-medium text-white transition-colors hover:bg-indigo-700"
      >
        {primaryCtaLabel}
      </a>
      <a
        href={secondaryCtaHref}
        class="rounded-lg border border-slate-300 px-6 py-3 text-base font-medium text-slate-700 transition-colors hover:border-slate-400 hover:text-slate-900"
      >
        {secondaryCtaLabel}
      </a>
    </div>
    <p class="mt-4 text-sm text-slate-500">No credit card required</p>
  </div>
</section>
```

- [ ] **Step 2: Add Hero to index.astro and verify**

Update `apps/marketing/src/pages/index.astro`:

```astro
---
import Base from '../layouts/Base.astro';
import Nav from '../components/Nav.astro';
import Hero from '../components/Hero.astro';
import Footer from '../components/Footer.astro';
---
<Base title="Trenchcoat">
  <Nav />
  <main>
    <Hero />
  </main>
  <Footer />
</Base>
```

Run `bun run dev:marketing`. Open `http://localhost:3001`. Confirm:
- Large headline centered on the page
- Two buttons: "Get started free" (indigo) and "View docs" (outlined)
- "No credit card required" text below buttons

- [ ] **Step 3: Commit**

```bash
git add apps/marketing/src/components/Hero.astro apps/marketing/src/pages/index.astro
git commit -m "feat(marketing): add Hero component"
```

---

### Task 4: ProductScreenshot component

**Files:**
- Create: `apps/marketing/src/assets/dashboard.png` (screenshot captured manually)
- Create: `apps/marketing/src/components/ProductScreenshot.astro`

- [ ] **Step 1: Capture the dashboard screenshot**

1. Open `http://localhost:3000` (the Trenchcoat app — run `bun run dev:app` from repo root if it's not running)
2. Log in and navigate to the Sessions overview or Cost page — whichever looks most compelling
3. Take a full-width screenshot of the main content area (not the browser window)
4. Crop to 1600×900px or similar 16:9 ratio
5. Save as `apps/marketing/src/assets/dashboard.png`

If you cannot take a screenshot right now, create a placeholder file:

```bash
# Create a 1x1 transparent PNG as a placeholder (replace before launch)
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82' > apps/marketing/src/assets/dashboard.png
```

- [ ] **Step 2: Create ProductScreenshot.astro**

Create `apps/marketing/src/components/ProductScreenshot.astro`:

```astro
---
import { Image } from 'astro:assets';
import dashboardImg from '../assets/dashboard.png';
---
<section class="bg-slate-50 py-16">
  <div class="mx-auto max-w-5xl px-6">
    <div class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
      <!-- Browser chrome mockup bar -->
      <div class="flex items-center gap-2 border-b border-slate-200 bg-slate-100 px-4 py-3">
        <div class="flex gap-1.5">
          <div class="h-3 w-3 rounded-full bg-red-400"></div>
          <div class="h-3 w-3 rounded-full bg-yellow-400"></div>
          <div class="h-3 w-3 rounded-full bg-green-400"></div>
        </div>
        <div class="mx-auto rounded-md border border-slate-200 bg-white px-3 py-1 text-xs text-slate-500">
          app.trenchcoat.com
        </div>
      </div>
      <Image
        src={dashboardImg}
        alt="Trenchcoat dashboard showing AI agent sessions and cost analytics"
        class="w-full"
        loading="eager"
      />
    </div>
  </div>
</section>
```

- [ ] **Step 3: Add to index.astro and verify**

Update `apps/marketing/src/pages/index.astro`:

```astro
---
import Base from '../layouts/Base.astro';
import Nav from '../components/Nav.astro';
import Hero from '../components/Hero.astro';
import ProductScreenshot from '../components/ProductScreenshot.astro';
import Footer from '../components/Footer.astro';
---
<Base title="Trenchcoat">
  <Nav />
  <main>
    <Hero />
    <ProductScreenshot />
  </main>
  <Footer />
</Base>
```

Run `bun run dev:marketing`. Confirm the screenshot appears below the hero inside the browser chrome mockup frame.

- [ ] **Step 4: Commit**

```bash
git add apps/marketing/src/assets/dashboard.png apps/marketing/src/components/ProductScreenshot.astro apps/marketing/src/pages/index.astro
git commit -m "feat(marketing): add ProductScreenshot component"
```

---

### Task 5: Features and CtaBanner components

**Files:**
- Create: `apps/marketing/src/components/Features.astro`
- Create: `apps/marketing/src/components/CtaBanner.astro`

- [ ] **Step 1: Create Features.astro**

Create `apps/marketing/src/components/Features.astro`:

```astro
---
const features = [
  {
    icon: '📊',
    title: 'Session tracking',
    description: 'See every session, every agent, every tool call in one place',
  },
  {
    icon: '💰',
    title: 'Cost attribution',
    description: 'Know exactly what each agent and model is costing your team',
  },
  {
    icon: '👥',
    title: 'Team access',
    description: 'Share dashboards, manage API keys, control who sees what',
  },
];
---
<section class="py-20">
  <div class="mx-auto max-w-6xl px-6">
    <div class="grid grid-cols-1 gap-12 md:grid-cols-3">
      {features.map(feature => (
        <div class="flex flex-col gap-4">
          <div class="text-4xl">{feature.icon}</div>
          <h3 class="text-lg font-semibold text-slate-900">{feature.title}</h3>
          <p class="leading-relaxed text-slate-600">{feature.description}</p>
        </div>
      ))}
    </div>
  </div>
</section>
```

- [ ] **Step 2: Create CtaBanner.astro**

Create `apps/marketing/src/components/CtaBanner.astro`:

```astro
---
const signupUrl = 'https://app.trenchcoat.com/signup';
---
<section class="bg-slate-900 py-20">
  <div class="mx-auto max-w-3xl px-6 text-center">
    <h2 class="text-3xl font-bold text-white">
      Get visibility into your AI agents in minutes
    </h2>
    <p class="mt-4 text-lg text-slate-400">
      Connect the Trenchcoat plugin, events start flowing immediately
    </p>
    <a
      href={signupUrl}
      class="mt-8 inline-block rounded-lg bg-indigo-500 px-8 py-4 text-base font-medium text-white transition-colors hover:bg-indigo-400"
    >
      Start for free
    </a>
  </div>
</section>
```

- [ ] **Step 3: Commit**

```bash
git add apps/marketing/src/components/Features.astro apps/marketing/src/components/CtaBanner.astro
git commit -m "feat(marketing): add Features and CtaBanner components"
```

---

### Task 6: Wire up the complete homepage

**Files:**
- Modify: `apps/marketing/src/pages/index.astro`

- [ ] **Step 1: Update index.astro with all sections**

Overwrite `apps/marketing/src/pages/index.astro`:

```astro
---
import Base from '../layouts/Base.astro';
import Nav from '../components/Nav.astro';
import Hero from '../components/Hero.astro';
import ProductScreenshot from '../components/ProductScreenshot.astro';
import Features from '../components/Features.astro';
import CtaBanner from '../components/CtaBanner.astro';
import Footer from '../components/Footer.astro';
---
<Base
  title="Trenchcoat"
  description="Monitor, meter, and report on every AI agent in your org."
>
  <Nav />
  <main>
    <Hero />
    <ProductScreenshot />
    <Features />
    <CtaBanner />
  </main>
  <Footer />
</Base>
```

- [ ] **Step 2: Verify the complete homepage**

Run `bun run dev:marketing`. Open `http://localhost:3001`. Scroll from top to bottom and verify:
1. Nav — logo, Pricing, Docs, Sign up button
2. Hero — headline, two buttons, "No credit card required"
3. Screenshot section — dashboard image in browser chrome frame
4. Features — three columns: Session tracking, Cost attribution, Team access
5. CTA banner — dark background, "Get visibility" headline, "Start for free" button
6. Footer — copyright + links

- [ ] **Step 3: Commit**

```bash
git add apps/marketing/src/pages/index.astro
git commit -m "feat(marketing): wire up complete homepage"
```

---

### Task 7: Pricing card and feature row components

**Files:**
- Create: `apps/marketing/src/components/pricing/PricingCard.astro`
- Create: `apps/marketing/src/components/pricing/FeatureRow.astro`

- [ ] **Step 1: Create PricingCard.astro**

Create `apps/marketing/src/components/pricing/PricingCard.astro`:

```astro
---
interface Props {
  name: string;
  price: string;
  description: string;
  features: string[];
  ctaLabel: string;
  ctaHref: string;
  highlighted?: boolean;
}

const {
  name,
  price,
  description,
  features,
  ctaLabel,
  ctaHref,
  highlighted = false,
} = Astro.props;
---
<div
  class:list={[
    'flex flex-col rounded-2xl border p-8',
    highlighted
      ? 'border-indigo-600 bg-indigo-50 ring-2 ring-indigo-600'
      : 'border-slate-200 bg-white',
  ]}
>
  {highlighted && (
    <div class="mb-4 self-start rounded-full bg-indigo-600 px-3 py-1 text-xs font-medium text-white">
      Most popular
    </div>
  )}
  <h3 class="text-lg font-semibold text-slate-900">{name}</h3>
  <div class="mt-4 text-4xl font-bold text-slate-900">{price}</div>
  <p class="mt-2 text-sm text-slate-600">{description}</p>
  <ul class="mt-8 flex flex-1 flex-col gap-3">
    {features.map(feature => (
      <li class="flex items-start gap-3 text-sm text-slate-700">
        <svg
          class="mt-0.5 h-4 w-4 shrink-0 text-indigo-600"
          viewBox="0 0 16 16"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
        </svg>
        {feature}
      </li>
    ))}
  </ul>
  <a
    href={ctaHref}
    class:list={[
      'mt-8 block w-full rounded-lg px-6 py-3 text-center text-sm font-medium transition-colors',
      highlighted
        ? 'bg-indigo-600 text-white hover:bg-indigo-700'
        : 'border border-slate-300 text-slate-700 hover:border-slate-400 hover:text-slate-900',
    ]}
  >
    {ctaLabel}
  </a>
</div>
```

- [ ] **Step 2: Create FeatureRow.astro**

Create `apps/marketing/src/components/pricing/FeatureRow.astro`:

```astro
---
interface Props {
  feature: string;
  free: string | boolean;
  pro: string | boolean;
  enterprise: string | boolean;
}

const { feature, free, pro, enterprise } = Astro.props;

function cell(value: string | boolean): string {
  if (value === true) return '✓';
  if (value === false) return '—';
  return value;
}
---
<tr class="border-t border-slate-200">
  <td class="py-4 pr-6 text-sm text-slate-700">{feature}</td>
  <td class="px-6 py-4 text-center text-sm text-slate-700">{cell(free)}</td>
  <td class="px-6 py-4 text-center text-sm font-medium text-indigo-700">{cell(pro)}</td>
  <td class="pl-6 py-4 text-center text-sm text-slate-700">{cell(enterprise)}</td>
</tr>
```

- [ ] **Step 3: Commit**

```bash
git add apps/marketing/src/components/pricing/
git commit -m "feat(marketing): add PricingCard and FeatureRow components"
```

---

### Task 8: Pricing page

**Files:**
- Create: `apps/marketing/src/pages/pricing.astro`

- [ ] **Step 1: Create pricing.astro**

Create `apps/marketing/src/pages/pricing.astro`:

```astro
---
import Base from '../layouts/Base.astro';
import Nav from '../components/Nav.astro';
import PricingCard from '../components/pricing/PricingCard.astro';
import FeatureRow from '../components/pricing/FeatureRow.astro';
import CtaBanner from '../components/CtaBanner.astro';
import Footer from '../components/Footer.astro';

const signupUrl = 'https://app.trenchcoat.com/signup';

// Update these values with actual limits and prices before launch
const tiers = [
  {
    name: 'Free',
    price: '$0',
    description: 'For individuals and small projects',
    features: [
      'Up to 50,000 events/month',
      '1 team member',
      '30-day data retention',
      'Community support',
    ],
    ctaLabel: 'Get started',
    ctaHref: signupUrl,
    highlighted: false,
  },
  {
    name: 'Pro',
    price: '$49/mo',
    description: 'For growing teams that need more',
    features: [
      'Up to 1,000,000 events/month',
      'Up to 10 team members',
      '90-day data retention',
      'Email support',
      'Cost analytics',
    ],
    ctaLabel: 'Start free trial',
    ctaHref: signupUrl,
    highlighted: true,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    description: 'For organizations that need scale',
    features: [
      'Unlimited events',
      'Unlimited team members',
      'Custom data retention',
      'SSO / custom auth',
      'Priority support + SLA',
    ],
    ctaLabel: 'Contact us',
    ctaHref: 'mailto:alex@pando.codes',
    highlighted: false,
  },
];

// Update these values to match actual tier capabilities before launch
const featureRows = [
  { feature: 'Events/month',    free: '50,000',  pro: '1,000,000', enterprise: 'Unlimited' },
  { feature: 'Team members',    free: '1',        pro: '10',         enterprise: 'Unlimited' },
  { feature: 'Data retention',  free: '30 days',  pro: '90 days',    enterprise: 'Custom'    },
  { feature: 'Cost analytics',  free: false,       pro: true,         enterprise: true        },
  { feature: 'Email support',   free: false,       pro: true,         enterprise: true        },
  { feature: 'SSO',             free: false,       pro: false,        enterprise: true        },
  { feature: 'SLA',             free: false,       pro: false,        enterprise: true        },
];
---
<Base
  title="Pricing"
  description="Simple pricing that scales with your team. Start free, upgrade when you need more."
>
  <Nav />
  <main>
    <section class="py-20">
      <div class="mx-auto max-w-6xl px-6">
        <!-- Header -->
        <div class="text-center">
          <h1 class="text-4xl font-bold text-slate-900">
            Simple pricing that scales with your team
          </h1>
          <p class="mt-4 text-xl text-slate-600">Start free, upgrade when you need more</p>
        </div>

        <!-- Tier cards -->
        <div class="mt-16 grid grid-cols-1 gap-8 md:grid-cols-3">
          {tiers.map(tier => <PricingCard {...tier} />)}
        </div>

        <!-- Feature comparison table -->
        <div class="mt-20">
          <h2 class="text-2xl font-bold text-slate-900">Feature comparison</h2>
          <div class="mt-8 overflow-x-auto">
            <table class="w-full">
              <thead>
                <tr>
                  <th class="pb-4 pr-6 text-left text-sm font-medium text-slate-500">Feature</th>
                  <th class="px-6 pb-4 text-center text-sm font-semibold text-slate-900">Free</th>
                  <th class="px-6 pb-4 text-center text-sm font-semibold text-indigo-700">Pro</th>
                  <th class="pl-6 pb-4 text-center text-sm font-semibold text-slate-900">Enterprise</th>
                </tr>
              </thead>
              <tbody>
                {featureRows.map(row => <FeatureRow {...row} />)}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>

    <CtaBanner />
  </main>
  <Footer />
</Base>
```

- [ ] **Step 2: Verify the pricing page**

Run `bun run dev:marketing`. Open `http://localhost:3001/pricing`. Verify:
1. Three pricing cards side by side (Free, Pro highlighted in indigo, Enterprise)
2. Each card has a feature list with checkmark icons
3. Feature comparison table below with checkmarks and dashes
4. CTA banner at bottom
5. Nav "Pricing" link is reachable from the homepage (click it)

- [ ] **Step 3: Commit**

```bash
git add apps/marketing/src/pages/pricing.astro
git commit -m "feat(marketing): add Pricing page"
```

---

### Task 9: Production build verification

- [ ] **Step 1: Run the production build**

From the repo root:

```bash
bun run --filter @trenchcoat/marketing build
```

Expected output:
```
 astro  v6.x.x building for production...
 ✓ Completed in NNNms.

 dist/index.html      X.XX kB
 dist/pricing/index.html  X.XX kB
```

If there are TypeScript or build errors, fix them before continuing.

- [ ] **Step 2: Preview the production build**

```bash
cd apps/marketing && bun run preview
```

Open `http://localhost:4321` (Astro preview default port). Verify both pages work correctly in the production build. Stop the preview server.

- [ ] **Step 3: Add .gitignore entry for marketing dist**

Check if `apps/marketing/dist/` would be committed:

```bash
git status apps/marketing/
```

If `dist/` appears, add it to `.gitignore`. Open `.gitignore` at the repo root and add:

```
apps/marketing/dist/
apps/marketing/.astro/
```

- [ ] **Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore: add marketing build artifacts to .gitignore"
```

---

## Done

After Task 9, the marketing site is fully implemented and production-ready. Verify the final state:

```bash
ls apps/marketing/src/pages/
# index.astro  pricing.astro

ls apps/marketing/src/components/
# CtaBanner.astro  Features.astro  Footer.astro  Hero.astro  Nav.astro  ProductScreenshot.astro  pricing/

bun run --filter @trenchcoat/marketing build
# ✓ Completed
```

**Before deploying to production:**
1. Replace `apps/marketing/src/assets/dashboard.png` with a real screenshot of the Trenchcoat dashboard
2. Update pricing limits and prices in `apps/marketing/src/pages/pricing.astro` (marked with comments)
3. Create the `trenchcoat-marketing` Vercel project, set Root Directory to `apps/marketing`, domain to `trenchcoat.com`
