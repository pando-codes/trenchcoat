"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  Minimize2,
  Sparkles,
  Bot,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  buildTimelineRows,
  getResultErrorPreview,
  groupEventsByTurn,
  type TimelineRow,
  type TurnGroup,
} from "@/lib/events/grouping";
import { parseInputPreview } from "@/lib/events/preview";
import { computeTurnPhaseProportions } from "@/lib/events/phase-detection";
import type { TelemetryEvent } from "@/types/events";
import { TimelineFilters } from "./timeline-filters";

interface TimelineProps {
  events: TelemetryEvent[];
  userTimezone: string;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatDurationCompact(ms: number | null): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return "--";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) {
    const secs = ms / 1000;
    return `${secs.toFixed(1)}s`;
  }
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function formatTokensShort(n: number | null): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "--";
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}k`;
  }
  return String(n);
}

function formatRelativeOffset(ms: number | null): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return "";
  const sign = ms < 0 ? "-" : "+";
  const abs = Math.abs(ms);
  if (abs < 1000) return `${sign}${Math.round(abs)}ms`;
  if (abs < 60_000) return `${sign}${(abs / 1000).toFixed(1)}s`;
  const totalSeconds = Math.floor(abs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${sign}${minutes}m ${seconds}s`;
}

function relativeOffsetMs(eventIso: string, turnStartIso: string): number | null {
  const eventTs = Date.parse(eventIso);
  const startTs = Date.parse(turnStartIso);
  if (Number.isNaN(eventTs) || Number.isNaN(startTs)) return null;
  return eventTs - startTs;
}

function getStopReasonMini(reason: string | null): {
  label: string;
  variant: "secondary" | "destructive" | "outline";
} | null {
  if (!reason) return null;
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return { label: "completed", variant: "secondary" };
    case "max_tokens":
      return { label: "max tokens", variant: "destructive" };
    case "tool_use":
      return { label: "mid-tool", variant: "outline" };
    default:
      return { label: reason, variant: "outline" };
  }
}

// ---------------------------------------------------------------------------
// Filter helpers
// ---------------------------------------------------------------------------

/** The underlying event_type that drives chip filtering for a given row. */
function rowEventType(row: TimelineRow): string | null {
  switch (row.kind) {
    case "tool":
      return row.useEvent.event_type;
    case "tool_run":
      return row.useEvents[0]?.event_type ?? "tool_use";
    case "skill":
      return row.event.event_type;
    case "subagent_stop":
      return row.event.event_type;
    case "divider":
      return row.event.event_type;
    case "other":
      return row.event.event_type;
  }
}

/** The tool name (if any) associated with a row, for tool-name chip filtering. */
function rowToolName(row: TimelineRow): string | null {
  if (row.kind === "tool") return row.toolName;
  if (row.kind === "tool_run") return row.toolName;
  return null;
}

/** Extract a string from a row that should be searchable. */
function rowSearchText(row: TimelineRow): string {
  const parts: string[] = [];
  if (row.kind === "tool") {
    parts.push(row.toolName);
    const preview = row.useEvent.data?.input_preview;
    if (typeof preview === "string") parts.push(preview);
  } else if (row.kind === "tool_run") {
    parts.push(row.toolName);
    for (const e of row.useEvents) {
      const preview = e.data?.input_preview;
      if (typeof preview === "string") parts.push(preview);
    }
  } else if (row.kind === "skill") {
    parts.push(row.skillName);
  } else if (row.kind === "divider") {
    parts.push(row.label);
  }
  return parts.join(" ").toLowerCase();
}

interface FilterState {
  search: string;
  enabledEventTypes: Set<string>;
  enabledToolNames: Set<string>;
  errorsOnly: boolean;
}

/** True when a row represents a known tool error (or run with >=1 errors). */
function rowIsError(row: TimelineRow): boolean {
  if (row.kind === "tool") return row.isError === true;
  if (row.kind === "tool_run") return row.errorCount > 0;
  return false;
}

