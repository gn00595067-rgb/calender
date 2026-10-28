"use client";

import { Star } from "lucide-react";
import { layoutDay } from "@/lib/calendar-utils";
import { eventStyle, displayTitle } from "@/components/calendar/event-visuals";
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
                {positioned.map(({ event, col, cols, span }) => {
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
                        width: `calc(${span * widthPct}% - 2px)`,
                      }}
                      className="flex flex-col overflow-hidden rounded px-1 py-px text-left hover:brightness-95"
                    >
                      <EventChipBody
                        title={event.title}
                        start={D.time(event.starts_at)}
                        important={event.is_important}
                        height={height}
                        narrow={cols > 1}
                      />
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

/** 每行字高（px）：11px 字、行高 1.2 */
const LINE_PX = 13;

/**
 * 行程塊內容：內容優先（Peggy 回饋 5-2：很多只看到時間、看不到行程內容）。
 * 標題放最上面、可折多行填滿色塊（窄欄也不切成「17-2…」）；
 * 標題本身已寫了時間（如「0730小游」）就不再另列時間，否則塊夠高才在下面補開始時間。
 */
function EventChipBody({
  title,
  start,
  important,
  height,
  narrow,
}: {
  title: string;
  start: string;
  important: boolean;
  height: number;
  narrow: boolean;
}) {
  const text = displayTitle(title, start);
  const titleHasTime = text !== title;
  const lines = Math.max(1, Math.floor((height - 2) / LINE_PX));
  // 時間另佔一行：塊夠高（至少還能放 2 行標題）且標題裡沒有時間才顯示
  const showTime = !titleHasTime && lines >= 3;
  const titleLines = showTime ? lines - 1 : lines;
  return (
    <>
      <span
        className="overflow-hidden text-[11px] font-medium leading-[1.2] [overflow-wrap:anywhere]"
        style={{
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: titleLines,
          // 窄欄（同時段多筆並排）字縮一點，多塞幾個字
          fontSize: narrow ? 10 : undefined,
        }}
      >
        {important && (
          <Star className="mr-0.5 inline size-2.5 fill-amber-400 align-[-1px] text-amber-500" />
        )}
        {title}
      </span>
      {showTime && (
        <span className="mt-auto text-[9px] leading-none text-muted-foreground tabular-nums">
          {start}
        </span>
      )}
    </>
  );
}
