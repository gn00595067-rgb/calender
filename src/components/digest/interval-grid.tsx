"use client";

import { Star } from "lucide-react";
import { layoutDay } from "@/lib/calendar-utils";
import { eventStyle } from "@/components/calendar/event-visuals";
import { D, taipeiDateStartUtcISO } from "@/lib/date";
import { cn } from "@/lib/utils";
import type { CalEvent } from "@/lib/client/events";
import {
  eventSegmentOnDay,
  allDayOnDay,
  dayAvailability,
  roughHours,
  type WorkWindow,
} from "@/lib/availability";

const dayStartIso = (ds: string) => taipeiDateStartUtcISO(ds);
const dowChar = (ds: string) =>
  "日一二三四五六"[new Date(`${ds}T12:00:00Z`).getUTCDay()];

/**
 * 區間格狀時間表（24×N，一眼掌握）。
 * 整個時間帶壓進單一畫面、不捲動：每欄一天、縱軸為所選時間帶，
 * 色塊＝行程、空白＝空檔、★＝重點、紅框＝衝突。
 */
export function IntervalGrid({
  days,
  events,
  w,
  colorOf,
  conflicts,
  minGap,
  onSelect,
  onCreateAt,
  todayStr,
}: {
  days: string[];
  events: CalEvent[];
  w: WorkWindow;
  colorOf: (id: string) => string;
  conflicts: Set<string>;
  minGap: number;
  onSelect?: (e: CalEvent) => void;
  /** 點空白時段新增行程（dateStr 台北曆日、hour 0–23）；未提供則不可新增 */
  onCreateAt?: (dateStr: string, hour: number) => void;
  todayStr?: string;
}) {
  const windowHours = Math.max(1, (w.end - w.start) / 60);
  // 讓整個時間帶塞進約一個畫面：依時數自動決定每小時像素
  const pxPerHour = Math.max(20, Math.min(64, Math.round(560 / windowHours)));
  const bodyHeight = windowHours * pxPerHour;
  const labelStep = pxPerHour < 26 ? 3 : pxPerHour < 40 ? 2 : 1;
  const startHour = w.start / 60;

  const gridCols = `2.75rem repeat(${days.length}, minmax(0, 1fr))`;

  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <div style={{ minWidth: days.length > 5 ? days.length * 88 + 44 : undefined }}>
        {/* 表頭：日期 + 當日筆數/空檔 */}
        <div className="grid border-b" style={{ gridTemplateColumns: gridCols }}>
          <div className="border-r bg-muted/40" />
          {days.map((ds) => {
            const a = dayAvailability(events, ds, w, minGap);
            const timedCount = events.filter(
              (e) => eventSegmentOnDay(e, ds) !== null,
            ).length;
            const isToday = ds === todayStr;
            return (
              <div
                key={ds}
                className={cn(
                  "border-r px-1 py-1.5 text-center last:border-r-0",
                  isToday && "bg-primary/5",
                )}
              >
                <div className="text-[11px] text-muted-foreground">
                  週{dowChar(ds)}
                </div>
                <div
                  className={cn(
                    "mx-auto flex h-6 items-center justify-center rounded-full px-1.5 text-sm font-semibold",
                    isToday && "bg-primary text-primary-foreground",
                  )}
                >
                  {D.monthDay(dayStartIso(ds))}
                </div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  {timedCount} 筆
                  {a.freeMin > 0 && (
                    <span className="text-emerald-600"> · 空 {roughHours(a.freeMin)}h</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* 整日列 */}
        <AllDayRow days={days} events={events} colorOf={colorOf} onSelect={onSelect} />

        {/* 時間帶 */}
        <div className="grid" style={{ gridTemplateColumns: gridCols }}>
          {/* 小時刻度 */}
          <div className="relative border-r" style={{ height: bodyHeight }}>
            {Array.from({ length: windowHours }).map((_, i) => {
              const hour = startHour + i;
              return (
                <div
                  key={i}
                  className="border-b"
                  style={{ height: pxPerHour }}
                >
                  {i % labelStep === 0 && (
                    <span className="pl-1 text-[10px] text-muted-foreground">
                      {String(hour).padStart(2, "0")}:00
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* 每日欄 */}
          {days.map((ds) => {
            const dayEvents = events.filter((e) => {
              const seg = eventSegmentOnDay(e, ds);
              if (!seg) return false;
              return Math.min(seg.end, w.end) > Math.max(seg.start, w.start);
            });
            const positioned = layoutDay(dayEvents);
            const isToday = ds === todayStr;
            return (
              <div
                key={ds}
                className={cn(
                  "relative border-r last:border-r-0",
                  isToday && "bg-primary/[0.03]",
                  onCreateAt && "cursor-pointer",
                )}
                style={{ height: bodyHeight }}
                onClick={
                  onCreateAt
                    ? (e) => {
                        const rect = (
                          e.currentTarget as HTMLElement
                        ).getBoundingClientRect();
                        const y = e.clientY - rect.top;
                        const hour = Math.max(
                          0,
                          Math.min(23, Math.floor(y / pxPerHour) + startHour),
                        );
                        onCreateAt(ds, hour);
                      }
                    : undefined
                }
              >
                {Array.from({ length: windowHours }).map((_, i) => (
                  <div key={i} className="border-b" style={{ height: pxPerHour }} />
                ))}
                {positioned.map(({ event, col, cols }) => {
                  const seg = eventSegmentOnDay(event, ds)!;
                  const s = Math.max(seg.start, w.start);
                  const en = Math.min(seg.end, w.end);
                  const top = ((s - w.start) / 60) * pxPerHour;
                  const height = Math.max(13, ((en - s) / 60) * pxPerHour);
                  const widthPct = 100 / cols;
                  const isConflict = conflicts.has(event.id);
                  return (
                    <button
                      key={event.id}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect?.(event);
                      }}
                      title={`${D.time(event.starts_at)}–${D.time(event.ends_at)} ${event.title}${
                        isConflict ? "（衝突）" : ""
                      }`}
                      style={{
                        ...eventStyle(colorOf(event.calendar_id), isConflict),
                        position: "absolute",
                        top,
                        height,
                        left: `calc(${col * widthPct}% + 1px)`,
                        width: `calc(${widthPct}% - 2px)`,
                      }}
                      className="overflow-hidden rounded px-1 text-left leading-tight hover:brightness-95"
                    >
                      <span className="flex items-center gap-0.5 text-[10px] font-semibold">
                        {event.is_important && (
                          <Star className="size-2.5 shrink-0 fill-amber-400 text-amber-500" />
                        )}
                        {height >= 26 && (
                          <span className="tabular-nums">{D.time(event.starts_at)}</span>
                        )}
                        {height < 26 && (
                          <span className="truncate">{event.title}</span>
                        )}
                      </span>
                      {height >= 26 && (
                        <span className="block truncate text-[11px] font-medium">
                          {event.title}
                        </span>
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
  onSelect,
}: {
  days: string[];
  events: CalEvent[];
  colorOf: (id: string) => string;
  onSelect?: (e: CalEvent) => void;
}) {
  const anyAllDay = days.some((ds) => allDayOnDay(events, ds).length > 0);
  if (!anyAllDay) return null;
  return (
    <div
      className="grid border-b bg-muted/20"
      style={{ gridTemplateColumns: `2.75rem repeat(${days.length}, minmax(0, 1fr))` }}
    >
      <div className="flex items-center justify-center border-r py-1 text-[10px] text-muted-foreground">
        整日
      </div>
      {days.map((ds) => (
        <div key={ds} className="space-y-0.5 border-r p-1 last:border-r-0">
          {allDayOnDay(events, ds).map((ev) => (
            <button
              key={ev.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelect?.(ev);
              }}
              style={eventStyle(colorOf(ev.calendar_id))}
              className="block w-full truncate rounded px-1 text-left text-[10px] hover:brightness-95"
            >
              {ev.title}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
