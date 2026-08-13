"use client";

import { useMemo, useState } from "react";
import { format, differenceInCalendarDays } from "date-fns";
import { AlertTriangle, CalendarClock, Star } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/app/states";
import { EventTwoLineCard } from "@/components/calendar/event-card";
import { EventDetailDialog } from "@/components/calendar/event-detail-dialog";
import { useAppData } from "@/components/app/app-data";
import { can } from "@/lib/permissions";
import { useCalendarEvents, type CalEvent } from "@/lib/client/events";
import { useFinanceInRange, summarize } from "@/lib/client/finance";
import { conflictIds, zoned } from "@/lib/calendar-utils";
import {
  taipeiDateStartUtcISO,
  taipeiDateEndExclusiveUtcISO,
  twd,
  D,
} from "@/lib/date";
import { CONFLICT_COLOR } from "@/lib/constants";
import { cn } from "@/lib/utils";
import {
  IntervalPicker,
  presetInterval,
  type Interval,
} from "./interval-picker";

function startDayStr(e: CalEvent): string {
  return format(zoned(e.starts_at), "yyyy-MM-dd");
}

function eventMinutes(e: CalEvent): number {
  if (e.all_day) return 0;
  return Math.max(
    0,
    (new Date(e.ends_at).getTime() - new Date(e.starts_at).getTime()) / 60000,
  );
}

export function DigestView() {
  const { calendars, calendarById, visibleIds } = useAppData();
  const [interval, setInterval] = useState<Interval>(() => presetInterval("month"));
  const [detail, setDetail] = useState<CalEvent | null>(null);

  const startIso = taipeiDateStartUtcISO(interval.startDate);
  const endIso = taipeiDateEndExclusiveUtcISO(interval.endDate);
  const spanDays =
    differenceInCalendarDays(
      new Date(`${interval.endDate}T00:00:00Z`),
      new Date(`${interval.startDate}T00:00:00Z`),
    ) + 1;

  const {
    data: events = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useCalendarEvents(startIso, endIso);
  const { data: finance = [] } = useFinanceInRange(
    interval.startDate,
    interval.endDate,
    [...visibleIds],
  );

  const conflicts = useMemo(() => conflictIds(events), [events]);
  const financeSummary = useMemo(() => summarize(finance), [finance]);
  const colorOf = (id: string) => calendarById.get(id)?.color ?? "#64748B";

  // 各分類計數
  const perCalendar = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of events) m.set(e.calendar_id, (m.get(e.calendar_id) ?? 0) + 1);
    return calendars
      .filter((c) => visibleIds.has(c.id) && (m.get(c.id) ?? 0) > 0)
      .map((c) => ({ calendar: c, count: m.get(c.id) ?? 0 }));
  }, [events, calendars, visibleIds]);

  const anyFinanceVisible = calendars.some(
    (c) => visibleIds.has(c.id) && can.viewFinance(c.effectiveRole),
  );

  const jumpToConflict = () => {
    const first = events.find((e) => conflicts.has(e.id));
    if (first) setDetail(first);
  };

  const body = () => {
    if (events.length === 0)
      return (
        <EmptyState
          icon={CalendarClock}
          title="這段期間沒有行程"
          description="換個區間，或到行事曆新增行程。"
        />
      );
    if (spanDays <= 1)
      return (
        <DayTimeline
          date={interval.startDate}
          events={events}
          colorOf={colorOf}
          conflicts={conflicts}
          onSelect={setDetail}
        />
      );
    if (spanDays <= 7)
      return (
        <Agenda
          interval={interval}
          events={events}
          colorOf={colorOf}
          conflicts={conflicts}
          onSelect={setDetail}
        />
      );
    if (spanDays <= 31)
      return (
        <WeekHeatmap
          interval={interval}
          events={events}
          colorOf={colorOf}
          conflicts={conflicts}
          onSelect={setDetail}
        />
      );
    return (
      <MonthlySummary
        events={events}
        finance={finance}
        colorOf={colorOf}
        calendarNameOf={(id) => calendarById.get(id)?.name ?? "分類"}
        onSelect={setDetail}
        financeVisible={anyFinanceVisible}
      />
    );
  };

  return (
    <div>
      <PageHeader
        title="區間總覽"
        description="一個螢幕，看清這段期間所有重要的事。"
      />

      <div className="space-y-4">
        <IntervalPicker value={interval} onChange={setInterval} />

        {/* 摘要列 */}
        <div className="flex flex-wrap items-center gap-2">
          <Pill>
            <span className="font-bold">{events.length}</span> 筆行程
          </Pill>
          {perCalendar.map(({ calendar, count }) => (
            <Pill key={calendar.id}>
              <span
                className="size-2.5 rounded-full"
                style={{ backgroundColor: calendar.color }}
              />
              {calendar.name} <span className="font-semibold">{count}</span>
            </Pill>
          ))}
          {conflicts.size > 0 && (
            <button
              type="button"
              onClick={jumpToConflict}
              className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium text-white"
              style={{ backgroundColor: CONFLICT_COLOR }}
            >
              <AlertTriangle className="size-3.5" />
              {conflicts.size} 筆衝突
            </button>
          )}
          {anyFinanceVisible && finance.length > 0 && (
            <>
              <Pill>支出 <span className="font-semibold">{twd(financeSummary.expense)}</span></Pill>
              {financeSummary.income > 0 && (
                <Pill>收入 <span className="font-semibold">{twd(financeSummary.income)}</span></Pill>
              )}
              {financeSummary.unsettledCount > 0 && (
                <Pill className="text-amber-700">
                  未結清 {financeSummary.unsettledCount} 筆（{twd(financeSummary.unsettledAmount)}）
                </Pill>
              )}
            </>
          )}
        </div>

        {isError ? (
          <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
        ) : isLoading ? (
          <ListSkeleton rows={6} />
        ) : (
          body()
        )}
      </div>

      <EventDetailDialog
        open={!!detail}
        onOpenChange={(o) => !o && setDetail(null)}
        event={detail}
        onEdit={() => setDetail(null)}
        onChanged={() => refetch()}
      />
    </div>
  );
}

