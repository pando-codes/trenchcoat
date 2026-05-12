"use client";

import { useMemo } from "react";
import type { HourlyHeatmapEntry } from "@/types/analytics";

interface HourlyHeatmapProps {
  data: HourlyHeatmapEntry[];
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

function getIntensity(count: number, max: number): string {
  if (max === 0 || count === 0) return "var(--color-muted)";
  const ratio = count / max;
  if (ratio < 0.25) return "oklch(0.75 0.15 264)";
  if (ratio < 0.5) return "oklch(0.6 0.2 264)";
  if (ratio < 0.75) return "oklch(0.5 0.22 264)";
  return "oklch(0.4 0.24 264)";
}

export function HourlyHeatmap({ data }: HourlyHeatmapProps) {
  const { grid, maxCount } = useMemo(() => {
    const grid: number[][] = Array.from({ length: 7 }, () =>
      Array(24).fill(0)
    );
    let maxCount = 0;
    for (const entry of data) {
      grid[entry.day_of_week][entry.hour] = entry.count;
      if (entry.count > maxCount) maxCount = entry.count;
    }
    return { grid, maxCount };
  }, [data]);

  if (data.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
        No heatmap data available.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[600px]">
        {/* Hour labels */}
        <div
          className="grid gap-px"
          style={{
            gridTemplateColumns: "48px repeat(24, 1fr)",
          }}
        >
          <div />
          {HOURS.map((h) => (
            <div
              key={h}
              className="text-center text-[10px] text-muted-foreground pb-1"
            >
              {h}
            </div>
          ))}
        </div>

        {/* Rows: one per day */}
        {DAY_LABELS.map((dayLabel, dayIndex) => (
          <div
            key={dayLabel}
            className="grid gap-px"
            style={{
              gridTemplateColumns: "48px repeat(24, 1fr)",
            }}
          >
            <div className="flex items-center text-xs text-muted-foreground pr-2">
              {dayLabel}
            </div>
            {HOURS.map((hour) => {
              const count = grid[dayIndex][hour];
              return (
                <div
                  key={hour}
                  className="aspect-square rounded-sm"
                  style={{
                    backgroundColor: getIntensity(count, maxCount),
                    minHeight: "16px",
                  }}
                  title={`${dayLabel} ${hour}:00 - ${count} events`}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