function rowMatchesFilters(row: TimelineRow, filters: FilterState): boolean {
  // Errors-only filter: hide everything that isn't a known tool error.
  if (filters.errorsOnly && !rowIsError(row)) return false;

  // Event-type chip filter.
  const type = rowEventType(row);
  if (type && !filters.enabledEventTypes.has(type)) return false;

  // Tool-name chip filter (only applies when row has a tool name).
  const toolName = rowToolName(row);
  if (toolName && !filters.enabledToolNames.has(toolName)) return false;

  // Search filter.
  const q = filters.search.trim().toLowerCase();
  if (q.length > 0) {
    if (!rowSearchText(row).includes(q)) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Idle gap helpers
// ---------------------------------------------------------------------------

const BETWEEN_TURN_IDLE_THRESHOLD_MS = 30_000;
const FIRST_TOKEN_THRESHOLD_MS = 1_000;

/** Last event in a turn that "closes" it for idle-gap calculations. Prefer the
 *  closing assistant_stop; fall back to the last event. */
function turnClosingTimestamp(group: TurnGroup): string | null {
  for (let i = group.events.length - 1; i >= 0; i--) {
    if (group.events[i].event_type === "assistant_stop") {
      return group.events[i].timestamp;
    }
  }
  if (group.events.length === 0) return null;
  return group.events[group.events.length - 1].timestamp;
}

/** First tool_use timestamp inside a turn, or null. */
function firstToolUseTimestamp(group: TurnGroup): string | null {
  for (const e of group.events) {
    if (e.event_type === "tool_use") return e.timestamp;
  }
  return null;
}

function diffMs(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const aMs = Date.parse(a);
  const bMs = Date.parse(b);
  if (!Number.isFinite(aMs) || !Number.isFinite(bMs)) return null;
  return bMs - aMs;
}

// ---------------------------------------------------------------------------
// Row rendering
// ---------------------------------------------------------------------------

interface RowRenderProps {
  row: TimelineRow;
  turnStartedAt: string;
}

function RowOffset({ offsetMs }: { offsetMs: number | null }) {
  const label = formatRelativeOffset(offsetMs);
  if (!label) return null;
  return (
    <span className="text-[10px] text-muted-foreground/70 tabular-nums">
      {label}
    </span>
  );
}

function ToolErrorBadge({
  errorPreview,
}: {
  errorPreview: string | null;
}) {
  const badge = (
    <Badge variant="destructive" className="gap-1 text-[10px]">
      <AlertCircle className="size-3" />
      error
    </Badge>
  );
  if (!errorPreview) return badge;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-default">{badge}</span>
        </TooltipTrigger>
        <TooltipContent className="max-w-80 whitespace-pre-wrap break-words font-mono text-[11px]">
          {errorPreview}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function ToolRow({ row, turnStartedAt }: { row: Extract<TimelineRow, { kind: "tool" }>; turnStartedAt: string }) {
  const rawPreview =
    (row.useEvent.data.input_preview as string | null | undefined) ?? null;
  const preview = parseInputPreview(row.toolName, rawPreview);
  const offsetMs = relativeOffsetMs(row.useEvent.timestamp, turnStartedAt);
  const isError = row.isError === true;
  const errorPreview = isError ? getResultErrorPreview(row.resultEvent) : null;

  return (
    <div className="flex items-center gap-3 px-2 py-1.5 text-sm hover:bg-muted/40 rounded">
      <span className="font-mono text-foreground shrink-0">{row.toolName}</span>
      {isError && <ToolErrorBadge errorPreview={errorPreview} />}
      {preview && (
        <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
          {preview.kind}
        </Badge>
      )}
      {preview?.primary && (
        <code className="truncate rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground min-w-0">
          {preview.primary}
        </code>
      )}
      {preview?.secondary && (
        <span className="hidden sm:inline truncate text-xs text-muted-foreground/70 min-w-0">
          {preview.secondary}
        </span>
      )}
      <div className="ml-auto flex items-center gap-2 shrink-0">
        {row.durationMs !== null && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatDurationCompact(row.durationMs)}
          </span>
        )}
        <RowOffset offsetMs={offsetMs} />
      </div>
    </div>
  );
}

function ToolRunRow({
  row,
  turnStartedAt,
}: {
  row: Extract<TimelineRow, { kind: "tool_run" }>;
  turnStartedAt: string;
}) {
  const firstEvent = row.useEvents[0];
  const offsetMs = firstEvent
    ? relativeOffsetMs(firstEvent.timestamp, turnStartedAt)
    : null;
  return (
    <div className="flex items-center gap-3 px-2 py-1.5 text-sm hover:bg-muted/40 rounded">
      <span className="font-mono text-foreground shrink-0">{row.toolName}</span>
      <Badge variant="secondary" className="text-xs">
        &times; {row.count}
      </Badge>
      {row.errorCount > 0 && (
        <Badge variant="destructive" className="gap-1 text-[10px]">
          <AlertCircle className="size-3" />
          {row.errorCount} {row.errorCount === 1 ? "error" : "errors"}
        </Badge>
      )}
      <span className="text-xs text-muted-foreground italic">
        consecutive run
      </span>
      <div className="ml-auto flex items-center gap-2 shrink-0">
        {row.totalDurationMs !== null && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatDurationCompact(row.totalDurationMs)}
          </span>
        )}
        <RowOffset offsetMs={offsetMs} />
      </div>
    </div>
  );
}

