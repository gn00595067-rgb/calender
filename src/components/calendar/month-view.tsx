"use client";

import { Fragment, useState } from "react";
import { format, isSameMonth, isToday } from "date-fns";
import { CalendarRange, Plus } from "lucide-react";
import { zoned } from "@/lib/calendar-utils";
import { D } from "@/lib/date";
import { cn } from "@/lib/utils";
import {
  freeOnDay,
  eventSegmentOnDay,
  minToHHMM,
  routineSegments,
} from "@/lib/availability";
import { useGapProfiles } from "@/lib/client/lookups";
import { MonthChip, MonthSpanBar, EventTwoLineCard } from "./event-card";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { CalEvent } from "@/lib/client/events";

// getDay() 索引用（0=日..6=六）
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
// 月曆表頭順序：週一起（一二三四五六日）
const WEEK_HEADER = ["一", "二", "三", "四", "五", "六", "日"];

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

/** 聚焦某對象時，以此工作時段（08–22）計算其一日內的真實空檔 */
const FOCUS_WINDOW = { start: 8 * 60, end: 22 * 60 };
/** 聚焦空檔門檻：月曆格較小取 1 小時、當天面板取 30 分 */
const FOCUS_MIN_GAP_CELL = 60;
const FOCUS_MIN_GAP_PEEK = 30;

/** 空檔對象（聚焦）：其他行程淡化，空檔只依此對象計算並標名 */
export type GapFilter = { name: string; match: (e: CalEvent) => boolean };
/**
 * 家庭視角：以本人（primary）為主軸，家人（members）只在「當天有活動」的日子
 * 才一併顯示其空檔。不淡化任何行程。
 */
export type FamilyFocus = { primary: GapFilter; members: GapFilter[] };
/** 一段標名空檔（供月曆／面板統一渲染） */
type FreeLine = { start: number; end: number; label: string };

