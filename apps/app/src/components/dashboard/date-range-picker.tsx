"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { format, subDays, parseISO } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";

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

  function handleSelect(selected: { from?: Date; to?: Date } | undefined) {
    if (!selected?.from || !selected?.to) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("from", format(selected.from, "yyyy-MM-dd"));
    params.set("to", format(selected.to, "yyyy-MM-dd"));
    params.delete("page");
    router.replace(`?${params.toString()}`);
    setOpen(false);
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