function SkillRow({
  row,
  turnStartedAt,
}: {
  row: Extract<TimelineRow, { kind: "skill" }>;
  turnStartedAt: string;
}) {
  const offsetMs = relativeOffsetMs(row.event.timestamp, turnStartedAt);
  return (
    <div className="flex items-center gap-3 px-2 py-1.5 text-sm hover:bg-muted/40 rounded">
      <span className="text-xs uppercase tracking-wide text-muted-foreground shrink-0">
        Skill
      </span>
      <Badge variant="default" className="gap-1">
        <Sparkles className="size-3" />
        {row.skillName}
      </Badge>
      <div className="ml-auto shrink-0">
        <RowOffset offsetMs={offsetMs} />
      </div>
    </div>
  );
}

function SubagentRow({
  row,
  turnStartedAt,
}: {
  row: Extract<TimelineRow, { kind: "subagent_stop" }>;
  turnStartedAt: string;
}) {
  const agentType = (row.event.data.agent_type as string | null) ?? "subagent";
  const toolCount = (row.event.data.tool_count_total as number | null) ?? null;
  const offsetMs = relativeOffsetMs(row.event.timestamp, turnStartedAt);
  return (
    <div className="flex items-center gap-3 px-2 py-1.5 text-sm hover:bg-muted/40 rounded">
      <span className="text-xs uppercase tracking-wide text-muted-foreground shrink-0">
        Subagent
      </span>
      <Badge variant="outline" className="gap-1">
        <Bot className="size-3" />
        {agentType}
      </Badge>
      {toolCount !== null && (
        <span className="text-xs text-muted-foreground">
          {toolCount} {toolCount === 1 ? "tool" : "tools"}
        </span>
      )}
      <div className="ml-auto shrink-0">
        <RowOffset offsetMs={offsetMs} />
      </div>
    </div>
  );
}

function DividerRow({
  row,
  turnStartedAt,
}: {
  row: Extract<TimelineRow, { kind: "divider" }>;
  turnStartedAt: string;
}) {
  const offsetMs = relativeOffsetMs(row.event.timestamp, turnStartedAt);
  return (
    <div className="flex items-center gap-3 px-2 py-2 text-xs text-muted-foreground">
      <Separator className="flex-1" />
      <div className="flex items-center gap-1.5 shrink-0">
        <Minimize2 className="size-3" />
        <span>{row.label}</span>
      </div>
      <Separator className="flex-1" />
      <RowOffset offsetMs={offsetMs} />
    </div>
  );
}

function OtherRow({
  row,
  turnStartedAt,
  userTimezone,
}: {
  row: Extract<TimelineRow, { kind: "other" }>;
  turnStartedAt: string;
  userTimezone: string;
}) {
  const offsetMs = relativeOffsetMs(row.event.timestamp, turnStartedAt);
  const ts = new Date(row.event.timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: userTimezone,
  });
  return (
    <div className="flex items-center gap-3 px-2 py-1.5 text-sm hover:bg-muted/40 rounded">
      <Badge variant="outline" className="text-[10px]">
        {row.event.event_type}
      </Badge>
      <span className="text-xs text-muted-foreground tabular-nums">{ts}</span>
      <div className="ml-auto shrink-0">
        <RowOffset offsetMs={offsetMs} />
      </div>
    </div>
  );
}

