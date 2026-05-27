import { AlertCircle, CheckCircle2, Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  countCompactions,
  countToolErrors,
  countUserTurns,
} from "@/lib/events/grouping";
import type { TelemetryEvent } from "@/types/events";

interface OutcomeSignalsProps {
  stopReason: string | null;
  events: TelemetryEvent[];
}

interface StopReasonDisplay {
  label: string;
  variant: "default" | "secondary" | "outline" | "destructive";
  muted: boolean;
}

function formatStopReason(stopReason: string | null): StopReasonDisplay {
  switch (stopReason) {
    case "end_turn":
    case "stop_sequence":
      return { label: "Completed", variant: "secondary", muted: false };
    case "max_tokens":
      return { label: "Hit token limit", variant: "destructive", muted: false };
    case "tool_use":
      return { label: "Stopped mid-tool", variant: "outline", muted: false };
    default:
      return { label: "Unknown", variant: "outline", muted: true };
  }
}

const TOOL_ERROR_TOOLTIP =
  "Tool errors are tool calls that returned an error (e.g., file not found, command failed).";

export function OutcomeSignals({ stopReason, events }: OutcomeSignalsProps) {
  const stopDisplay = formatStopReason(stopReason);
  const compactionCount = countCompactions(events);
  const turnCount = countUserTurns(events);
  const toolErrors = countToolErrors(events);
  const rawReasonTooltip =
    stopReason === null || stopReason === undefined
      ? "No stop reason recorded for this session."
      : `Raw stop reason: ${stopReason}`;

  const errorPct =
    toolErrors.hasData && toolErrors.total > 0
      ? Math.round((toolErrors.errored / toolErrors.total) * 100)
      : 0;

  return (
    <TooltipProvider>
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3 text-sm">
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant={stopDisplay.variant}
              className={cn(
                "cursor-default",
                stopDisplay.muted && "text-muted-foreground"
              )}
            >
              {stopDisplay.label}
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-64">
            {rawReasonTooltip}
          </TooltipContent>
        </Tooltip>

        {compactionCount > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="cursor-default gap-1">
                <Layers className="size-3" />
                Compacted {compactionCount}&times;
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-72">
              Claude Code summarized its earlier context to free up tokens.
              Compaction may indicate a long or complex session.
            </TooltipContent>
          </Tooltip>
        )}

        {toolErrors.hasData && toolErrors.errored === 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="secondary" className="cursor-default gap-1">
                <CheckCircle2 className="size-3" />
                No tool errors
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-72">
              {TOOL_ERROR_TOOLTIP}
            </TooltipContent>
          </Tooltip>
        )}

        {toolErrors.hasData && toolErrors.errored > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="destructive" className="cursor-default gap-1">
                <AlertCircle className="size-3" />
                {toolErrors.errored} tool {toolErrors.errored === 1 ? "error" : "errors"} ({errorPct}%)
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-72">
              {TOOL_ERROR_TOOLTIP}
            </TooltipContent>
          </Tooltip>
        )}

        <span className="text-xs text-muted-foreground">
          {turnCount} {turnCount === 1 ? "turn" : "turns"}
        </span>
      </div>
    </TooltipProvider>
  );
}