function Pill({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-sm",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** 負荷條 */
function LoadBar({ minutes }: { minutes: number }) {
  const level = minutes > 360 ? "滿" : minutes >= 180 ? "中" : minutes > 0 ? "輕" : "空";
  const color =
    minutes > 360 ? "#DC2626" : minutes >= 180 ? "#EA580C" : minutes > 0 ? "#16A34A" : "#CBD5E1";
  const pct = Math.min(100, (minutes / 480) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-[10px] text-muted-foreground">{level}</span>
    </div>
  );
}

// ------- ≤1 天：時間軸 + 空檔 -------
function DayTimeline({
  date,
  events,
  colorOf,
  conflicts,
  onSelect,
}: {
  date: string;
  events: CalEvent[];
  colorOf: (id: string) => string;
  conflicts: Set<string>;
  onSelect: (e: CalEvent) => void;
}) {
  const allDay = events.filter((e) => e.all_day);
  const timed = events
    .filter((e) => !e.all_day)
    .sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at));

  // 空檔（08:00–22:00）
  const items: React.ReactNode[] = [];
  const WINDOW_START = 8 * 60;
  const WINDOW_END = 22 * 60;
  let cursor = WINDOW_START;
  const minOf = (iso: string) => {
    const z = zoned(iso);
    return z.getHours() * 60 + z.getMinutes();
  };

  timed.forEach((e, i) => {
    const s = Math.max(WINDOW_START, minOf(e.starts_at));
    if (s - cursor >= 30 && cursor >= WINDOW_START) {
      const gap = s - cursor;
      items.push(
        <div
          key={`gap-${i}`}
          className="flex items-center gap-2 py-1.5 pl-16 text-xs text-emerald-600"
        >
          <span className="rounded-full bg-emerald-50 px-2 py-0.5">
            空檔 {Math.floor(gap / 60) > 0 ? `${Math.floor(gap / 60)} 小時` : ""}
            {gap % 60 ? `${gap % 60} 分` : ""}
          </span>
        </div>,
      );
    }
    items.push(
      <div key={e.id} className="flex gap-3">
        <div className="w-14 shrink-0 pt-1.5 text-right text-xs font-semibold tabular-nums text-muted-foreground">
          {D.time(e.starts_at)}
        </div>
        <div className="flex-1 pb-1.5">
          <EventTwoLineCard
            event={e}
            color={colorOf(e.calendar_id)}
            conflict={conflicts.has(e.id)}
            onClick={() => onSelect(e)}
          />
        </div>
      </div>,
    );
    cursor = Math.max(cursor, minOf(e.ends_at));
  });

  if (cursor < WINDOW_END && timed.length > 0 && WINDOW_END - cursor >= 30) {
    items.push(
      <div key="gap-end" className="flex items-center gap-2 py-1.5 pl-16 text-xs text-emerald-600">
        <span className="rounded-full bg-emerald-50 px-2 py-0.5">
          之後至 22:00 有空
        </span>
      </div>,
    );
  }

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 text-sm font-semibold">{D.full(dayStartIso(date)).slice(0, 14)}</div>
      {allDay.length > 0 && (
        <div className="mb-3 space-y-1">
          {allDay.map((e) => (
            <EventTwoLineCard
              key={e.id}
              event={e}
              color={colorOf(e.calendar_id)}
              onClick={() => onSelect(e)}
            />
          ))}
        </div>
      )}
      <div className="space-y-0.5">{items}</div>
    </div>
  );
}