function TimelineRowDispatch({
  row,
  turnStartedAt,
  userTimezone,
}: RowRenderProps & { userTimezone: string }) {
  switch (row.kind) {
    case "tool":
      return <ToolRow row={row} turnStartedAt={turnStartedAt} />;
    case "tool_run":
      return <ToolRunRow row={row} turnStartedAt={turnStartedAt} />;
    case "skill":
      return <SkillRow row={row} turnStartedAt={turnStartedAt} />;
    case "subagent_stop":
      return <SubagentRow row={row} turnStartedAt={turnStartedAt} />;
    case "divider":
      return <DividerRow row={row} turnStartedAt={turnStartedAt} />;
    case "other":
      return (
        <OtherRow
          row={row}
          turnStartedAt={turnStartedAt}
          userTimezone={userTimezone}
        />
      );
  }
}

// ---------------------------------------------------------------------------
// Phase bar
// ---------------------------------------------------------------------------

interface PhaseBarProps {
  events: TelemetryEvent[];
}

const PHASE_COLOR: Record<"explore" | "implement" | "verify" | "other", string> = {
  explore: "bg-blue-500",
  implement: "bg-emerald-500",
  verify: "bg-amber-500",
  other: "bg-muted-foreground/30",
};

const PHASE_LABEL: Record<"explore" | "implement" | "verify", string> = {
  explore: "Explore",
  implement: "Implement",
  verify: "Verify",
};

