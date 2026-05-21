"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { format, subDays, parseISO, startOfMonth } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";

const PRESETS = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
] as const;

function defaultRange() {
  const to = new Date();
  const from = subDays(to, 30);
  return { from, to };
}

export function DateRangePicker() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);

  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const defaults = defaultRange();

  const range = {
    from: fromParam ? parseISO(fromParam) : defaults.from,
    to: toParam ? parseISO(toParam) : defaults.to,
  };

  function applyRange(from: Date, to: Date) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("from", format(from, "yyyy-MM-dd"));
    params.set("to", format(to, "yyyy-MM-dd"));
    params.delete("page");
    router.replace(`?${params.toString()}`);
    setOpen(false);
  }

  function applyPreset(days: number) {
    const to = new Date();
    applyRange(subDays(to, days), to);
  }

  function applyThisMonth() {
    applyRange(startOfMonth(new Date()), new Date());
  }

  function handleSelect(selected: { from?: Date; to?: Date } | undefined) {
    if (!selected?.from || !selected?.to) return;
    applyRange(selected.from, selected.to);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="justify-start text-left font-normal">
          <CalendarIcon className="size-4" />
          {format(range.from, "MMM d, yyyy")} – {format(range.to, "MMM d, yyyy")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex gap-1 border-b px-3 py-2">
          {PRESETS.map((preset) => (
            <Button
              key={preset.label}
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => applyPreset(preset.days)}
            >
              {preset.label}
            </Button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={applyThisMonth}
          >
            This month
          </Button>
        </div>
        <Calendar
          mode="range"
          defaultMonth={range.from}
          selected={{ from: range.from, to: range.to }}
          onSelect={handleSelect}
          numberOfMonths={2}
        />
      </PopoverContent>
    </Popover>
  );
}
