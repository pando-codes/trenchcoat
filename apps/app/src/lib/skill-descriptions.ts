const KNOWN_DESCRIPTIONS: Record<string, string> = {
  // superpowers
  "superpowers:brainstorming":                 "Structured brainstorming session to explore approaches before starting implementation.",
  "superpowers:writing-plans":                 "Draft and align on an implementation plan before writing any code.",
  "superpowers:executing-plans":               "Step through an approved plan, marking tasks complete as work progresses.",
  "superpowers:systematic-debugging":          "Methodical root-cause analysis for bugs — hypothesis, isolation, fix, verify.",
  "superpowers:test-driven-development":       "Write failing tests first, then implement until they pass.",
  "superpowers:dispatching-parallel-agents":   "Spin up multiple subagents to tackle independent workstreams concurrently.",
  "superpowers:subagent-driven-development":   "Delegate implementation sub-tasks to focused subagents.",
  "superpowers:using-git-worktrees":           "Manage multiple feature branches simultaneously using git worktrees.",
  "superpowers:finishing-a-development-branch": "Pre-merge checklist: tests, lint, review, PR description.",
  "superpowers:requesting-code-review":        "Prepare code for review — summarise changes and surface key decisions.",
  "superpowers:receiving-code-review":         "Process incoming review feedback and apply changes systematically.",
  "superpowers:verification-before-completion": "Verify a change actually works end-to-end before marking it done.",
  "superpowers:writing-skills":                "Author a new skill file following best-practice structure.",
  "superpowers:using-superpowers":             "Introduction to the superpowers skill system and how to invoke skills.",
  // trenchcoat
  "trenchcoat:trenchcoat-dashboard":   "Open the Trenchcoat analytics dashboard.",
  "trenchcoat:trenchcoat-connect":     "Configure the Trenchcoat plugin with an API key.",
  "trenchcoat:trenchcoat-report":      "Generate a usage report from collected telemetry.",
  "trenchcoat:trenchcoat-verify":      "Verify the Trenchcoat plugin is installed and sending events correctly.",
  "trenchcoat:trenchcoat-doctor":      "Diagnose Trenchcoat plugin configuration and connectivity issues.",
  "trenchcoat:telemetry-insights":     "Analyse telemetry data to surface usage patterns and cost insights.",
};

function formatKebabCase(s: string): string {
  return s
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getSkillDescription(skillName: string): string | null {
  if (skillName in KNOWN_DESCRIPTIONS) {
    return KNOWN_DESCRIPTIONS[skillName];
  }

  // Parse plugin:skill-name → "Skill Name (plugin)"
  const colon = skillName.indexOf(":");
  if (colon === -1) return null;

  const plugin = skillName.slice(0, colon);
  const skill  = skillName.slice(colon + 1);
  return `${formatKebabCase(skill)} (${formatKebabCase(plugin)})`;
}