function PhaseBar({ events }: PhaseBarProps) {
  const proportions = useMemo(() => {
    try {
      return computeTurnPhaseProportions(events);
    } catch {
      return null;
    }
  }, [events]);

  if (!proportions || proportions.totalMs === 0) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted-foreground/20" />
          </TooltipTrigger>
          <TooltipContent side="top">
            No measurable tool durations in this turn.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  const segments = (
    [
      { phase: "explore", pct: proportions.explore },
      { phase: "implement", pct: proportions.implement },
      { phase: "verify", pct: proportions.verify },
      { phase: "other", pct: proportions.other },
    ] as const
  ).filter((s) => s.pct > 0);

  // Legend entries: only named phases with non-zero duration.
  const legendPhases: Array<"explore" | "implement" | "verify"> = (
    ["explore", "implement", "verify"] as const
  ).filter((p) => proportions[p] > 0);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
        {segments.map((seg, idx) => (
          <div
            key={`${seg.phase}-${idx}`}
            className={cn("h-full", PHASE_COLOR[seg.phase])}
            style={{ width: `${seg.pct * 100}%` }}
            title={`${seg.phase}: ${(seg.pct * 100).toFixed(0)}%`}
          />
        ))}
      </div>
      {legendPhases.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
          {legendPhases.map((p, idx) => {
            const ms = proportions[p] * proportions.totalMs;
            return (
              <span key={p} className="flex items-center gap-1">
                <span
                  className={cn("size-1.5 rounded-full", PHASE_COLOR[p])}
                  aria-hidden
                />
                <span>
                  {PHASE_LABEL[p]} {formatDurationCompact(ms)}
                </span>
                {idx < legendPhases.length - 1 && (
                  <span className="text-muted-foreground/50">·</span>
                )}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Turn group rendering
// ---------------------------------------------------------------------------

interface TurnGroupBlockProps {
  group: TurnGroup;
  isExpanded: boolean;
  onToggle: () => void;
  userTimezone: string;
  visibleRows: TimelineRow[];
  totalRowCount: number;
}

function TurnGroupBlock({
  group,
  isExpanded,
  onToggle,
  userTimezone,
  visibleRows,
  totalRowCount,
}: TurnGroupBlockProps) {
  const title = group.isPreFirstPrompt ? "Session start" : `Turn ${group.index}`;
  const wordCount =
    (group.promptEvent?.data?.word_count as number | null | undefined) ?? null;
  const stopMini = getStopReasonMini(group.stopReason);
  const Chevron = isExpanded ? ChevronDown : ChevronRight;

  // First-token gap (only meaningful when there is a prompt).
  const firstTokenGapMs = useMemo(() => {
    if (!group.promptEvent) return null;
    const firstTool = firstToolUseTimestamp(group);
    if (!firstTool) return null;
    return diffMs(group.promptEvent.timestamp, firstTool);
  }, [group]);

  const showVisibleSuffix = visibleRows.length !== totalRowCount;

  return (
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "flex w-full items-center gap-3 px-3 py-2 text-left",
          "hover:bg-muted/40 transition-colors",
          isExpanded && "border-b"
        )}
        aria-expanded={isExpanded}
      >
        <Chevron className="size-4 shrink-0 text-muted-foreground" />
        <span className="font-medium text-sm shrink-0">{title}</span>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground min-w-0">
          {wordCount !== null && (
            <span>
              {wordCount} {wordCount === 1 ? "word" : "words"}
            </span>
          )}
          {group.durationMs !== null && (
            <span className="tabular-nums">
              {formatDurationCompact(group.durationMs)}
            </span>
          )}
          {group.toolCount > 0 && (
            <span>
              {group.toolCount} {group.toolCount === 1 ? "tool" : "tools"}
            </span>
          )}
          {(group.inputTokens !== null || group.outputTokens !== null) && (
            <span className="font-mono tabular-nums">
              {formatTokensShort(group.inputTokens)} &rarr;{" "}
              {formatTokensShort(group.outputTokens)} tokens
            </span>
          )}
          {showVisibleSuffix && (
            <span className="italic text-muted-foreground/70">
              {visibleRows.length} of {totalRowCount} visible
            </span>
          )}
        </div>
        {stopMini && (
          <Badge
            variant={stopMini.variant}
            className="ml-auto shrink-0 text-[10px]"
          >
            {stopMini.label}
          </Badge>
        )}
      </button>

      {isExpanded && (
        <div className="flex flex-col gap-2 px-2 py-2">
          {!group.isPreFirstPrompt &&
            firstTokenGapMs !== null &&
            firstTokenGapMs > FIRST_TOKEN_THRESHOLD_MS && (
              <div className="flex items-center gap-1.5 px-2 text-[11px] text-muted-foreground">
                <Clock className="size-3" />
                <span>
                  Assistant first-token: {formatDurationCompact(firstTokenGapMs)}
                </span>
              </div>
            )}
          <div className="px-2">
            <PhaseBar events={group.events} />
          </div>
          <div className="flex flex-col gap-0.5">
            {visibleRows.length === 0 ? (
              <p className="px-2 py-1 text-xs text-muted-foreground italic">
                No events match the current filters.
              </p>
            ) : (
              visibleRows.map((row) => (
                <TimelineRowDispatch
                  key={row.key}
                  row={row}
                  turnStartedAt={group.startedAt}
                  userTimezone={userTimezone}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Idle gap between turns
// ---------------------------------------------------------------------------

function IdleGapDivider({ ms }: { ms: number }) {
  return (
    <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
      <Separator className="flex-1" />
      <div className="flex items-center gap-1.5 shrink-0">
        <Clock className="size-3" />
        <span>User idle {formatDurationCompact(ms)}</span>
      </div>
      <Separator className="flex-1" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main timeline
// ---------------------------------------------------------------------------

export function Timeline({ events, userTimezone }: TimelineProps) {
  const groups = useMemo(() => groupEventsByTurn(events), [events]);

  // Unique event types in this session, sorted.
  const allEventTypes = useMemo(() => {
    const set = new Set<string>();
    for (const e of events) set.add(e.event_type);
    return Array.from(set).sort();
  }, [events]);

  // Unique tool names in this session, sorted.
  const allToolNames = useMemo(() => {
    const set = new Set<string>();
    for (const e of events) {
      if (e.tool_name) set.add(e.tool_name);
    }
    return Array.from(set).sort();
  }, [events]);

  // Filter state.
  const [searchQuery, setSearchQuery] = useState("");
  const [enabledEventTypes, setEnabledEventTypes] = useState<Set<string>>(
    () => new Set(allEventTypes)
  );
  const [enabledToolNames, setEnabledToolNames] = useState<Set<string>>(
    () => new Set(allToolNames)
  );
  const [errorsOnly, setErrorsOnly] = useState(false);

  const filterState: FilterState = useMemo(
    () => ({
      search: searchQuery,
      enabledEventTypes,
      enabledToolNames,
      errorsOnly,
    }),
    [searchQuery, enabledEventTypes, enabledToolNames, errorsOnly]
  );

  // Precompute total + filtered rows per group.
  const perGroup = useMemo(() => {
    return groups.map((group) => {
      const total = buildTimelineRows(group.events);
      const visible = total.filter((row) => rowMatchesFilters(row, filterState));
      return { group, total, visible };
    });
  }, [groups, filterState]);

  const totalRowCount = useMemo(
    () => perGroup.reduce((sum, g) => sum + g.total.length, 0),
    [perGroup]
  );
  const visibleRowCount = useMemo(
    () => perGroup.reduce((sum, g) => sum + g.visible.length, 0),
    [perGroup]
  );

  // Default expanded set: last non-pre-first-prompt turn expanded.
  const initialExpanded = useMemo(() => {
    const set = new Set<number>();
    const realTurns = groups.filter((g) => !g.isPreFirstPrompt);
    const lastTurn =
      realTurns.length > 0 ? realTurns[realTurns.length - 1] : null;
    if (lastTurn) {
      set.add(lastTurn.index);
    }
    return set;
  }, [groups]);

  const [userExpansion, setUserExpansion] =
    useState<Set<number>>(initialExpanded);

  const hasActiveFilter =
    searchQuery.trim().length > 0 ||
    allEventTypes.some((t) => !enabledEventTypes.has(t)) ||
    allToolNames.some((t) => !enabledToolNames.has(t)) ||
    errorsOnly;

  // When filters are active, auto-expand any group with at least one visible row.
  const autoExpanded = useMemo(() => {
    if (!hasActiveFilter) return new Set<number>();
    const set = new Set<number>();
    for (const { group, visible } of perGroup) {
      if (visible.length > 0) set.add(group.index);
    }
    return set;
  }, [hasActiveFilter, perGroup]);

  const effectiveExpansion = useMemo(() => {
    const next = new Set(userExpansion);
    for (const i of autoExpanded) next.add(i);
    return next;
  }, [userExpansion, autoExpanded]);

  const toggleTurn = (index: number) => {
    setUserExpansion((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const clearFilters = () => {
    setSearchQuery("");
    setEnabledEventTypes(new Set(allEventTypes));
    setEnabledToolNames(new Set(allToolNames));
    setErrorsOnly(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Event Timeline</CardTitle>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events recorded.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <TimelineFilters
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              allEventTypes={allEventTypes}
              enabledEventTypes={enabledEventTypes}
              onEventTypesChange={setEnabledEventTypes}
              allToolNames={allToolNames}
              enabledToolNames={enabledToolNames}
              onToolNamesChange={setEnabledToolNames}
              errorsOnly={errorsOnly}
              onErrorsOnlyChange={setErrorsOnly}
              visibleRowCount={visibleRowCount}
              totalRowCount={totalRowCount}
              onClearAll={clearFilters}
            />
            <div className="flex flex-col gap-2">
              {perGroup.map((entry, idx) => {
                const { group, total, visible } = entry;
                const isExpanded = effectiveExpansion.has(group.index);

                // Idle gap between previous turn's close and this turn's prompt.
                let idleGap: number | null = null;
                if (idx > 0) {
                  const prev = perGroup[idx - 1].group;
                  const prevClose = turnClosingTimestamp(prev);
                  const thisStart = group.promptEvent?.timestamp ?? null;
                  if (prevClose && thisStart) {
                    const gap = diffMs(prevClose, thisStart);
                    if (gap !== null && gap > BETWEEN_TURN_IDLE_THRESHOLD_MS) {
                      idleGap = gap;
                    }
                  }
                }

                return (
                  <div key={group.index} className="flex flex-col gap-2">
                    {idleGap !== null && <IdleGapDivider ms={idleGap} />}
                    <TurnGroupBlock
                      group={group}
                      isExpanded={isExpanded}
                      onToggle={() => toggleTurn(group.index)}
                      userTimezone={userTimezone}
                      visibleRows={visible}
                      totalRowCount={total.length}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

