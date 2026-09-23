"use client";

import {
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  addDays,
  format,
} from "date-fns";
import { zoned } from "@/lib/calendar-utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface Interval {
  startDate: string; // yyyy-MM-dd（台北，含）
  endDate: string; // yyyy-MM-dd（台北，含）
}

function todayZoned(): Date {
  return zoned(new Date());
}

export function presetInterval(
  preset: "today" | "week" | "next7" | "month",
): Interval {
  const t = todayZoned();
  switch (preset) {
    case "today":
      return { startDate: format(t, "yyyy-MM-dd"), endDate: format(t, "yyyy-MM-dd") };
    case "week":
      return {
        startDate: format(startOfWeek(t, { weekStartsOn: 1 }), "yyyy-MM-dd"),
        endDate: format(endOfWeek(t, { weekStartsOn: 1 }), "yyyy-MM-dd"),
      };
    case "next7":
      return {
        startDate: format(t, "yyyy-MM-dd"),
        endDate: format(addDays(t, 6), "yyyy-MM-dd"),
      };
    case "month":
      return {
        startDate: format(startOfMonth(t), "yyyy-MM-dd"),
        endDate: format(endOfMonth(t), "yyyy-MM-dd"),
      };
  }
}

const PRESETS: { key: "today" | "week" | "next7" | "month"; label: string }[] = [
  { key: "today", label: "今天" },
  { key: "week", label: "本週" },
  { key: "next7", label: "未來 7 天" },
  { key: "month", label: "本月" },
];

export function IntervalPicker({
  value,
  onChange,
}: {
  value: Interval;
  onChange: (i: Interval) => void;
}) {
  const activePreset = PRESETS.find(
    (p) => {
      const iv = presetInterval(p.key);
      return iv.startDate === value.startDate && iv.endDate === value.endDate;
    },
  )?.key;

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <Button
            key={p.key}
            variant={activePreset === p.key ? "default" : "outline"}
            size="sm"
            onClick={() => onChange(presetInterval(p.key))}
          >
            {p.label}
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="date"
          value={value.startDate}
          max={value.endDate}
          onChange={(e) => onChange({ ...value, startDate: e.target.value })}
          className="h-9 w-40"
          aria-label="開始日期"
        />
        <span className="text-muted-foreground">–</span>
        <Input
          type="date"
          value={value.endDate}
          min={value.startDate}
          onChange={(e) => onChange({ ...value, endDate: e.target.value })}
          className="h-9 w-40"
          aria-label="結束日期"
        />
      </div>
    </div>
  );
}
