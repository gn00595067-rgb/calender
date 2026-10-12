"use client";

import { useEffect, useRef } from "react";
import { format, isToday } from "date-fns";
import { zoned, layoutDay } from "@/lib/calendar-utils";
import { cn } from "@/lib/utils";
import { D } from "@/lib/date";
import { eventSegmentOnDay } from "@/lib/availability";
import { eventStyle, chipStyle, displayTitle } from "./event-visuals";
import { useNarrow } from "@/lib/client/use-narrow";
import { Plus, Star } from "lucide-react";
import type { CalEvent } from "@/lib/client/events";

const HOUR_HEIGHT = 48;
/** 手機週檢視：一欄只有約 45px 寬，每小時加高讓 1 小時的行程也放得下 3～4 個字×3 行 */
const COMPACT_HOUR_HEIGHT = 64;
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

/** 時間軸標籤用的精簡時長：1h30／45m */
function fmtDurShort(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h}h${m}`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/** 分鐘 → HH:MM（1440 以上視為跨日） */
function hhmm(min: number): string {
  if (min >= 24 * 60) return "跨日";
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** 空檔門檻（分鐘）：時間軸較密，門檻拉高以免雜訊 */
const GRID_MIN_GAP = 30;

/** 合併當天所有時段行程成忙碌區間（分鐘），用於算空檔與最後結束；跨日行程只取落在當天的那段 */
function busyIntervals(dayEvents: CalEvent[], ds: string): [number, number][] {
  const spans = dayEvents
    .map((e) => eventSegmentOnDay(e, ds))
    .filter((seg): seg is NonNullable<typeof seg> => seg !== null)
    .map((seg): [number, number] => [seg.start, seg.end])
    .sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [s, e] of spans) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

export function TimeGridView({
  days,
  events,
  gapFilter,
  colorOf,
  conflicts,
  canCreate,
  onSelectEvent,
  onCreateAt,
  onOpenDay,
}: {
  days: Date[];
  events: CalEvent[];
  gapFilter?: { name: string; match: (e: CalEvent) => boolean } | null;
  colorOf: (calendarId: string) => string;
  conflicts: Set<string>;
  canCreate: boolean;
  onSelectEvent: (event: CalEvent) => void;
  onCreateAt: (dateStr: string, hour: number, minute?: number) => void;
  /** 點表頭日期 → 切到那天的日檢視 */
  onOpenDay?: (dateStr: string) => void;
}) {
  const isTarget = (ev: CalEvent) => !gapFilter || gapFilter.match(ev);
  const scrollRef = useRef<HTMLDivElement>(null);

  const isSingle = days.length === 1;
  // 手機週檢視（7 天擠一頁）：比 Google 更重可讀性——加高、只放標題、底色加深
  const narrow = useNarrow();
  const compact = narrow && !isSingle;
  const HOUR_H = compact ? COMPACT_HOUR_HEIGHT : HOUR_HEIGHT;
  const gridCols = gridColsOf(days.length);
  const daysKey = days.map((d) => format(d, "yyyy-MM-dd")).join(",");

  // 捲到 7 點；當天有更早的行程（如 05:30 打球）就捲到那筆開始前。
  // 行程是非同步載入的，載入後再調整一次；之後使用者自己捲就不再動。
  const earliestMin = days.reduce((min, day) => {
    const ds = format(day, "yyyy-MM-dd");
    for (const e of events) {
      const seg = eventSegmentOnDay(e, ds);
      if (seg && seg.start < min) min = seg.start;
    }
    return min;
  }, 7 * 60);
  const hasEvents = events.length > 0;
  useEffect(() => {
    if (scrollRef.current)
      scrollRef.current.scrollTop = Math.max(0, (earliestMin - 30) / 60) * HOUR_H;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在換日期／首次有資料時捲動
  }, [daysKey, hasEvents, compact]);

  return (
    // 手機週檢視仿 Google：7 天均分一頁、不左右滑，時間欄縮窄、卡片小字折行
    <div
      className={cn(
        "overflow-hidden rounded-xl border bg-card [--time-col:3rem]",
        !isSingle && "max-sm:[--time-col:2.25rem]",
      )}
    >
      {/* 日期表頭 */}
      <div
        className="grid border-b"
        style={{ gridTemplateColumns: gridCols }}
      >
        <div className="border-r bg-muted" />
        {days.map((day) => {
          const today = isToday(day);
          const ds = format(day, "yyyy-MM-dd");
          const clickable = !isSingle && !!onOpenDay;
          return (
            <div
              key={ds}
              role={clickable ? "button" : undefined}
              title={clickable ? "看這天的詳細行程" : undefined}
              onClick={clickable ? () => onOpenDay(ds) : undefined}
              className={cn(
                "border-r py-2 text-center last:border-r-0",
                today && "bg-amber-50/60 dark:bg-amber-950/20",
                clickable && "cursor-pointer hover:bg-accent",
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
          style={{ gridTemplateColumns: gridCols }}
        >
          {/* 小時刻度 */}
          <div className="border-r bg-card">
            {Array.from({ length: 24 }).map((_, h) => (
              <div
                key={h}
                className="relative border-b text-right"
                style={{ height: HOUR_H }}
              >
                <span className="absolute -top-2 right-1 text-[10px] text-muted-foreground max-sm:right-0.5 max-sm:text-[9px]">
                  {h > 0 ? `${String(h).padStart(2, "0")}:00` : ""}
                </span>
              </div>
            ))}
          </div>

          {/* 每日欄 */}
          {days.map((day) => {
            const ds = format(day, "yyyy-MM-dd");
            // 跨日行程：每一天各畫一段（裁切到當天），讓每天都看得到
            const segs = new Map<string, { start: number; end: number }>();
            const dayEvents = events.filter((e) => {
              const seg = eventSegmentOnDay(e, ds);
              if (seg) segs.set(e.id, seg);
              return seg !== null;
            });
            const positioned = layoutDay(dayEvents);
            // 聚焦時空檔只依所選對象計算；否則用全部行程
            const busy = busyIntervals(
              gapFilter ? dayEvents.filter(isTarget) : dayEvents,
              ds,
            );
            const lastEndMin = busy.length > 0 ? busy[busy.length - 1][1] : null;
            return (
              <div
                key={ds}
                className={cn(
                  "relative border-r last:border-r-0",
                  isToday(day) && "bg-amber-50/60 dark:bg-amber-950/20",
                )}
                style={{ height: 24 * HOUR_H }}
                onClick={(e) => {
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const y = e.clientY - rect.top;
                  const hour = Math.max(0, Math.min(23, Math.floor(y / HOUR_H)));
                  onCreateAt(ds, hour);
                }}
              >
                {Array.from({ length: 24 }).map((_, h) => (
                  <div
                    key={h}
                    className="border-b"
                    style={{ height: HOUR_H }}
                  />
                ))}
                {positioned.map(({ event, col, cols, span }) => {
                  const { start: startMin, end: endMin } = segs.get(event.id)!;
                  const startDs = format(zoned(event.starts_at), "yyyy-MM-dd");
                  const endZ = zoned(event.ends_at);
                  const endDs = format(endZ, "yyyy-MM-dd");
                  const multiDay = startDs !== endDs;
                  const isCont = startDs < ds; // 前一天延續過來
                  const continues = endMin >= 24 * 60 && endDs > ds; // 延續到隔天
                  const top = (startMin / 60) * HOUR_H;
                  const height = Math.max(compact ? 30 : 20, ((endMin - startMin) / 60) * HOUR_H);
                  const widthPct = 100 / cols;
                  // 手機週檢視：重疊不左右平分（一張只剩 20px），改層疊——後開始的往右縮排疊上去
                  const cascadeLeft = col * Math.min(30, 60 / Math.max(1, cols - 1));
                  const chip = chipStyle(colorOf(event.calendar_id), conflicts.has(event.id));
                  return (
                    <button
                      key={event.id}
                      type="button"
                      title={`${multiDay ? `${format(zoned(event.starts_at), "M/d")} ` : ""}${D.time(event.starts_at)}–${
                        multiDay ? `${format(endZ, "M/d")} ` : ""
                      }${D.time(event.ends_at)} ${event.title}${
                        event.location ? ` @ ${event.location}` : ""
                      }${conflicts.has(event.id) ? "（衝突）" : ""}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectEvent(event);
                      }}
                      style={{
                        position: "absolute",
                        top,
                        height,
                        ...(compact
                          ? {
                              ...chip,
                              // 半透明底色疊在卡片底色上 → 不透明，疊住的卡不會透字
                              backgroundColor: "var(--card)",
                              backgroundImage: `linear-gradient(${chip.backgroundColor}, ${chip.backgroundColor})`,
                              borderLeftWidth: 3,
                              boxShadow: cols > 1 ? "0 0 0 1px var(--card)" : undefined,
                              left: `calc(${cascadeLeft}% + 1px)`,
                              width: `calc(${100 - cascadeLeft}% - 2px)`,
                            }
                          : {
                              ...eventStyle(colorOf(event.calendar_id), conflicts.has(event.id)),
                              left: `calc(${col * widthPct}% + 2px)`,
                              width: `calc(${span * widthPct}% - 4px)`,
                            }),
                      }}
                      className={cn(
                        "flex flex-col items-stretch justify-start overflow-hidden rounded-md px-1.5 py-0.5 text-left hover:brightness-95 touch:min-h-8",
                        compact && "rounded-sm px-[3px] py-[2px]",
                        !isTarget(event) && "opacity-40",
                      )}
                    >
                      {compact ? (
                        <CompactCardBody
                          title={isCont ? event.title : displayTitle(event.title, D.time(event.starts_at))}
                          time={isCont ? "↳續" : D.time(event.starts_at)}
                          important={event.is_important}
                          showTime={height >= 88 && cols === 1}
                        />
                      ) : (
                      <>
                      <div className="flex items-center gap-1 text-[11px] font-semibold leading-tight">
                        {event.is_important && (
                          <Star className="size-2.5 shrink-0 fill-amber-400 text-amber-500" />
                        )}
                        <span className="tabular-nums">
                          {isCont
                            ? `↳ 續～${continues ? "" : D.time(event.ends_at)}`
                            : D.time(event.starts_at)}
                          {!isCont && continues && ` → ${format(endZ, "M/d")} ${D.time(event.ends_at)}`}
                        </span>
                      </div>
                      <div
                        className={cn(
                          "line-clamp-2 text-xs font-medium leading-tight",
                          isSingle && "text-sm",
                        )}
                      >
                        {isCont ? event.title : displayTitle(event.title, D.time(event.starts_at))}
                      </div>
                      {height > 44 && event.location && (
                        <div className="truncate text-[10px] text-muted-foreground">
                          {event.location}
                        </div>
                      )}
                      </>
                      )}
                    </button>
                  );
                })}

                {/* 空檔標籤：相鄰忙碌區間之間的空白，標在中央；可點擊在此空檔新增 */}
                {busy.slice(0, -1).map(([, end], i) => {
                  const nextStart = busy[i + 1][0];
                  const gap = nextStart - end;
                  if (gap < GRID_MIN_GAP) return null;
                  const mid = ((end + nextStart) / 2 / 60) * HOUR_H;
                  return (
                    <div
                      key={`gap-${i}`}
                      className="pointer-events-none absolute inset-x-0 z-10 flex justify-center"
                      style={{ top: mid - 11 }}
                    >
                      {canCreate ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onCreateAt(ds, Math.floor(end / 60), end % 60);
                          }}
                          title={`在 ${hhmm(end)}–${hhmm(nextStart)} 空檔新增行程`}
                          className={cn(
                            "pointer-events-auto inline-flex items-center gap-0.5 rounded-full border bg-card/95 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm transition hover:border-primary hover:bg-accent hover:text-foreground touch:px-2 touch:py-1",
                            // 手機週檢視：縮成「空 6h」，不顯示＋號與聚焦對象名
                            !isSingle && "max-sm:px-1! max-sm:text-[9px]",
                          )}
                        >
                          <Plus className={cn("size-2.5", !isSingle && "max-sm:hidden")} />
                          <span className={cn(!isSingle && "max-sm:hidden")}>
                            {gapFilter ? `${gapFilter.name} ` : ""}
                          </span>
                          空 {fmtDurShort(gap)}
                        </button>
                      ) : (
                        <span
                          className={cn(
                            "rounded-full border bg-card/90 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm",
                            !isSingle && "max-sm:px-1 max-sm:text-[9px]",
                          )}
                        >
                          <span className={cn(!isSingle && "max-sm:hidden")}>
                            {gapFilter ? `${gapFilter.name} ` : ""}
                          </span>
                          空 {fmtDurShort(gap)}
                        </span>
                      )}
                    </div>
                  );
                })}

                {/* 最後結束時間：畫一條線 + 標籤 */}
                {lastEndMin !== null && lastEndMin < 24 * 60 && (
                  <div
                    className={cn(
                      "pointer-events-none absolute inset-x-0 z-10 flex items-center gap-1 px-1",
                      !isSingle && "max-sm:gap-0 max-sm:px-0",
                    )}
                    style={{ top: (lastEndMin / 60) * HOUR_H }}
                  >
                    <span className="h-px flex-1 bg-primary/40" />
                    <span
                      className={cn(
                        "rounded bg-primary/10 px-1 py-0.5 text-[10px] font-semibold text-primary tabular-nums",
                        !isSingle && "max-sm:px-0.5 max-sm:text-[9px]",
                      )}
                    >
                      <span className={cn(!isSingle && "max-sm:hidden")}>結束 </span>
                      {hhmm(lastEndMin)}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * 手機週檢視的卡片內容：標題放最上面、11px 粗體，字數多就往下折行填滿卡片
 * （只在必要時斷字，英文名不會像 Google 被切成 Ph/oe/nix）；卡片夠高才在底下補開始時間。
 */
function CompactCardBody({
  title,
  time,
  important,
  showTime,
}: {
  title: string;
  time: string;
  important: boolean;
  showTime: boolean;
}) {
  return (
    <>
      <div className="min-h-0 overflow-hidden text-[11px] font-semibold leading-[1.2] [overflow-wrap:anywhere]">
        {important && (
          <Star className="mr-0.5 inline size-2.5 fill-amber-400 align-[-1px] text-amber-500" />
        )}
        {title}
      </div>
      {showTime && (
        <div className="mt-auto shrink-0 pt-0.5 text-[9px] leading-none text-muted-foreground tabular-nums">
          {time}
        </div>
      )}
    </>
  );
}

/** 時間欄＋各天欄；minmax(0,1fr) 讓長字不會把欄撐寬（手機週檢視要 7 天塞一頁） */
function gridColsOf(n: number): string {
  return `var(--time-col) repeat(${n}, minmax(0, 1fr))`;
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
  const isSingle = days.length === 1;

  return (
    <div
      className="grid border-b bg-muted/20"
      style={{ gridTemplateColumns: gridColsOf(days.length) }}
    >
      <div className="border-r bg-muted py-1 text-center text-[10px] text-muted-foreground">
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
          <div
            key={ds}
            className={cn(
              "min-w-0 space-y-0.5 border-r p-1 last:border-r-0",
              !isSingle && "max-sm:p-0.5",
            )}
          >
            {dayAllDay.map((ev) => (
              <button
                key={ev.id}
                type="button"
                title={`整日 ${ev.title}${ev.location ? ` @ ${ev.location}` : ""}`}
                onClick={() => onSelectEvent(ev)}
                style={eventStyle(colorOf(ev.calendar_id))}
                className={cn(
                  "block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] hover:brightness-95 touch:py-2 touch:text-xs",
                  !isSingle && "max-sm:px-0.5 max-sm:text-[10px]!",
                )}
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
