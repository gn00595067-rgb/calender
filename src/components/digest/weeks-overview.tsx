"use client";

import { useMemo } from "react";
import { Plane } from "lucide-react";
import type { CalEvent } from "@/lib/client/events";
import { taipeiDateStartUtcISO } from "@/lib/date";
import { cn } from "@/lib/utils";

/** 只算白天到晚上（08:00–22:00）被佔掉的時間，睡覺時段不算 */
const DAY_FROM_MIN = 8 * 60;
const DAY_TO_MIN = 22 * 60;
const WD = ["一", "二", "三", "四", "五", "六", "日"];

function addDaysStr(ds: string, n: number): string {
  return new Date(Date.parse(`${ds}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

function mondayOf(ds: string): string {
  const d = new Date(`${ds}T12:00:00Z`);
  return addDaysStr(ds, -((d.getUTCDay() + 6) % 7));
}

function md(ds: string): string {
  return `${Number(ds.slice(5, 7))}/${Number(ds.slice(8, 10))}`;
}

/** 某一天被佔用的分鐘數（合併重疊、只算 08–22 點） */
function busyMinutes(ds: string, events: CalEvent[]): number {
  const dayStart = Date.parse(taipeiDateStartUtcISO(ds));
  const from = dayStart + DAY_FROM_MIN * 60000;
  const to = dayStart + DAY_TO_MIN * 60000;
  const segs = events
    .filter((e) => !e.all_day)
    .map((e) => [Math.max(Date.parse(e.starts_at), from), Math.min(Date.parse(e.ends_at), to)] as const)
    .filter(([s, en]) => en > s)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curS = -1;
  let curE = -1;
  for (const [s, en] of segs) {
    if (s > curE) {
      if (curE > curS) total += curE - curS;
      curS = s;
      curE = en;
    } else curE = Math.max(curE, en);
  }
  if (curE > curS) total += curE - curS;
  return Math.round(total / 60000);
}

interface WeekRow {
  monday: string;
  days: { ds: string; busy: number; allDay: number; inRange: boolean }[];
  totalBusy: number;
  count: number;
}

/**
 * 每週忙碌程度：一列一週、七格顏色深淺＝那天被佔掉多少時間，
 * 最空的幾週標「最空」，方便找旅遊或一整週的空檔。點一列可看那週明細。
 * spec：docs/specs/多週總覽與週行程表.md
 */
export function WeeksOverview({
  startDate,
  endDate,
  events,
  onFocusWeek,
}: {
  startDate: string;
  endDate: string;
  events: CalEvent[];
  onFocusWeek: (monday: string) => void;
}) {
  const rows = useMemo<WeekRow[]>(() => {
    const out: WeekRow[] = [];
    for (let mon = mondayOf(startDate); mon <= endDate; mon = addDaysStr(mon, 7)) {
      const days = Array.from({ length: 7 }, (_, i) => {
        const ds = addDaysStr(mon, i);
        const dayStart = Date.parse(taipeiDateStartUtcISO(ds));
        const dayEnd = dayStart + 86400000;
        const onDay = events.filter(
          (e) => Date.parse(e.starts_at) < dayEnd && Date.parse(e.ends_at) > dayStart,
        );
        return {
          ds,
          busy: busyMinutes(ds, onDay),
          allDay: onDay.filter((e) => e.all_day).length,
          inRange: ds >= startDate && ds <= endDate,
        };
      });
      const weekStart = Date.parse(taipeiDateStartUtcISO(mon));
      const weekEnd = weekStart + 7 * 86400000;
      out.push({
        monday: mon,
        days,
        totalBusy: days.reduce((s, d) => s + d.busy, 0),
        count: events.filter(
          (e) => Date.parse(e.starts_at) < weekEnd && Date.parse(e.starts_at) >= weekStart,
        ).length,
      });
    }
    return out;
  }, [startDate, endDate, events]);

  // 4 週以上才標「最空」：取最空的 3 週（完整在範圍內的週）
  const lightest = useMemo(() => {
    const full = rows.filter((r) => r.days.every((d) => d.inRange));
    if (full.length < 4) return new Set<string>();
    return new Set(
      [...full].sort((a, b) => a.totalBusy - b.totalBusy).slice(0, 3).map((r) => r.monday),
    );
  }, [rows]);

  if (rows.length < 2) return null;
  const maxDay = 8 * 60; // 一天被佔 8 小時以上就算最深色

  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
        <Plane className="size-4 text-primary" />
        每週忙碌程度（找空的一週）
      </div>
      <div className="mb-1 grid grid-cols-[4.5rem_repeat(7,1fr)_3.5rem] gap-1 text-center text-[10px] text-muted-foreground">
        <div />
        {WD.map((w) => (
          <div key={w}>{w}</div>
        ))}
        <div>佔用</div>
      </div>
      <div className="space-y-1">
        {rows.map((r) => (
          <button
            key={r.monday}
            type="button"
            onClick={() => onFocusWeek(r.monday)}
            className={cn(
              "grid w-full grid-cols-[4.5rem_repeat(7,1fr)_3.5rem] items-center gap-1 rounded-md p-0.5 text-left hover:bg-accent",
              lightest.has(r.monday) && "bg-emerald-50 ring-1 ring-emerald-400 dark:bg-emerald-950/30",
            )}
            title={`${md(r.monday)} 這週：${r.count} 筆行程`}
          >
            <span className="text-xs tabular-nums">
              {md(r.monday)}
              {lightest.has(r.monday) && (
                <span className="ml-1 rounded bg-emerald-600 px-1 text-[10px] text-white">最空</span>
              )}
            </span>
            {r.days.map((d) => {
              const k = Math.min(d.busy / maxDay, 1);
              return (
                <span
                  key={d.ds}
                  className={cn(
                    "relative flex h-7 items-center justify-center rounded border text-[10px] tabular-nums",
                    !d.inRange && "opacity-30",
                  )}
                  style={{
                    backgroundColor: d.busy ? `rgba(37, 99, 235, ${0.12 + k * 0.7})` : undefined,
                    color: k > 0.55 ? "white" : undefined,
                  }}
                >
                  {d.busy ? `${Math.round(d.busy / 30) / 2}h` : ""}
                  {d.allDay > 0 && (
                    <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-amber-500" />
                  )}
                </span>
              );
            })}
            <span className="text-right text-xs tabular-nums text-muted-foreground">
              {Math.round(r.totalBusy / 60)}h
            </span>
          </button>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">
        格子數字＝那天 8:00–22:00 被行程佔掉的時數，越深越忙；橘點＝有整天的行程。點一列看那週明細。
        只想看自己能不能出門，可在上方「空檔對象」只選自己。
      </p>
    </div>
  );
}
