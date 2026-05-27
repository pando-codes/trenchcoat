"use client";

import { AlertCircle, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface TimelineFiltersProps {
  searchQuery: string;
  onSearchChange: (v: string) => void;
  allEventTypes: string[];
  enabledEventTypes: Set<string>;
  onEventTypesChange: (next: Set<string>) => void;
  allToolNames: string[];
  enabledToolNames: Set<string>;
  onToolNamesChange: (next: Set<string>) => void;
  errorsOnly: boolean;
  onErrorsOnlyChange: (v: boolean) => void;
  visibleRowCount: number;
  totalRowCount: number;
  onClearAll: () => void;
}

export function TimelineFilters({
  searchQuery,
  onSearchChange,
  allEventTypes,
  enabledEventTypes,
  onEventTypesChange,
  allToolNames,
  enabledToolNames,
  onToolNamesChange,
  errorsOnly,
  onErrorsOnlyChange,
  visibleRowCount,
  totalRowCount,
  onClearAll,
}: TimelineFiltersProps) {
  const hasActiveFilter =
    searchQuery.trim().length > 0 ||
    allEventTypes.some((t) => !enabledEventTypes.has(t)) ||
    allToolNames.some((t) => !enabledToolNames.has(t)) ||
    errorsOnly;

  const toggleEventType = (type: string) => {
    const next = new Set(enabledEventTypes);
    if (next.has(type)) {
      next.delete(type);
    } else {
      next.add(type);
    }
    onEventTypesChange(next);
  };

  const toggleToolName = (name: string) => {
    const next = new Set(enabledToolNames);
    if (next.has(name)) {
      next.delete(name);
    } else {
      next.add(name);
    }
    onToolNamesChange(next);
  };

  const selectAllTools = () => {
    onToolNamesChange(new Set(allToolNames));
  };

  const clearAllTools = () => {
    onToolNamesChange(new Set());
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[200px] flex-1 sm:flex-initial">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search tools or input previews…"
          className="h-8 pl-8 text-xs"
        />
      </div>

      {allEventTypes.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {allEventTypes.map((type) => {
            const enabled = enabledEventTypes.has(type);
            return (
              <Badge
                key={type}
                variant={enabled ? "default" : "outline"}
                onClick={() => toggleEventType(type)}
                className="cursor-pointer select-none text-[10px]"
              >
                {type}
              </Badge>
            );
          })}
        </div>
      )}

      <Badge
        variant={errorsOnly ? "destructive" : "outline"}
        onClick={() => onErrorsOnlyChange(!errorsOnly)}
        className="cursor-pointer select-none gap-1 text-[10px]"
        aria-pressed={errorsOnly}
      >
        <AlertCircle className="size-3" />
        Errors only
      </Badge>

      {allToolNames.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs">
              Tools ({enabledToolNames.size}/{allToolNames.length})
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-3" align="start">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-medium">Tools</span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={selectAllTools}
                  className="h-6 px-2 text-[11px]"
                >
                  Select all
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={clearAllTools}
                  className="h-6 px-2 text-[11px]"
                >
                  Clear
                </Button>
              </div>
            </div>
            <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
              {allToolNames.map((name) => {
                const checked = enabledToolNames.has(name);
                const id = `tool-filter-${name}`;
                return (
                  <label
                    key={name}
                    htmlFor={id}
                    className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted/60"
                  >
                    <Checkbox
                      id={id}
                      checked={checked}
                      onCheckedChange={() => toggleToolName(name)}
                    />
                    <span className="font-mono">{name}</span>
                  </label>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      )}

      {hasActiveFilter && (
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground tabular-nums">
            Showing {visibleRowCount} of {totalRowCount} events
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearAll}
            className="h-8 text-xs"
          >
            Clear
          </Button>
        </div>
      )}
    </div>
  );
}
