"use client";

import { Clock, Search, Sun, ArrowRight, CalendarClock } from "lucide-react";
import type { CalEvent } from "@/lib/client/events";
import { D, taipeiDateStartUtcISO, taipeiTodayStr } from "@/lib/date";
import { cn } from "@/lib/utils";
import { IntervalGrid } from "./interval-grid";
import {
  freeOnDay,
  eventSegmentOnDay,
  allDayOnDay,
  intervalAvailability,
  enumerateDays,
  windowFromKey,
  minutesFromGapKey,
  minToHHMM,
  humanMinutes,
  roughHours,
  WINDOW_PRESETS,
  MIN_GAP_PRESETS,
  type WorkWindow,
  type WindowKey,
  type MinGapKey,
  type Segment,
  type FreeBlock,
} from "@/lib/availability";

const dayStartIso = (ds: string) => taipeiDateStartUtcISO(ds);
const dowChar = (ds: string) =>
  "日一二三四五六"[new Date(`${ds}T12:00:00Z`).getUTCDay()];

/* ------------------------------------------------------------------ */
/* 控制列：找空檔開關 + 工作時段 + 最小空檔                              */
/* ------------------------------------------------------------------ */

export function AvailabilityControls({
  windowKey,
  onWindowKeyChange,
  minGapKey,
  onMinGapKeyChange,
}: {
  windowKey: WindowKey;
  onWindowKeyChange: (k: WindowKey) => void;
  minGapKey: MinGapKey;
  onMinGapKeyChange: (k: MinGapKey) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-card p-3">
      <span className="inline-flex items-center gap-1.5 text-sm font-medium">
        <Search className="size-4 text-emerald-600" />
        找空檔
      </span>
      <Segmented
        icon={<Sun className="size-3.5" />}
        label="時間帶"
        options={WINDOW_PRESETS.map((w) => ({ key: w.key, label: w.label }))}
        value={windowKey}
        onChange={(k) => onWindowKeyChange(k as WindowKey)}
      />
      <Segmented
        icon={<Clock className="size-3.5" />}
        label="空檔"
        options={MIN_GAP_PRESETS.map((g) => ({ key: g.key, label: g.label }))}
        value={minGapKey}
        onChange={(k) => onMinGapKeyChange(k as MinGapKey)}
      />
    </div>
  );
}

