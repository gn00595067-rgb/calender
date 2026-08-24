"use client";

import { Fragment } from "react";
import { format, isSameMonth, isToday } from "date-fns";
import { zoned } from "@/lib/calendar-utils";
import { D } from "@/lib/date";
import { cn } from "@/lib/utils";
import { MonthChip } from "./event-card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { CalEvent } from "@/lib/client/events";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

/** 分鐘數 → 「X時Y分」/「X小時」/「Y分」 */
function fmtDur(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h}時${m}分`;
  if (h) return `${h}小時`;
  return `${m}分`;
}

/** 兩筆行程之間的空檔（分鐘）＝後者開始 − 前者結束 */
function gapMinutes(prev: CalEvent, next: CalEvent): number {
  return Math.round(
    (+new Date(next.starts_at) - +new Date(prev.ends_at)) / 60000,
  );
}

/** 低於此門檻的空檔不顯示，避免細碎雜訊 */
const MIN_GAP_MINUTES = 15;

/** 取得事件在台北曆涵蓋的日期字串（含跨日） */
function eventDays(event: CalEvent): string[] {
  const s = zoned(event.starts_at);
  const e = zoned(event.ends_at);
  const startStr = format(s, "yyyy-MM-dd");
  const endStr = format(e, "yyyy-MM-dd");
  if (startStr === endStr) return [startStr];
  const days: string[] = [];
  const cur = new Date(s);
  cur.setHours(12, 0, 0, 0);
  for (let i = 0; i < 60; i++) {
    const ds = format(cur, "yyyy-MM-dd");
    days.push(ds);
    if (ds === endStr) break;
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

export function MonthView({
  days,
  monthStart,
  events,
  colorOf,
  conflicts,
  onSelectEvent,
  onCreateAt,
}: {
  days: Date[];
  monthStart: Date;
  events: CalEvent[];
  colorOf: (calendarId: string) => string;
  conflicts: Set<string>;
  onSelectEvent: (event: CalEvent) => void;
  onCreateAt: (dateStr: string) => void;
}) {
  const byDay = new Map<string, CalEvent[]>();
  for (const ev of events) {
    for (const ds of eventDays(ev)) {
      const arr = byDay.get(ds);
      if (arr) arr.push(ev);
      else byDay.set(ds, [ev]);
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-xs font-medium text-muted-foreground">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-2">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const ds = format(day, "yyyy-MM-dd");
          const dayEvents = (byDay.get(ds) ?? []).sort(
            (a, b) => +new Date(a.starts_at) - +new Date(b.starts_at),
          );
          const inMonth = isSameMonth(day, monthStart);
          const today = isToday(day);
          const shown = dayEvents.slice(0, 3);
          const extra = dayEvents.length - shown.length;

          // 當天有時段（非整日）行程時，取最晚結束時間，做為「尾巴結束」提示。
          const timed = dayEvents.filter((e) => !e.all_day);
          const lastEndIso =
            timed.length > 0
              ? timed.reduce(
                  (acc, e) =>
                    new Date(e.ends_at) > new Date(acc) ? e.ends_at : acc,
                  timed[0].ends_at,
                )
              : null;

          return (
            <div
              key={ds}
              onClick={() => onCreateAt(ds)}
              className={cn(
                "min-h-24 cursor-pointer border-b border-r p-1 last:border-r-0 [&:nth-child(7n)]:border-r-0",
                !inMonth && "bg-muted/30 text-muted-foreground",
                today &&
                  "bg-amber-50 ring-2 ring-inset ring-amber-400 dark:bg-amber-950/30 dark:ring-amber-500/70",
              )}
            >
              <div className="mb-1 flex justify-end">
                <span
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full text-xs",
                    today && "bg-primary font-bold text-primary-foreground",
                    !today && !inMonth && "text-muted-foreground/60",
                  )}
                >
                  {format(day, "d")}
                </span>
              </div>
              <div className="space-y-0.5">
                {shown.map((ev, i) => {
                  const prev = i > 0 ? shown[i - 1] : null;
                  const gap =
                    prev && !prev.all_day && !ev.all_day
                      ? gapMinutes(prev, ev)
                      : 0;
                  return (
                    <Fragment key={ev.id + ds}>
                      {gap >= MIN_GAP_MINUTES && (
                        <div className="flex items-center gap-1 px-0.5 text-[10px] leading-none text-muted-foreground/70">
                          <span className="h-px flex-1 bg-border" />
                          <span className="shrink-0 tabular-nums">
                            空 {fmtDur(gap)}
                          </span>
                          <span className="h-px flex-1 bg-border" />
                        </div>
                      )}
                      <MonthChip
                        event={ev}
                        color={colorOf(ev.calendar_id)}
                        conflict={conflicts.has(ev.id)}
                        onClick={() => onSelectEvent(ev)}
                      />
                    </Fragment>
                  );
                })}
                {extra > 0 && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        onClick={(e) => e.stopPropagation()}
                        className="w-full rounded px-1 py-0.5 text-left text-[11px] text-muted-foreground hover:bg-accent touch:py-2 touch:text-xs"
                      >
                        +{extra} 筆
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      className="w-56 space-y-1 p-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="px-1 pb-1 text-xs font-medium text-muted-foreground">
                        {format(day, "M月d日")}
                      </div>
                      {dayEvents.map((ev) => (
                        <MonthChip
                          key={ev.id + "pop"}
                          event={ev}
                          color={colorOf(ev.calendar_id)}
                          conflict={conflicts.has(ev.id)}
                          onClick={() => onSelectEvent(ev)}
                        />
                      ))}
                    </PopoverContent>
                  </Popover>
                )}
                {lastEndIso && (
                  <div className="pt-0.5 text-right text-[10px] font-medium leading-none text-muted-foreground/80 tabular-nums">
                    結束 {D.time(lastEndIso)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