// ------- 2–7 天：agenda 直欄 -------
function Agenda({
  interval,
  events,
  colorOf,
  conflicts,
  onSelect,
}: {
  interval: Interval;
  events: CalEvent[];
  colorOf: (id: string) => string;
  conflicts: Set<string>;
  onSelect: (e: CalEvent) => void;
}) {
  const days = enumerateDays(interval);
  const byDay = groupByStartDay(events);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {days.map((ds) => {
        const list = (byDay.get(ds) ?? []).sort(
          (a, b) => +new Date(a.starts_at) - +new Date(b.starts_at),
        );
        const load = list.reduce((s, e) => s + eventMinutes(e), 0);
        return (
          <div key={ds} className="rounded-xl border bg-card p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-semibold">
                {D.monthDay(dayStartIso(ds))}
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  週{"日一二三四五六"[dow(ds)]}
                </span>
              </div>
              <LoadBar minutes={load} />
            </div>
            {list.length === 0 ? (
              <p className="py-2 text-center text-xs text-muted-foreground">無行程</p>
            ) : (
              <div className="space-y-1">
                {list.map((e) => (
                  <EventTwoLineCard
                    key={e.id}
                    event={e}
                    color={colorOf(e.calendar_id)}
                    conflict={conflicts.has(e.id)}
                    onClick={() => onSelect(e)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ------- 8–31 天：週 heatmap + 重點/衝突卡片 -------
function WeekHeatmap({
  interval,
  events,
  colorOf,
  conflicts,
  onSelect,
}: {
  interval: Interval;
  events: CalEvent[];
  colorOf: (id: string) => string;
  conflicts: Set<string>;
  onSelect: (e: CalEvent) => void;
}) {
  const days = enumerateDays(interval);
  const byDay = groupByStartDay(events);
  const maxCount = Math.max(1, ...days.map((d) => (byDay.get(d) ?? []).length));

  // 對齊週：以第一天的星期補齊前置空格
  const firstDow = dow(days[0]);
  const cells: (string | null)[] = [
    ...Array.from({ length: firstDow }, () => null),
    ...days,
  ];

  const highlights = events
    .filter((e) => e.is_important || conflicts.has(e.id))
    .sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at));

  const [showAll, setShowAll] = useState(false);
  const others = events
    .filter((e) => !e.is_important && !conflicts.has(e.id))
    .sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at));

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-4">
        <div className="mb-2 grid grid-cols-7 text-center text-[10px] text-muted-foreground">
          {"日一二三四五六".split("").map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((ds, i) => {
            if (!ds) return <div key={`empty-${i}`} />;
            const count = (byDay.get(ds) ?? []).length;
            const intensity = count / maxCount;
            const hasConflict = (byDay.get(ds) ?? []).some((e) => conflicts.has(e.id));
            return (
              <div
                key={ds}
                title={`${D.monthDay(dayStartIso(ds))}：${count} 筆`}
                className="flex aspect-square flex-col items-center justify-center rounded-md border text-[11px]"
                style={{
                  backgroundColor:
                    count === 0
                      ? undefined
                      : `rgba(37, 99, 235, ${0.15 + intensity * 0.6})`,
                  color: intensity > 0.5 ? "white" : undefined,
                  borderColor: hasConflict ? CONFLICT_COLOR : undefined,
                }}
              >
                <span className="font-medium">{ds.slice(8)}</span>
                {count > 0 && <span className="text-[10px] opacity-90">{count}</span>}
              </div>
            );
          })}
        </div>
        <div className="mt-2 text-center text-[10px] text-muted-foreground">
          顏色越深＝當日行程越多；紅框＝該日有時間衝突
        </div>
      </div>

      {highlights.length > 0 && (
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <Star className="size-4 text-amber-500" />
            重點與衝突行程（{highlights.length}）
          </h3>
          <div className="space-y-1.5">
            {highlights.map((e) => (
              <div key={e.id} className="flex items-center gap-2">
                <span className="w-14 shrink-0 text-right text-xs text-muted-foreground">
                  {D.dateShort(e.starts_at)}
                </span>
                <div className="flex-1">
                  <EventTwoLineCard
                    event={e}
                    color={colorOf(e.calendar_id)}
                    conflict={conflicts.has(e.id)}
                    emphasize
                    onClick={() => onSelect(e)}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {others.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowAll((s) => !s)}
            className="text-sm font-medium text-primary hover:underline"
          >
            {showAll ? "收合其餘行程" : `展開其餘 ${others.length} 筆行程`}
          </button>
          {showAll && (
            <div className="mt-2 space-y-1.5">
              {others.map((e) => (
                <div key={e.id} className="flex items-center gap-2">
                  <span className="w-14 shrink-0 text-right text-xs text-muted-foreground">
                    {D.dateShort(e.starts_at)}
                  </span>
                  <div className="flex-1">
                    <EventTwoLineCard
                      event={e}
                      color={colorOf(e.calendar_id)}
                      conflict={conflicts.has(e.id)}
                      onClick={() => onSelect(e)}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ------- >31 天：逐月摘要卡 -------
function MonthlySummary({
  events,
  finance,
  colorOf,
  calendarNameOf,
  onSelect,
  financeVisible,
}: {
  events: CalEvent[];
  finance: { occurred_on: string; direction: "expense" | "income"; amount: number }[];
  colorOf: (id: string) => string;
  calendarNameOf: (id: string) => string;
  onSelect: (e: CalEvent) => void;
  financeVisible: boolean;
}) {
  const months = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    for (const e of events) {
      const key = format(zoned(e.starts_at), "yyyy-MM");
      const arr = map.get(key);
      if (arr) arr.push(e);
      else map.set(key, [e]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [events]);

  const financeByMonth = useMemo(() => {
    const m = new Map<string, { expense: number; income: number }>();
    for (const f of finance) {
      const key = f.occurred_on.slice(0, 7);
      const cur = m.get(key) ?? { expense: 0, income: 0 };
      if (f.direction === "expense") cur.expense += f.amount;
      else cur.income += f.amount;
      m.set(key, cur);
    }
    return m;
  }, [finance]);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {months.map(([key, list]) => {
        const perCal = new Map<string, number>();
        for (const e of list) perCal.set(e.calendar_id, (perCal.get(e.calendar_id) ?? 0) + 1);
        const important = list
          .filter((e) => e.is_important)
          .sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at));
        const fin = financeByMonth.get(key);
        return (
          <div key={key} className="rounded-xl border bg-card p-4">
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="text-base font-bold">{key.replace("-", "年")}月</h3>
              <span className="text-sm text-muted-foreground">{list.length} 筆</span>
            </div>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {[...perCal.entries()].map(([cid, count]) => (
                <span
                  key={cid}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
                >
                  <span className="size-2 rounded-full" style={{ backgroundColor: colorOf(cid) }} />
                  {calendarNameOf(cid)} {count}
                </span>
              ))}
            </div>
            {financeVisible && fin && (fin.expense > 0 || fin.income > 0) && (
              <div className="mb-3 text-sm">
                {fin.expense > 0 && <span className="mr-3">支出 {twd(fin.expense)}</span>}
                {fin.income > 0 && <span>收入 {twd(fin.income)}</span>}
              </div>
            )}
            {important.length > 0 && (
              <div>
                <div className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
                  <Star className="size-3 text-amber-500" />
                  重點
                </div>
                <div className="space-y-1">
                  {important.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => onSelect(e)}
                      className="block w-full truncate rounded px-1 text-left text-sm hover:bg-accent"
                    >
                      <span className="tabular-nums text-muted-foreground">
                        {D.dateShort(e.starts_at)}
                      </span>{" "}
                      {e.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ------- 共用 -------
function enumerateDays(interval: Interval): string[] {
  const out: string[] = [];
  const cur = new Date(`${interval.startDate}T12:00:00Z`);
  const end = new Date(`${interval.endDate}T12:00:00Z`);
  for (let i = 0; i < 400 && cur <= end; i++) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

function groupByStartDay(events: CalEvent[]): Map<string, CalEvent[]> {
  const m = new Map<string, CalEvent[]>();
  for (const e of events) {
    const ds = startDayStr(e);
    const arr = m.get(ds);
    if (arr) arr.push(e);
    else m.set(ds, [e]);
  }
  return m;
}

/** 台北曆日字串 → 該日 00:00 的 UTC ISO（供正確格式化顯示） */
function dayStartIso(ds: string): string {
  return taipeiDateStartUtcISO(ds);
}

/** 台北曆日字串 → 星期（0=日..6=六），以正午 UTC 錨定避免時區偏移 */
function dow(ds: string): number {
  return new Date(`${ds}T12:00:00Z`).getUTCDay();
}