export function Segmented({
  icon,
  label,
  options,
  value,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  options: { key: string; label: string }[];
  value: string;
  onChange: (k: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        {icon}
        {label}
      </span>
      <div className="inline-flex overflow-hidden rounded-lg border">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            className={cn(
              "px-2.5 py-1 text-xs transition",
              value === o.key
                ? "bg-primary text-primary-foreground"
                : "bg-background hover:bg-accent",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 每日負荷／空檔橫條（放大鏡）                                          */
/* ------------------------------------------------------------------ */

const pct = (min: number, w: WorkWindow) =>
  ((min - w.start) / Math.max(1, w.end - w.start)) * 100;

/**
 * 一條代表工作時段的橫條：
 *  - 灰底＝時段內未達門檻的零碎縫隙
 *  - 綠色＝可用空檔（達門檻），hover 顯示時間與長度
 *  - 彩色＝已排行程（分類色），可點開明細
 */
export function DayLoadBar({
  events,
  dayStr,
  w,
  minGap,
  colorOf,
  onSelect,
  conflicts,
}: {
  events: CalEvent[];
  dayStr: string;
  w: WorkWindow;
  minGap: number;
  colorOf: (id: string) => string;
  onSelect?: (e: CalEvent) => void;
  conflicts?: Set<string>;
}) {
  const free = freeOnDay(events, dayStr, w, minGap);
  const eventSegs = events
    .map((e) => {
      const seg = eventSegmentOnDay(e, dayStr);
      if (!seg) return null;
      const start = Math.max(seg.start, w.start);
      const end = Math.min(seg.end, w.end);
      if (end <= start) return null;
      return { e, seg: { start, end } as Segment };
    })
    .filter((x): x is { e: CalEvent; seg: Segment } => x !== null);

  return (
    <div>
      <div className="relative h-6 w-full overflow-hidden rounded-md bg-slate-100">
        {free.map((f, i) => (
          <div
            key={`f-${i}`}
            title={`空檔 ${minToHHMM(f.start)}–${minToHHMM(f.end)}・${humanMinutes(
              f.end - f.start,
            )}`}
            className="absolute inset-y-0 bg-emerald-300/70"
            style={{
              left: `${pct(f.start, w)}%`,
              width: `${pct(f.end, w) - pct(f.start, w)}%`,
            }}
          />
        ))}
        {eventSegs.map(({ e, seg }, i) => (
          <button
            key={`${e.id}-${i}`}
            type="button"
            onClick={onSelect ? () => onSelect(e) : undefined}
            title={`${D.time(e.starts_at)}–${D.time(e.ends_at)} ${e.title}${
              conflicts?.has(e.id) ? "（衝突）" : ""
            }`}
            className={cn(
              "absolute inset-y-0 border-r border-white/60",
              conflicts?.has(e.id) &&
                "z-10 ring-2 ring-inset ring-red-600",
            )}
            style={{
              left: `${pct(seg.start, w)}%`,
              width: `${Math.max(1, pct(seg.end, w) - pct(seg.start, w))}%`,
              backgroundColor: colorOf(e.calendar_id),
            }}
          />
        ))}
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] tabular-nums text-muted-foreground">
        <span>{minToHHMM(w.start)}</span>
        <span>{minToHHMM(w.end)}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 空檔膠囊列                                                           */
/* ------------------------------------------------------------------ */

export function FreeSlotChips({
  slots,
  emptyHint = "整段已排滿",
}: {
  slots: Segment[];
  emptyHint?: string;
}) {
  if (slots.length === 0)
    return <p className="text-xs text-muted-foreground">{emptyHint}</p>;
  return (
    <div className="flex flex-wrap gap-1">
      {slots.map((s, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 tabular-nums"
        >
          {minToHHMM(s.start)}–{minToHHMM(s.end)}
          <span className="text-emerald-500">·{humanMinutes(s.end - s.start)}</span>
        </span>
      ))}
    </div>
  );
}

/** 全天行程提示：這些事件不佔時段，但代表當天並非真正空閒 */
export function AllDayBadges({
  events,
  dayStr,
}: {
  events: CalEvent[];
  dayStr: string;
}) {
  const list = allDayOnDay(events, dayStr);
  if (list.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {list.map((e) => (
        <span
          key={e.id}
          className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700"
        >
          <Sun className="size-3" />
          全天 · {e.title}
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 區間空檔總覽                                                         */
/* ------------------------------------------------------------------ */

export function AvailabilitySummary({
  totalFreeMin,
  freeDayCount,
  blocks,
  dayCount,
  onFocusDay,
}: {
  totalFreeMin: number;
  freeDayCount: number;
  blocks: FreeBlock[];
  dayCount: number;
  onFocusDay: (dayStr: string) => void;
}) {
  const top = blocks.slice(0, 6);
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <div className="flex items-baseline gap-1.5">
          <CalendarClock className="size-4 self-center text-emerald-600" />
          <span className="text-sm text-emerald-800">這段期間可用空檔約</span>
          <span className="text-2xl font-bold text-emerald-700">
            {roughHours(totalFreeMin)}
          </span>
          <span className="text-sm text-emerald-800">小時</span>
        </div>
        <span className="text-sm text-emerald-800/80">
          {dayCount} 天中有 <span className="font-semibold">{freeDayCount}</span> 天有空
        </span>
      </div>

      {top.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 text-xs font-medium text-emerald-800/70">
            最長的可用空檔（點擊放大該日）
          </div>
          <div className="flex flex-wrap gap-1.5">
            {top.map((b, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onFocusDay(b.dayStr)}
                className="group inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-2.5 py-1.5 text-left text-xs transition hover:border-emerald-400 hover:bg-emerald-50"
              >
                <span className="font-semibold text-foreground">
                  {D.monthDay(dayStartIso(b.dayStr))}
                  <span className="ml-0.5 font-normal text-muted-foreground">
                    週{dowChar(b.dayStr)}
                  </span>
                </span>
                <span className="tabular-nums text-emerald-700">
                  {minToHHMM(b.start)}–{minToHHMM(b.end)}
                </span>
                <span className="rounded bg-emerald-100 px-1 font-semibold text-emerald-700">
                  {humanMinutes(b.minutes)}
                </span>
                <ArrowRight className="size-3 text-emerald-400 transition group-hover:translate-x-0.5" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 區間空檔面板（可嵌入搜尋頁：輸入日期區間即看到詳細空檔）              */
/* ------------------------------------------------------------------ */

export function IntervalAvailabilityPanel({
  startDate,
  endDate,
  events,
  conflicts,
  colorOf,
  onSelect,
  windowKey,
  onWindowKeyChange,
  minGapKey,
  onMinGapKeyChange,
  onFocusDay,
  onCreateAt,
}: {
  startDate: string;
  endDate: string;
  events: CalEvent[];
  conflicts: Set<string>;
  colorOf: (id: string) => string;
  onSelect: (e: CalEvent) => void;
  windowKey: WindowKey;
  onWindowKeyChange: (k: WindowKey) => void;
  minGapKey: MinGapKey;
  onMinGapKeyChange: (k: MinGapKey) => void;
  onFocusDay: (dayStr: string) => void;
  onCreateAt?: (dateStr: string, hour: number) => void;
}) {
  const w = windowFromKey(windowKey);
  const minGap = minutesFromGapKey(minGapKey);
  const days = enumerateDays(startDate, endDate);
  const avail = intervalAvailability(days, () => events, w, minGap);
  const showDays = days.length <= 31;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Segmented
          icon={<Sun className="size-3.5" />}
          label="時段"
          options={WINDOW_PRESETS.map((p) => ({ key: p.key, label: p.label }))}
          value={windowKey}
          onChange={(k) => onWindowKeyChange(k as WindowKey)}
        />
        <Segmented
          icon={<Clock className="size-3.5" />}
          label="空檔"
          options={MIN_GAP_PRESETS.map((g) => ({ key: g.key, label: g.label }))}
          value={minGapKey}
          onChange={(k) => onMinGapKeyChange(k as MinGapKey)}
        />
      </div>

      <AvailabilitySummary
        totalFreeMin={avail.totalFreeMin}
        freeDayCount={avail.freeDayCount}
        blocks={avail.blocks}
        dayCount={days.length}
        onFocusDay={onFocusDay}
      />

      {days.length <= 7 ? (
        <IntervalGrid
          days={days}
          events={events}
          w={w}
          colorOf={colorOf}
          conflicts={conflicts}
          minGap={minGap}
          onSelect={onSelect}
          onCreateAt={onCreateAt}
          todayStr={taipeiTodayStr()}
        />
      ) : showDays ? (
        <div className="space-y-2">
          {days.map((ds) => {
            const free = freeOnDay(events, ds, w, minGap);
            const freeMin = free.reduce((s, f) => s + (f.end - f.start), 0);
            return (
              <div key={ds} className="rounded-xl border bg-card p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold">
                    {D.monthDay(dayStartIso(ds))}
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                      週{dowChar(ds)}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    空檔 {freeMin > 0 ? humanMinutes(freeMin) : "—"}
                  </span>
                </div>
                <DayLoadBar
                  events={events}
                  dayStr={ds}
                  w={w}
                  minGap={minGap}
                  colorOf={colorOf}
                  onSelect={onSelect}
                  conflicts={conflicts}
                />
                <div className="mt-2 space-y-1.5">
                  <AllDayBadges events={events} dayStr={ds} />
                  <FreeSlotChips slots={free} emptyHint="這天已排滿" />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-center text-xs text-muted-foreground">
          期間超過 31 天，僅顯示上方彙總與最長空檔清單；縮小日期區間可看逐日空檔。
        </p>
      )}
    </div>
  );
}