/** 取得事件在台北曆涵蓋的日期字串（含跨日） */
function eventDays(event: CalEvent): string[] {
  const s = zoned(event.starts_at);
  const e = zoned(event.ends_at);
  // 剛好結束在 00:00 的行程不算佔到隔天（如 22:00–00:00、整日行程存成隔天零點）
  if (+e > +s && e.getHours() === 0 && e.getMinutes() === 0) {
    e.setMinutes(-1);
  }
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

/** 一週內的一段跨日橫條：從第 startCol 欄畫到 endCol 欄（0–6），放在第 lane 層 */
type SpanSeg = {
  event: CalEvent;
  startCol: number;
  endCol: number;
  lane: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
};

/**
 * 把一週內的跨日行程排成橫條：先開始、較長的排上層，
 * 每段放進第一個不重疊的層（同 Google 日曆的排法）。
 */
function layoutSpans(
  weekDs: string[],
  multiDay: { event: CalEvent; days: string[] }[],
): SpanSeg[] {
  const segs: Omit<SpanSeg, "lane">[] = [];
  for (const { event, days } of multiDay) {
    const cols = weekDs
      .map((ds, i) => (days.includes(ds) ? i : -1))
      .filter((i) => i >= 0);
    if (cols.length === 0) continue;
    segs.push({
      event,
      startCol: cols[0],
      endCol: cols[cols.length - 1],
      continuesBefore: days[0] < weekDs[0],
      continuesAfter: days[days.length - 1] > weekDs[6],
    });
  }
  segs.sort(
    (a, b) =>
      a.startCol - b.startCol ||
      b.endCol - b.startCol - (a.endCol - a.startCol) ||
      +new Date(a.event.starts_at) - +new Date(b.event.starts_at),
  );
  // laneEnds[k]＝第 k 層目前佔到的最後一欄
  const laneEnds: number[] = [];
  return segs.map((s) => {
    let lane = laneEnds.findIndex((end) => end < s.startCol);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = s.endCol;
    return { ...s, lane };
  });
}

export function MonthView({
  days,
  monthStart,
  events,
  gapFilter,
  familyFocus,
  colorOf,
  conflicts,
  canCreate,
  onSelectEvent,
  onCreateAt,
  onOpenDay,
}: {
  days: Date[];
  monthStart: Date;
  events: CalEvent[];
  gapFilter?: GapFilter | null;
  familyFocus?: FamilyFocus | null;
  colorOf: (calendarId: string) => string;
  conflicts: Set<string>;
  canCreate: boolean;
  onSelectEvent: (event: CalEvent) => void;
  onCreateAt: (dateStr: string, hour?: number, minute?: number) => void;
  onOpenDay: (dateStr: string) => void;
}) {
  // 空檔一律以「標名空檔」呈現（含全部行程模式）
  const focusOn = true;
  // 只有「單一對象聚焦」才淡化非對象；家庭／全部視角不淡化
  const dimNonTarget = !!gapFilter && !familyFocus;
  const isTarget = (ev: CalEvent) => !dimNonTarget || gapFilter!.match(ev);
  // 家人的空檔設定：固定作息（上學等）不算空檔、只列指定的人、本人合併
  const { data: gapProfiles } = useGapProfiles();
  const routines = gapProfiles?.routines;
  const selfName = gapProfiles?.selfName ?? null;
  /** 未指定主角、或主角是本人（老闆）的行程＝本人的 */
  const isSelfEvent = (e: CalEvent) =>
    e.subjectNames.length === 0 || (!!selfName && e.subjectNames.includes(selfName));
  /** 「全部／家庭」視角下，這個人這天要不要列空檔（主動聚焦單一對象時不受限） */
  const showGapsFor = (name: string, ds: string) => {
    if (!gapProfiles?.hasGapMode) return true; // 0015 前：沿用舊行為
    const mode = gapProfiles.gapMode.get(name) ?? "off";
    if (mode === "always") return true;
    if (mode === "free_days") return routineSegments(routines?.get(name) ?? [], ds).length === 0;
    return false;
  };

  /**
   * 某日的標名空檔。通用規則：**當天有行程的人才列空檔**（含本人）；
   * 當天沒行程者不列（避免整天全空的雜訊）。
   * - 單一對象聚焦：只列該對象
   * - 家庭視角：本人＋家人
   * - 全部行程：本人＋當天出現的每位主角
   */
  const freeLinesFor = (dayEvents: CalEvent[], ds: string, minGap: number): FreeLine[] => {
    const self = { label: "本人", match: isSelfEvent };
    const asGroup = (g: GapFilter) => ({ label: g.name, match: g.match });
    // 家人群組：本人已合併，其餘依各自的「月曆空檔」設定決定要不要列
    const memberOk = (name: string) => name !== selfName && showGapsFor(name, ds);
    let groups: { label: string; match: (e: CalEvent) => boolean }[];
    if (gapFilter && !familyFocus) {
      groups = [asGroup(gapFilter)];
    } else if (familyFocus) {
      groups = [
        { label: "本人", match: isSelfEvent },
        ...familyFocus.members.filter((m) => memberOk(m.name)).map(asGroup),
      ];
    } else {
      // 全部行程：本人＋當天出現、且設定要列空檔的主角
      const names = new Set<string>();
      for (const e of dayEvents) for (const s of e.subjectNames) names.add(s);
      groups = [
        self,
        ...[...names].filter(memberOk).map((name) => ({
          label: name,
          match: (e: CalEvent) => e.subjectNames.includes(name),
        })),
      ];
    }

    const lines: FreeLine[] = [];
    for (const g of groups) {
      const evs = dayEvents.filter(g.match);
      // 當天要「有實際時段行程」才列此人的空檔
      if (!evs.some((e) => !e.all_day)) continue;
      const fixed = routineSegments(routines?.get(g.label) ?? [], ds);
      for (const b of freeOnDay(evs, ds, FOCUS_WINDOW, minGap, fixed)) {
        lines.push({ ...b, label: g.label });
      }
    }
    return lines.sort((a, b) => a.start - b.start || a.label.localeCompare(b.label));
  };
  // 點某天 → 從底部滑出當天面板（不切走視圖，關掉即回月曆）。
  const [peekDay, setPeekDay] = useState<string | null>(null);

  const byDay = new Map<string, CalEvent[]>();
  // 跨日行程：月曆格上改畫成橫條，不在每天重複列 chip
  const multiDay: { event: CalEvent; days: string[] }[] = [];
  const multiDayIds = new Set<string>();
  for (const ev of events) {
    const evDays = eventDays(ev);
    if (evDays.length > 1) {
      multiDay.push({ event: ev, days: evDays });
      multiDayIds.add(ev.id);
    }
    for (const ds of evDays) {
      const arr = byDay.get(ds);
      if (arr) arr.push(ev);
      else byDay.set(ds, [ev]);
    }
  }

  // 面板：當天全部行程（依開始時間排序）與最晚結束時間。
  const peekEvents = peekDay
    ? (byDay.get(peekDay) ?? [])
        .slice()
        .sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at))
    : [];
  const peekTimed = peekEvents.filter((e) => !e.all_day);
  const peekLastEnd =
    peekTimed.length > 0
      ? peekTimed.reduce(
          (acc, e) => (new Date(e.ends_at) > new Date(acc) ? e.ends_at : acc),
          peekTimed[0].ends_at,
        )
      : null;
  // 聚焦：當天面板中的真實標名空檔（門檻較低，供規劃）
  const peekFree: FreeLine[] =
    peekDay && focusOn
      ? freeLinesFor(peekEvents, peekDay, FOCUS_MIN_GAP_PEEK)
      : [];

  return (
    <>
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-xs font-medium text-muted-foreground">
        {WEEK_HEADER.map((w) => (
          <div key={w} className="py-2">
            {w}
          </div>
        ))}
      </div>
      {Array.from({ length: Math.ceil(days.length / 7) }, (_, w) => {
        const week = days.slice(w * 7, w * 7 + 7);
        const weekDs = week.map((d) => format(d, "yyyy-MM-dd"));
        const spans = layoutSpans(weekDs, multiDay);
        const laneCount = spans.reduce((m, s) => Math.max(m, s.lane + 1), 0);
        // 列：日期列｜每層跨日橫條｜當天其他行程（撐滿剩餘高度）
        const contentRow = laneCount + 2;
        return (
          <div
            key={weekDs[0]}
            className="grid min-h-24 grid-cols-7"
            style={{
              gridTemplateRows: `auto ${laneCount ? `repeat(${laneCount}, auto) ` : ""}1fr`,
            }}
          >
            {week.map((day, i) => {
              const ds = weekDs[i];
              const inMonth = isSameMonth(day, monthStart);
              const today = isToday(day);
              // 格子底：整欄（跨所有列）負責框線、底色與「點空白處開當天面板」
              return (
                <div
                  key={`bg-${ds}`}
                  onClick={() => setPeekDay(ds)}
                  style={{ gridColumn: i + 1, gridRow: "1 / -1" }}
                  className={cn(
                    "cursor-pointer border-b",
                    i < 6 && "border-r",
                    !inMonth && "bg-muted/30",
                    today &&
                      "bg-amber-50 ring-2 ring-inset ring-amber-400 dark:bg-amber-950/30 dark:ring-amber-500/70",
                  )}
                />
              );
            })}

            {week.map((day, i) => {
              const ds = weekDs[i];
              const inMonth = isSameMonth(day, monthStart);
              const today = isToday(day);
              return (
                <div
                  key={`head-${ds}`}
                  style={{ gridColumn: i + 1, gridRow: 1 }}
                  className={cn(
                    "pointer-events-none flex items-center gap-1 p-1 [&_button]:pointer-events-auto",
                    !inMonth && "text-muted-foreground",
                  )}
                >
                  {canCreate && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onCreateAt(ds);
                      }}
                      aria-label={`在 ${format(day, "M月d日")} 新增行程`}
                      title="新增行程"
                      className="flex size-6 items-center justify-center rounded-full text-muted-foreground/50 transition hover:bg-accent hover:text-foreground touch:size-9"
                    >
                      <Plus className="size-3.5 touch:size-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPeekDay(ds);
                    }}
                    aria-label={`查看 ${format(day, "M月d日")} 整天`}
                    title="查看整天"
                    className={cn(
                      "ml-auto flex size-6 items-center justify-center rounded-full text-xs transition touch:size-9 touch:text-sm",
                      today
                        ? "bg-primary font-bold text-primary-foreground"
                        : "hover:bg-accent",
                      !today && !inMonth && "text-muted-foreground/60",
                    )}
                  >
                    {format(day, "d")}
                  </button>
                </div>
              );
            })}

            {spans.map((s) => (
              <div
                key={`span-${s.event.id}`}
                style={{
                  gridColumn: `${s.startCol + 1} / ${s.endCol + 2}`,
                  gridRow: s.lane + 2,
                }}
                className={cn(
                  "relative py-px",
                  // 延續段貼齊格線，看起來才像同一條槓
                  s.continuesBefore ? "pl-0" : "pl-1",
                  s.continuesAfter ? "pr-0" : "pr-1",
                  !isTarget(s.event) && "opacity-40",
                )}
              >
                <MonthSpanBar
                  event={s.event}
                  color={colorOf(s.event.calendar_id)}
                  conflict={conflicts.has(s.event.id)}
                  showTime={!s.continuesBefore}
                  continuesBefore={s.continuesBefore}
                  continuesAfter={s.continuesAfter}
                  onClick={() => onSelectEvent(s.event)}
                />
              </div>
            ))}

            {week.map((day, i) => {
              const ds = weekDs[i];
              const dayEvents = (byDay.get(ds) ?? []).sort(
                (a, b) => +new Date(a.starts_at) - +new Date(b.starts_at),
              );
              // 跨日行程已畫成上方橫條，格內只列當天的單日行程
              const singleDay = dayEvents.filter((e) => !multiDayIds.has(e.id));
              const shown = singleDay.slice(0, 3);
              const extra = singleDay.length - shown.length;
              // 空檔與「結束」提示仍以當天全部行程（含跨日）計算
              const cellFree: FreeLine[] = focusOn
                ? freeLinesFor(dayEvents, ds, FOCUS_MIN_GAP_CELL)
                : [];

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
                  key={`body-${ds}`}
                  style={{ gridColumn: i + 1, gridRow: contentRow }}
                  className="pointer-events-none space-y-0.5 p-1 pt-0.5 [&_button]:pointer-events-auto"
                >
                  {focusOn
                    ? (() => {
                        // 聚焦：標名空檔穿插於行程間；單一對象模式淡化非對象
                        const nodes: React.ReactNode[] = [];
                        let bi = 0;
                        const flushBefore = (limit: number) => {
                          while (bi < cellFree.length && cellFree[bi].start < limit) {
                            const b = cellFree[bi++];
                            nodes.push(
                              <div
                                key={`free-${ds}-${b.label}-${b.start}`}
                                className="flex items-center gap-1 px-0.5 text-[10px] leading-none text-primary/80"
                              >
                                <span className="h-px flex-1 bg-primary/25" />
                                <span className="shrink-0 tabular-nums">
                                  {b.label} 空 {fmtDur(b.end - b.start)}
                                </span>
                                <span className="h-px flex-1 bg-primary/25" />
                              </div>,
                            );
                          }
                        };
                        for (const ev of shown) {
                          const segStart = eventSegmentOnDay(ev, ds)?.start ?? 0;
                          flushBefore(segStart);
                          nodes.push(
                            <div
                              key={ev.id + ds}
                              className={cn(!isTarget(ev) && "opacity-40")}
                            >
                              <MonthChip
                                event={ev}
                                color={colorOf(ev.calendar_id)}
                                conflict={conflicts.has(ev.id)}
                                onClick={() => onSelectEvent(ev)}
                              />
                            </div>,
                          );
                        }
                        flushBefore(Infinity);
                        return nodes;
                      })()
                    : shown.map((ev, i) => {
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
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPeekDay(ds);
                      }}
                      className="w-full rounded px-1 py-0.5 text-left text-[11px] font-medium text-muted-foreground hover:bg-accent touch:py-2 touch:text-xs"
                    >
                      +{extra} 筆 · 看整天
                    </button>
                  )}
                  {lastEndIso && (
                    <div className="pt-0.5 text-right text-[10px] font-medium leading-none text-muted-foreground/80 tabular-nums">
                      結束 {D.time(lastEndIso)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>

      <Sheet
        open={peekDay !== null}
        onOpenChange={(o) => !o && setPeekDay(null)}
      >
        <SheetContent
          side="bottom"
          className="max-h-[80vh] gap-0 rounded-t-2xl"
        >
          <SheetHeader className="border-b">
            <SheetTitle>{peekDay ? dayTitle(peekDay) : ""}</SheetTitle>
            <p className="text-xs text-muted-foreground">
              {peekTimed.length > 0
                ? `${peekEvents.length} 筆行程 · 最後 ${D.time(peekLastEnd!)} 結束`
                : peekEvents.length > 0
                  ? `${peekEvents.length} 筆行程`
                  : "這天沒有行程"}
            </p>
            {peekDay && (() => {
              // 當天生效的固定作息（上學等），說明為什麼那段不算空檔
              const items = [...(routines?.entries() ?? [])].flatMap(([name, blocks]) =>
                blocks
                  .filter((b) => routineSegments([b], peekDay).length > 0)
                  .map((b) => `${name}・${b.label} ${b.start}–${b.end}`),
              );
              return items.length > 0 ? (
                <p className="text-xs text-muted-foreground">固定作息（不算空檔）：{items.join("　")}</p>
              ) : null;
            })()}
          </SheetHeader>

          <div className="flex-1 space-y-1 overflow-y-auto p-4">
            {peekEvents.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                這天還沒有安排，點下方按鈕新增。
              </p>
            ) : (
              focusOn
                ? (() => {
                    // 聚焦：標名空檔（可點擊在空檔起點新增），單一對象模式淡化非對象
                    const nodes: React.ReactNode[] = [];
                    let bi = 0;
                    const flushBefore = (limit: number) => {
                      while (bi < peekFree.length && peekFree[bi].start < limit) {
                        const b = peekFree[bi++];
                        const label = `${b.label} 空檔 ${minToHHMM(b.start)}–${minToHHMM(b.end)} · ${fmtDur(b.end - b.start)}`;
                        nodes.push(
                          <div
                            key={`free-${b.label}-${b.start}`}
                            className="flex items-center gap-2 px-1 py-0.5 text-xs text-primary"
                          >
                            <span className="h-px flex-1 bg-primary/30" />
                            {canCreate ? (
                              <button
                                type="button"
                                onClick={() => {
                                  const ds = peekDay;
                                  setPeekDay(null);
                                  if (ds)
                                    onCreateAt(
                                      ds,
                                      Math.floor(b.start / 60),
                                      b.start % 60,
                                    );
                                }}
                                title="在這個空檔新增行程"
                                className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-primary/40 px-2 py-0.5 tabular-nums transition hover:bg-accent touch:py-1"
                              >
                                <Plus className="size-3" />
                                {label}
                              </button>
                            ) : (
                              <span className="shrink-0 tabular-nums">{label}</span>
                            )}
                            <span className="h-px flex-1 bg-primary/30" />
                          </div>,
                        );
                      }
                    };
                    for (const ev of peekEvents) {
                      const segStart = eventSegmentOnDay(ev, peekDay!)?.start ?? 0;
                      flushBefore(segStart);
                      nodes.push(
                        <div
                          key={ev.id}
                          className={cn(!isTarget(ev) && "opacity-40")}
                        >
                          <EventTwoLineCard
                            event={ev}
                            color={colorOf(ev.calendar_id)}
                            conflict={conflicts.has(ev.id)}
                            onClick={() => {
                              onSelectEvent(ev);
                              setPeekDay(null);
                            }}
                          />
                        </div>,
                      );
                    }
                    flushBefore(Infinity);
                    return nodes;
                  })()
                : peekEvents.map((ev, i) => {
                    const prev = i > 0 ? peekEvents[i - 1] : null;
                    const gap =
                      prev && !prev.all_day && !ev.all_day
                        ? gapMinutes(prev, ev)
                        : 0;
                    return (
                      <Fragment key={ev.id}>
                        {gap >= MIN_GAP_MINUTES && (
                          <div className="flex items-center gap-2 px-1 py-0.5 text-xs text-muted-foreground">
                            <span className="h-px flex-1 bg-border" />
                            {canCreate ? (
                              <button
                                type="button"
                                onClick={() => {
                                  const end = zoned(prev!.ends_at);
                                  const ds = peekDay;
                                  setPeekDay(null);
                                  if (ds)
                                    onCreateAt(
                                      ds,
                                      end.getHours(),
                                      end.getMinutes(),
                                    );
                                }}
                                title="在這個空檔新增行程"
                                className="inline-flex shrink-0 items-center gap-0.5 rounded-full border px-2 py-0.5 tabular-nums transition hover:border-primary hover:bg-accent hover:text-foreground touch:py-1"
                              >
                                <Plus className="size-3" />空檔 {fmtDur(gap)}
                              </button>
                            ) : (
                              <span className="shrink-0 tabular-nums">
                                空檔 {fmtDur(gap)}
                              </span>
                            )}
                            <span className="h-px flex-1 bg-border" />
                          </div>
                        )}
                        <EventTwoLineCard
                          event={ev}
                          color={colorOf(ev.calendar_id)}
                          conflict={conflicts.has(ev.id)}
                          onClick={() => {
                            onSelectEvent(ev);
                            setPeekDay(null);
                          }}
                        />
                      </Fragment>
                    );
                  })
            )}
          </div>

          <SheetFooter className="flex-row gap-2 border-t">
            {canCreate && (
              <Button
                className="flex-1 touch:h-12"
                onClick={() => {
                  const ds = peekDay;
                  setPeekDay(null);
                  if (ds) onCreateAt(ds);
                }}
              >
                <Plus className="size-4" />
                在這天新增
              </Button>
            )}
            <Button
              variant="outline"
              className="flex-1 touch:h-12"
              onClick={() => {
                const ds = peekDay;
                setPeekDay(null);
                if (ds) onOpenDay(ds);
              }}
            >
              <CalendarRange className="size-4" />
              以日視圖開啟
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

/** 面板標題：8月24日 週日 */
function dayTitle(ds: string): string {
  const [y, m, d] = ds.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return `${m}月${d}日 週${WEEKDAYS[date.getDay()]}`;
}
