const BUILTIN_DESCRIPTIONS: Record<string, string> = {
  Agent:           "Spawn a subagent to handle a complex, multi-step task in parallel.",
  AskUserQuestion: "Pause execution and ask the user a clarifying question.",
  Bash:            "Execute a shell command and return its output.",
  Edit:            "Make an exact string replacement in a file.",
  EnterPlanMode:   "Switch into plan mode to draft and review an implementation plan before executing.",
  ExitPlanMode:    "Exit plan mode and begin executing the approved plan.",
  Glob:            "Find files by glob pattern.",
  Grep:            "Search file contents for a pattern.",
  LSP:             "Query the language server for diagnostics, hover info, or definitions.",
  Read:            "Read a file from the local filesystem.",
  Skill:           "Invoke a named skill to apply specialized knowledge or workflow.",
  Task:            "Reference a task being tracked in the task list.",
  TaskCreate:      "Create a new task in the task list.",
  TaskOutput:      "Read the output of a running background task.",
  TaskStop:        "Stop a running background task.",
  TaskUpdate:      "Update the status or description of a task.",
  TeamCreate:      "Create a new team.",
  TeamDelete:      "Delete a team.",
  ToolSearch:      "Load deferred tool schemas so they can be called.",
  WebFetch:        "Fetch the contents of a URL.",
  WebSearch:       "Search the web and return results.",
  Write:           "Write or overwrite a file on the local filesystem.",
};

function formatSnakeCase(s: string): string {
  return s
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function parseMcpToolName(name: string): string | null {
  // Pattern: mcp__<server>__<tool>
  const match = name.match(/^mcp__(.+?)__(.+)$/);
  if (!match) return null;

  const [, serverRaw, toolRaw] = match;
  // Server segment: e.g. "plugin_supabase_supabase" → "Supabase"
  // Strip leading "plugin_<plugin-name>_" or "claude_ai_" prefix
  const serverClean = serverRaw
    .replace(/^plugin_[^_]+_/, "")   // plugin_supabase_supabase → supabase
    .replace(/^claude_ai_/, "")       // claude_ai_Vercel → Vercel
    .replace(/^claude-in-chrome$/, "Chrome Browser");

  const server = formatSnakeCase(serverClean);
  const action = formatSnakeCase(toolRaw);

  return `${action} (via ${server})`;
}

export function getToolDescription(toolName: string): string | null {
  if (toolName in BUILTIN_DESCRIPTIONS) {
    return BUILTIN_DESCRIPTIONS[toolName];
  }
  return parseMcpToolName(toolName);
}
