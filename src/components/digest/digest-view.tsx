"use client";

import { useEffect, useMemo, useState } from "react";
import { format, differenceInCalendarDays } from "date-fns";
import { AlertTriangle, CalendarClock, Star, Plus } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/app/states";
import { EventTwoLineCard } from "@/components/calendar/event-card";
import { EventDetailDialog } from "@/components/calendar/event-detail-dialog";
import { EventModal } from "@/components/calendar/event-modal";
import { useAppData } from "@/components/app/app-data";
import { can } from "@/lib/permissions";
import { useCalendarEvents, type CalEvent } from "@/lib/client/events";
import { useFinanceInRange, summarize } from "@/lib/client/finance";
import { conflictIds, zoned } from "@/lib/calendar-utils";
import {
  taipeiDateStartUtcISO,
  taipeiDateEndExclusiveUtcISO,
  taipeiTodayStr,
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
import { AvailabilityControls, AvailabilitySummary } from "./availability";
import { IntervalGrid } from "./interval-grid";
import {
  windowFromKey,
  minutesFromGapKey,
  intervalAvailability,
  freeOnDay,
  roughHours,
  WINDOW_PRESETS,
  MIN_GAP_PRESETS,
  type WorkWindow,
  type WindowKey,
  type MinGapKey,
} from "@/lib/availability";

function startDayStr(e: CalEvent): string {
  return format(zoned(e.starts_at), "yyyy-MM-dd");
}

export function DigestView() {
  const { calendars, calendarById, visibleIds } = useAppData();
  const canCreate = calendars.some((c) => can.editEvents(c.effectiveRole));
  const [interval, setInterval] = useState<Interval>(() => presetInterval("week"));
  const [detail, setDetail] = useState<CalEvent | null>(null);
  const [editing, setEditing] = useState<CalEvent | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createStart, setCreateStart] = useState<string | undefined>(undefined);

  // 找空檔設定（時間帶 + 最小空檔），永遠顯示、不需開關
  const [windowKey, setWindowKey] = useState<WindowKey>("full");
  const [minGapKey, setMinGapKey] = useState<MinGapKey>("60");
  const w = useMemo(() => windowFromKey(windowKey), [windowKey]);
  const minGap = minutesFromGapKey(minGapKey);
  const focusDay = (ds: string) => setInterval({ startDate: ds, endDate: ds });
  const todayStr = taipeiTodayStr();

  const openCreate = (dateStr: string, hour = 9) => {
    if (!canCreate) return;
    setCreateStart(`${dateStr}T${String(hour).padStart(2, "0")}:00`);
    setCreateOpen(true);
  };

  // 記住上次設定；以 effect 讀取避免 SSR 水合不一致
  useEffect(() => {
    try {
      const wk = localStorage.getItem("execcal:find-window");
      const gk = localStorage.getItem("execcal:find-gap");
      /* eslint-disable react-hooks/set-state-in-effect -- 掛載時自 localStorage 同步一次 */
      if (wk && WINDOW_PRESETS.some((p) => p.key === wk)) setWindowKey(wk as WindowKey);
      if (gk && MIN_GAP_PRESETS.some((p) => p.key === gk)) setMinGapKey(gk as MinGapKey);
      /* eslint-enable react-hooks/set-state-in-effect */
    } catch {
      /* localStorage 不可用時忽略 */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("execcal:find-window", windowKey);
      localStorage.setItem("execcal:find-gap", minGapKey);
    } catch {
      /* 忽略 */
    }
  }, [windowKey, minGapKey]);

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

  const days = useMemo(() => enumerateDays(interval), [interval]);
  const avail = useMemo(
    () => intervalAvailability(days, () => events, w, minGap),
    [days, events, w, minGap],
  );

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
    if (spanDays <= 7)
      return (
        <IntervalGrid
          days={days}
          events={events}
          w={w}
          colorOf={colorOf}
          conflicts={conflicts}
          minGap={minGap}
          onSelect={setDetail}
          onCreateAt={canCreate ? openCreate : undefined}
          todayStr={todayStr}
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
        days={days}
        w={w}
        minGap={minGap}
      />
    );
  };

  return (
    <div>
      <PageHeader
        title="區間總覽"
        description="一個螢幕，看清這段期間所有重要的事與空檔。"
        actions={
          canCreate ? (
            <Button onClick={() => openCreate(todayStr)}>
              <Plus className="size-4" />
              新增行程
            </Button>
          ) : undefined
        }
      />

      <div className="space-y-4">
        <IntervalPicker value={interval} onChange={setInterval} />

        <AvailabilityControls
          windowKey={windowKey}
          onWindowKeyChange={setWindowKey}
          minGapKey={minGapKey}
          onMinGapKeyChange={setMinGapKey}
        />

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

        {spanDays > 1 && events.length > 0 && (
          <AvailabilitySummary
            totalFreeMin={avail.totalFreeMin}
            freeDayCount={avail.freeDayCount}
            blocks={avail.blocks}
            dayCount={days.length}
            onFocusDay={focusDay}
          />
        )}

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
        onEdit={() => {
          setEditing(detail);
          setDetail(null);
        }}
        onChanged={() => refetch()}
      />

      {/* 新增 */}
      <EventModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        defaultStartWall={createStart}
        onSaved={() => refetch()}
      />

      {/* 編輯 */}
      <EventModal
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        mode="edit"
        event={editing ?? undefined}
        onSaved={() => refetch()}
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
          {"日一二三四五六".split("").map((wd) => (
            <div key={wd}>{wd}</div>
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
  days,
  w,
  minGap,
}: {
  events: CalEvent[];
  finance: { occurred_on: string; direction: "expense" | "income"; amount: number }[];
  colorOf: (id: string) => string;
  calendarNameOf: (id: string) => string;
  onSelect: (e: CalEvent) => void;
  financeVisible: boolean;
  days: string[];
  w: WorkWindow;
  minGap: number;
}) {
  const freeByMonth = useMemo(() => {
    const m = new Map<string, number>();
    for (const ds of days) {
      const free = freeOnDay(events, ds, w, minGap);
      const total = free.reduce((s, f) => s + (f.end - f.start), 0);
      if (total > 0) m.set(ds.slice(0, 7), (m.get(ds.slice(0, 7)) ?? 0) + total);
    }
    return m;
  }, [days, events, w, minGap]);

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
            {(freeByMonth.get(key) ?? 0) > 0 && (
              <div className="mb-3 inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                可用空檔 約 {roughHours(freeByMonth.get(key) ?? 0)} 小時
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
