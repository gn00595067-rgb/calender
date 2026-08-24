"use client";

import { useEffect, useRef } from "react";
import { format, isToday } from "date-fns";
import { zoned, layoutDay } from "@/lib/calendar-utils";
import { cn } from "@/lib/utils";
import { D } from "@/lib/date";
import { eventStyle } from "./event-visuals";
import { Star } from "lucide-react";
import type { CalEvent } from "@/lib/client/events";

const HOUR_HEIGHT = 48;
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

export function TimeGridView({
  days,
  events,
  colorOf,
  conflicts,
  onSelectEvent,
  onCreateAt,
}: {
  days: Date[];
  events: CalEvent[];
  colorOf: (calendarId: string) => string;
  conflicts: Set<string>;
  onSelectEvent: (event: CalEvent) => void;
  onCreateAt: (dateStr: string, hour: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // 初次捲動到 7 點
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 7 * HOUR_HEIGHT;
  }, []);

  const isSingle = days.length === 1;

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      {/* 日期表頭 */}
      <div
        className="grid border-b"
        style={{ gridTemplateColumns: `3rem repeat(${days.length}, 1fr)` }}
      >
        <div className="border-r bg-muted/40" />
        {days.map((day) => {
          const today = isToday(day);
          return (
            <div
              key={format(day, "yyyy-MM-dd")}
              className={cn(
                "border-r py-2 text-center last:border-r-0",
                today && "bg-amber-50/60 dark:bg-amber-950/20",
              )}
            >
              <div className="text-xs text-muted-foreground">
                週{WEEKDAYS[day.getDay()]}
              </div>
              <div
                className={cn(
                  "mx-auto mt-0.5 flex size-7 items-center justify-center rounded-full text-sm font-medium",
                  today && "bg-primary text-primary-foreground",
                )}
              >
                {format(day, "d")}
              </div>
            </div>
          );
        })}
      </div>

      {/* 整日列 */}
      <AllDayRow
        days={days}
        events={events}
        colorOf={colorOf}
        onSelectEvent={onSelectEvent}
      />

      {/* 時間軸 */}
      <div ref={scrollRef} className="max-h-[60vh] overflow-y-auto">
        <div
          className="grid"
          style={{ gridTemplateColumns: `3rem repeat(${days.length}, 1fr)` }}
        >
          {/* 小時刻度 */}
          <div className="relative border-r">
            {Array.from({ length: 24 }).map((_, h) => (
              <div
                key={h}
                className="relative border-b text-right"
                style={{ height: HOUR_HEIGHT }}
              >
                <span className="absolute -top-2 right-1 text-[10px] text-muted-foreground">
                  {h > 0 ? `${String(h).padStart(2, "0")}:00` : ""}
                </span>
              </div>
            ))}
          </div>

          {/* 每日欄 */}
          {days.map((day) => {
            const ds = format(day, "yyyy-MM-dd");
            const dayEvents = events.filter(
              (e) => !e.all_day && format(zoned(e.starts_at), "yyyy-MM-dd") === ds,
            );
            const positioned = layoutDay(dayEvents);
            return (
              <div
                key={ds}
                className={cn(
                  "relative border-r last:border-r-0",
                  isToday(day) && "bg-amber-50/60 dark:bg-amber-950/20",
                )}
                style={{ height: 24 * HOUR_HEIGHT }}
                onClick={(e) => {
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const y = e.clientY - rect.top;
                  const hour = Math.max(0, Math.min(23, Math.floor(y / HOUR_HEIGHT)));
                  onCreateAt(ds, hour);
                }}
              >
                {Array.from({ length: 24 }).map((_, h) => (
                  <div
                    key={h}
                    className="border-b"
                    style={{ height: HOUR_HEIGHT }}
                  />
                ))}
                {positioned.map(({ event, col, cols, span }) => {
                  const start = zoned(event.starts_at);
                  const end = zoned(event.ends_at);
                  const startMin = minutesOfDay(start);
                  const endMin = Math.min(
                    24 * 60,
                    format(end, "yyyy-MM-dd") === ds ? minutesOfDay(end) : 24 * 60,
                  );
                  const top = (startMin / 60) * HOUR_HEIGHT;
                  const height = Math.max(20, ((endMin - startMin) / 60) * HOUR_HEIGHT);
                  const widthPct = 100 / cols;
                  return (
                    <button
                      key={event.id}
                      type="button"
                      title={`${D.time(event.starts_at)}–${D.time(event.ends_at)} ${event.title}${
                        event.location ? ` @ ${event.location}` : ""
                      }${conflicts.has(event.id) ? "（衝突）" : ""}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectEvent(event);
                      }}
                      style={{
                        ...eventStyle(colorOf(event.calendar_id), conflicts.has(event.id)),
                        position: "absolute",
                        top,
                        height,
                        left: `calc(${col * widthPct}% + 2px)`,
                        width: `calc(${span * widthPct}% - 4px)`,
                      }}
                      className="overflow-hidden rounded-md px-1.5 py-0.5 text-left hover:brightness-95 touch:min-h-8"
                    >
                      <div className="flex items-center gap-1 text-[11px] font-semibold leading-tight">
                        {event.is_important && (
                          <Star className="size-2.5 shrink-0 fill-amber-400 text-amber-500" />
                        )}
                        <span className="tabular-nums">{D.time(event.starts_at)}</span>
                      </div>
                      <div
                        className={cn(
                          "line-clamp-2 text-xs font-medium leading-tight",
                          isSingle && "text-sm",
                        )}
                      >
                        {event.title}
                      </div>
                      {height > 44 && event.location && (
                        <div className="truncate text-[10px] text-muted-foreground">
                          {event.location}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AllDayRow({
  days,
  events,
  colorOf,
  onSelectEvent,
}: {
  days: Date[];
  events: CalEvent[];
  colorOf: (calendarId: string) => string;
  onSelectEvent: (event: CalEvent) => void;
}) {
  const allDay = events.filter((e) => e.all_day);
  if (allDay.length === 0) return null;

  return (
    <div
      className="grid border-b bg-muted/20"
      style={{ gridTemplateColumns: `3rem repeat(${days.length}, 1fr)` }}
    >
      <div className="border-r py-1 text-center text-[10px] text-muted-foreground">
        整日
      </div>
      {days.map((day) => {
        const ds = format(day, "yyyy-MM-dd");
        const dayAllDay = allDay.filter((e) => {
          const s = format(zoned(e.starts_at), "yyyy-MM-dd");
          const en = format(zoned(e.ends_at), "yyyy-MM-dd");
          return ds >= s && ds <= en;
        });
        return (
          <div key={ds} className="space-y-0.5 border-r p-1 last:border-r-0">
            {dayAllDay.map((ev) => (
              <button
                key={ev.id}
                type="button"
                title={`整日 ${ev.title}${ev.location ? ` @ ${ev.location}` : ""}`}
                onClick={() => onSelectEvent(ev)}
                style={eventStyle(colorOf(ev.calendar_id))}
                className="block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] hover:brightness-95 touch:py-2 touch:text-xs"
              >
                {ev.title}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
