# Product Strategy

## Strategic Context

AI coding agents are becoming standard tooling for software engineers. Claude Code is the leading platform, with a rich plugin ecosystem of skills, tools, subagents, and hooks. Engineers and teams are adopting these agents rapidly — but telemetry, observability, and cost visibility lag far behind.

Existing solutions (raw Supabase data, billing dashboards, manual logging) require engineering effort to produce any insight. There is no purpose-built tool that answers the engineer's first question: "Which of my agents and tools are actually delivering value?"

Trenchcoat owns this gap.

## Strategic Themes

### Theme 1: Agent Value Clarity for Individual Engineers

**Problem**: Engineers can't tell which agents, skills, tools, and subagents are actually valuable — so they can't improve their usage or justify continued investment.

**Target Persona**: Individual engineer using Claude Code daily.

**Desired Outcome**: After each session (and in aggregate over time), an engineer can answer:
- Which tools and agents ran most frequently?
- Which drove the most token consumption / cost?
- How does this session compare to my baseline?

**Key Capabilities**:
- Per-session breakdown: tools used, agents invoked, cost incurred
- Ranked view of tools and agents by usage frequency and cost
- Session history with search and filtering

**Key Assumptions**:
- Engineers care enough about agent productivity to check a dashboard
- Claude Code hook data is rich enough to surface meaningful patterns without additional instrumentation

---

### Theme 2: Cost Transparency and Session Spend

**Problem**: Engineers and teams have no idea how much their AI sessions cost or what's driving the cost.

**Target Persona**: Individual engineer (primary); technical lead preparing budget reports (secondary).

**Desired Outcome**: At any point, a user can see:
- How much a session cost
- Which model, agents, and tools drove the most spend
- Team-level aggregates for budget reporting

**Key Capabilities**:
- Session cost derived from model + token data
- Cost breakdown by component (tool, skill, subagent, hook)
- Aggregate cost views (daily, weekly, by team member)

**Key Assumptions**:
- Token attribution data is available (or can be derived) per component type
- Model pricing rates are maintainable and accurate

---

### Theme 3: Executive and Budget Reporting

**Problem**: Technical leads and managers lack a clean, fast way to summarize AI tool ROI for budget decision makers.

**Target Persona**: Technical lead / engineering manager building upward visibility.

**Desired Outcome**: A manager can produce a summary of team AI usage, spend, and activity patterns without manual data wrangling.

**Key Capabilities**:
- Team-level dashboards with date range filtering
- Exportable summaries (CSV, shareable views)
- Usage trends over time (sessions, cost, tool adoption)

**Key Assumptions**:
- Managers will use Trenchcoat if engineers are already using it (bottom-up adoption)
- Reporting needs are satisfied by aggregate views, not raw event data

---

## Sequencing

**Now — Theme 1 (Agent Value Clarity)**
This is the core value proposition and the reason an individual engineer signs up. Without this, Themes 2 and 3 have no foundation. Focus here until engineers consistently report that Trenchcoat answers "which agents are working."

**Next — Theme 2 (Cost Transparency)**
Cost is the second most urgent pain point and a natural complement to usage data. Unlocks the budget reporting use case.

**Later — Theme 3 (Executive Reporting)**
Flows from Themes 1 and 2. Build this when bottom-up adoption creates pull from managers asking for team-level views.

---

## What We're NOT Doing

- **Real-time alerting or agent monitoring** — Trenchcoat is a retrospective analytics tool, not an operations monitor.
- **Supporting non-Claude-Code platforms** in the near term — depth on Claude Code before breadth across platforms.
- **Building custom agent integrations** for enterprise customers — self-serve plugin instrumentation is the model.
- **Competing on raw data volume or query flexibility** — we compete on clarity, not completeness.

---

## How We'll Know It's Working

**Theme 1 indicators:**
- Engineers return to the dashboard after sessions (retention)
- "Tools" and "Activity" pages have high engagement vs. Overview

**Theme 2 indicators:**
- Cost data is present and accurate for >80% of sessions
- Engineers can cite their per-session cost without looking it up (memory formation)

**Theme 3 indicators:**
- Team-level dashboards created by managers
- Exports and shared views generated per month
