"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Plus, Printer, Star } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { ErrorState, ListSkeleton } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { EventDetailDialog } from "@/components/calendar/event-detail-dialog";
import { EventModal } from "@/components/calendar/event-modal";
import { eventStyle, stripLeadingTime } from "@/components/calendar/event-visuals";
import { useAppData } from "@/components/app/app-data";
import { useCalendarEvents, type CalEvent } from "@/lib/client/events";
import { layoutDay } from "@/lib/calendar-utils";
import { eventSegmentOnDay } from "@/lib/availability";
import { taipeiDateStartUtcISO, taipeiNowWall, taipeiTodayStr, utcToTaipeiWall } from "@/lib/date";
import { can } from "@/lib/permissions";
import { stripSubjectSuffix } from "@/lib/subject-title";
import { cn } from "@/lib/utils";

const WD = "日一二三四五六";

/** 快捷範圍：都從「起始日」（預設今天）往後算 */
const RANGES = [
  { days: 7, label: "1 週" },
  { days: 14, label: "2 週" },
  { days: 30, label: "1 個月" },
  { days: 182, label: "半年" },
] as const;

/** 左側時段帶（仿 Peggy 手做的週表）；只當底色分區，行程位置一律依實際時刻 */
const PERIODS = [
  { label: "上午", from: 0, to: 12 },
  { label: "中午", from: 12, to: 13 },
  { label: "下午", from: 13, to: 17 },
  { label: "晚上", from: 17, to: 24 },
];

/** 每小時高度（px）：一小時塞得下兩行字 */
const PX_PER_HOUR = 40;
/** 色塊每行字高（12px 字、行高 1.25） */
const LINE_PX = 15;
/** 預設顯示 8:00–21:00，有更早／更晚的行程再自動撐開 */
const DEFAULT_FROM = 8;
const DEFAULT_TO = 21;

/** 「看誰的」只列這四位（人物設定裡的名字）；第一位是本人，沒指定這四位當主角的行程都算她的 */
const PEOPLE = ["Peggy姐", "豪哥", "哥哥", "妹妹"];
const SELF_KEY = PEOPLE[0];
const PEOPLE_SET = new Set(PEOPLE);
const HIDDEN_KEY = "week-sheet.hidden-people";

/**
 * 表上的極簡名稱（仿 Peggy 手做週表）：
 * 去開頭時間、去「-主角名」後綴、去括號（地點／補充），非 Peggy姐 的行程前面加「(豪)」「(哥妹)」。
 * 例：「0730-0900羽球(延吉街)-豪哥」→「(豪)羽球」。只影響這張表的顯示。
 */
function shortTitle(e: CalEvent): string {
  let t = stripLeadingTime(e.title.trim());
  t = stripSubjectSuffix(t, [...PEOPLE, ...e.subjectNames]);
  t = stripLeadingTime(t.replace(/[（(][^（()）]*[)）]/g, "").trim()).replace(/[\s\-–、,，]+$/, "").trim() || stripLeadingTime(e.title.trim());
  const tag = e.subjectNames
    .filter((n) => PEOPLE_SET.has(n) && n !== SELF_KEY)
    .map((n) => n[0])
    .join("");
  return tag && !t.startsWith(`(${tag})`) ? `(${tag})${t}` : t;
}

const DAY_MS = 24 * 3600 * 1000;

/**
 * 畫成上方「連續長條」的行程：整天行程，或長達 24 小時以上（例：出國 11/14–11/19）。
 * 像 Google 日曆一樣跨天連成一條，不在時間軸每天塞滿一欄（Peggy 11/12）。
 */
function isBanner(e: CalEvent): boolean {
  return e.all_day || +new Date(e.ends_at) - +new Date(e.starts_at) >= DAY_MS;
}

/** 行程最後一天（台北曆日）；結束剛好在午夜的算前一天 */
function lastDayOf(e: CalEvent): string {
  return utcToTaipeiWall(new Date(+new Date(e.ends_at) - 1)).slice(0, 10);
}

/** 長條在這一段（7 欄）裡的位置，並排成不重疊的列 */
function layoutBanners(events: CalEvent[], days: string[]) {
  const items = events
    .filter(isBanner)
    .map((e) => {
      const first = utcToTaipeiWall(e.starts_at).slice(0, 10);
      const last = lastDayOf(e);
      const from = days.findIndex((d) => d >= first);
      const toIdx = days.findLastIndex((d) => d <= last);
      return { e, first, last, from, to: toIdx };
    })
    .filter((b) => b.from !== -1 && b.to !== -1 && b.from <= b.to)
    .sort((a, b) => a.from - b.from || b.to - b.from - (a.to - a.from));
  const laneEnds: number[] = [];
  return items.map((b) => {
    let lane = laneEnds.findIndex((end) => end < b.from);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = b.to;
    return { ...b, lane };
  });
}

function addDaysStr(ds: string, n: number): string {
  return new Date(Date.parse(`${ds}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}
function md(ds: string): string {
  return `${Number(ds.slice(5, 7))}/${Number(ds.slice(8, 10))}`;
}
function dow(ds: string): string {
  return WD[new Date(`${ds}T12:00:00Z`).getUTCDay()];
}
/** 分鐘 → 精簡時刻：450→「7:30」、1020→「17」 */
function hm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}:${String(m).padStart(2, "0")}` : `${h}`;
}

function WeekSheetInner() {
  const params = useSearchParams();
  const today = taipeiTodayStr();
  const [start, setStart] = useState(() => params.get("start") ?? today);
  const [span, setSpan] = useState<number>(() => {
    const d = Number(params.get("days"));
    return RANGES.some((r) => r.days === d) ? d : 7;
  });
  const { calendars, calendarById } = useAppData();
  const [detail, setDetail] = useState<CalEvent | null>(null);
  const [editing, setEditing] = useState<CalEvent | null>(null);
  // 點空白處新增：帶入點到的日期與時刻（每半小時一格）
  const canCreate = calendars.some((c) => can.editEvents(c.effectiveRole));
  const [createStart, setCreateStart] = useState<string | null>(null);
  const openCreate = (ds: string, min = 9 * 60) =>
    setCreateStart(`${ds}T${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`);

  // 主角多選：記「隱藏了誰」，之後新增的家人預設會出現
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HIDDEN_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 掛載時自 localStorage 同步一次（避免 SSR 不一致）
      if (raw) setHidden(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* 無痕模式等讀不到就全部顯示 */
    }
  }, []);
  const toggle = (key: string) => {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setHidden(next);
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]));
    } catch {
      /* 存不了只影響下次預設 */
    }
  };

  const days = Array.from({ length: span }, (_, i) => addDaysStr(start, i));
  const startIso = taipeiDateStartUtcISO(start);
  const endIso = taipeiDateStartUtcISO(addDaysStr(start, span));
  const { data: events = [], isLoading, isError, error, refetch } = useCalendarEvents(startIso, endIso);

  /** 這筆行程屬於誰：主角裡的這四位；都沒有就算本人 */
  const visible = useMemo(() => {
    if (hidden.size === 0) return events;
    return events.filter((e) => {
      const owners = e.subjectNames.filter((n) => PEOPLE_SET.has(n));
      return (owners.length ? owners : [SELF_KEY]).some((k) => !hidden.has(k));
    });
  }, [events, hidden]);

  // 時間範圍：整段期間共用，週與週之間上下對齊好比較
  const [fromH, toH] = useMemo(() => {
    let lo = DEFAULT_FROM * 60;
    let hi = DEFAULT_TO * 60;
    for (const ds of days) {
      for (const e of visible) {
        if (isBanner(e)) continue;
        const seg = eventSegmentOnDay(e, ds);
        if (!seg) continue;
        lo = Math.min(lo, seg.start);
        hi = Math.max(hi, seg.end);
      }
    }
    return [Math.floor(lo / 60), Math.ceil(hi / 60)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, start, span]);

  const weeks = Array.from({ length: Math.ceil(span / 7) }, (_, w) => days.slice(w * 7, w * 7 + 7));

  // 左右滑換週（Peggy 11/12：不想一直按箭頭）。表格自己還能橫向捲動時先捲，捲到邊才換週
  const swipe = useRef<{ x: number; y: number; el: HTMLElement | null; left: number } | null>(null);
  const onTouchStart = (ev: React.TouchEvent) => {
    const t = ev.touches[0];
    const el = (ev.target as HTMLElement).closest<HTMLElement>("[data-hscroll]");
    swipe.current = { x: t.clientX, y: t.clientY, el, left: el?.scrollLeft ?? 0 };
  };
  const onTouchEnd = (ev: React.TouchEvent) => {
    const s0 = swipe.current;
    swipe.current = null;
    if (!s0) return;
    const t = ev.changedTouches[0];
    const dx = t.clientX - s0.x;
    const dy = t.clientY - s0.y;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const el = s0.el;
    if (el && el.scrollWidth > el.clientWidth + 1) {
      // 開始滑的時候還沒捲到那一邊的盡頭 → 這次是在捲表格
      const atLeft = s0.left <= 1;
      const atRight = s0.left >= el.scrollWidth - el.clientWidth - 1;
      if ((dx > 0 && !atLeft) || (dx < 0 && !atRight)) return;
    }
    setStart(addDaysStr(start, dx < 0 ? span : -span));
  };

  return (
    <div className="mx-auto max-w-[1600px]">
      <div className="print:hidden">
        <PageHeader
          title="週行程表"
          description="每小時對齊，一眼看出幾點到幾點有事；可列印或存 PDF"
          actions={
            <div className="flex gap-2">
              {canCreate && (
                <Button onClick={() => openCreate(today)}>
                  <Plus className="size-4" />
                  新增行程
                </Button>
              )}
              <Button variant="outline" onClick={() => window.print()}>
                <Printer className="size-4" />
                列印／存 PDF
              </Button>
            </div>
          }
        />
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setStart(addDaysStr(start, -span))} aria-label="往前">
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" onClick={() => setStart(today)} disabled={start === today}>
            今天
          </Button>
          <Button variant="outline" size="icon" onClick={() => setStart(addDaysStr(start, span))} aria-label="往後">
            <ChevronRight className="size-4" />
          </Button>
          <div className="flex rounded-md border p-0.5">
            {RANGES.map((r) => (
              <button
                key={r.days}
                type="button"
                onClick={() => setSpan(r.days)}
                className={cn(
                  "rounded px-2.5 py-1 text-sm",
                  span === r.days ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-1.5 text-sm">
          <span className="text-muted-foreground">看誰的：</span>
          {PEOPLE.map((name) => {
            const on = !hidden.has(name);
            return (
              <button
                key={name}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(name)}
                className={cn(
                  "rounded-full border px-3 py-0.5",
                  on ? "border-primary bg-primary/10 font-medium text-primary" : "text-muted-foreground line-through",
                )}
              >
                {name}
              </button>
            );
          })}
        </div>
      </div>

      {isError ? (
        <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
      ) : isLoading ? (
        <ListSkeleton rows={6} />
      ) : (
        <div id="print-area" className="space-y-5" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          {weeks.map((wk) => (
            <WeekBlock
              key={wk[0]}
              days={wk}
              events={visible}
              fromH={fromH}
              toH={toH}
              today={today}
              colorOf={(id) => calendarById.get(id)?.color ?? "#64748B"}
              onSelect={setDetail}
              onCreateAt={canCreate ? openCreate : undefined}
            />
          ))}
          <p className="text-xs text-muted-foreground print:hidden">
            左右滑可換週。色塊的上下位置＝實際時間；只列左側選單勾選的分類。點行程可看詳情或修改{canCreate && "；點空白處可在那個時間新增行程"}。
          </p>
        </div>
      )}

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
      <EventModal
        open={!!createStart}
        onOpenChange={(o) => !o && setCreateStart(null)}
        mode="create"
        defaultStartWall={createStart ?? undefined}
        onSaved={() => refetch()}
      />
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

/** 一段（最多 7 天）：左邊時段＋每小時刻度，每天一欄，行程依起訖時刻定位 */
function WeekBlock({
  days,
  events,
  fromH,
  toH,
  today,
  colorOf,
  onSelect,
  onCreateAt,
}: {
  days: string[];
  events: CalEvent[];
  fromH: number;
  toH: number;
  today: string;
  colorOf: (id: string) => string;
  onSelect: (e: CalEvent) => void;
  /** 點空白處新增（ds 台北曆日、min 當天第幾分鐘）；沒權限不傳 */
  onCreateAt?: (ds: string, min: number) => void;
}) {
  const hours = toH - fromH;
  const height = hours * PX_PER_HOUR;
  // 不足 7 天的最後一段也維持 7 欄寬，欄寬才和上面對齊
  const cols = `4rem repeat(7, minmax(0, 1fr))`;
  const banners = layoutBanners(events, days);
  const lanes = banners.reduce((m, b) => Math.max(m, b.lane + 1), 0);
  const timed = events.filter((e) => !isBanner(e));
  const nowWall = taipeiNowWall();
  const nowMin = Number(nowWall.slice(11, 13)) * 60 + Number(nowWall.slice(14, 16));

  return (
    <section className="print:break-inside-avoid">
      <h2 className="mb-1 text-base font-bold">
        {md(days[0])}（{dow(days[0])}）– {md(days[days.length - 1])}（{dow(days[days.length - 1])}）
      </h2>
      <div data-hscroll className="overflow-x-auto rounded-lg border bg-card print:overflow-visible">
        <div className="min-w-[760px] print:min-w-0">
          {/* 表頭 */}
          <div className="grid border-b bg-muted/40" style={{ gridTemplateColumns: cols }}>
            <div className="border-r" />
            {days.map((ds) => (
              <div
                key={ds}
                className={cn("border-r py-1.5 text-center text-sm last:border-r-0", ds === today && "bg-primary/15")}
              >
                <span className="font-semibold">週{dow(ds)}</span>{" "}
                <span className="text-muted-foreground">{md(ds)}</span>
              </div>
            ))}
          </div>

          {/* 整天與跨天：連續長條（像 Google 日曆），標出起訖與天數 */}
          {lanes > 0 && (
            <div
              className="grid border-b"
              style={{ gridTemplateColumns: cols, gridTemplateRows: `repeat(${lanes}, auto)` }}
            >
              <div
                className="flex items-center justify-center border-r text-xs text-muted-foreground"
                style={{ gridColumn: 1, gridRow: `1 / span ${lanes}` }}
              >
                整天
              </div>
              {banners.map(({ e, first, last, from, to, lane }) => {
                const n = Math.round((+new Date(`${last}T00:00:00Z`) - +new Date(`${first}T00:00:00Z`)) / DAY_MS) + 1;
                const range = n > 1 ? ` ${md(first)}–${md(last)}（${n} 天）` : "";
                const cutStart = first < days[from];
                const cutEnd = last > days[to];
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => onSelect(e)}
                    title={`${shortTitle(e)}${range}`}
                    style={{ ...eventStyle(colorOf(e.calendar_id)), gridColumn: `${from + 2} / span ${to - from + 1}`, gridRow: lane + 1 }}
                    className={cn(
                      "mx-0.5 my-px truncate rounded px-1.5 text-left text-xs font-medium",
                      cutStart && "ml-0 rounded-l-none",
                      cutEnd && "mr-0 rounded-r-none",
                      e.is_important && "text-red-600",
                    )}
                  >
                    {cutStart && "◀ "}
                    {shortTitle(e)}
                    <span className="font-normal opacity-75">{range}</span>
                    {cutEnd && " ▶"}
                  </button>
                );
              })}
            </div>
          )}

          {/* 時間軸 */}
          <div className="grid" style={{ gridTemplateColumns: cols }}>
            <div className="relative flex border-r" style={{ height }}>
              {/* 時段帶 */}
              <div className="relative w-6 border-r">
                {PERIODS.map((p, i) => {
                  const a = Math.max(p.from, fromH);
                  const b = Math.min(p.to, toH);
                  if (b <= a) return null;
                  return (
                    <div
                      key={p.label}
                      className={cn(
                        "absolute inset-x-0 flex items-center justify-center border-b text-xs font-semibold text-muted-foreground [writing-mode:vertical-rl]",
                        i % 2 ? "bg-muted/50" : "bg-muted/20",
                      )}
                      style={{ top: (a - fromH) * PX_PER_HOUR, height: (b - a) * PX_PER_HOUR }}
                    >
                      {p.label}
                    </div>
                  );
                })}
              </div>
              {/* 每小時刻度 */}
              <div className="flex-1">
                {Array.from({ length: hours }, (_, i) => (
                  <div key={i} className="border-b pr-1 text-right text-xs tabular-nums text-muted-foreground" style={{ height: PX_PER_HOUR }}>
                    {fromH + i}
                  </div>
                ))}
              </div>
            </div>

            {days.map((ds) => {
              const dayEvents = timed.filter((e) => eventSegmentOnDay(e, ds));
              return (
                <div
                  key={ds}
                  className={cn(
                    "relative border-r last:border-r-0",
                    ds === today && "bg-primary/[0.04]",
                    onCreateAt && "cursor-pointer print:cursor-auto",
                  )}
                  style={{ height }}
                  title={onCreateAt ? "點空白處新增行程" : undefined}
                  onClick={
                    onCreateAt
                      ? (ev) => {
                          const y = ev.clientY - ev.currentTarget.getBoundingClientRect().top;
                          const half = Math.floor((y / PX_PER_HOUR) * 2);
                          onCreateAt(ds, Math.min(23 * 60 + 30, Math.max(0, fromH * 60 + half * 30)));
                        }
                      : undefined
                  }
                >
                  {Array.from({ length: hours }, (_, i) => (
                    <div
                      key={i}
                      className={cn("border-b", fromH + i === 12 || fromH + i === 13 || fromH + i === 17 ? "border-b-foreground/20" : "")}
                      style={{ height: PX_PER_HOUR }}
                    />
                  ))}
                  {layoutDay(dayEvents).map(({ event, col, cols: n, span }) => {
                    const seg = eventSegmentOnDay(event, ds)!;
                    const top = (seg.start / 60 - fromH) * PX_PER_HOUR;
                    const h = Math.max(14, ((seg.end - seg.start) / 60) * PX_PER_HOUR);
                    const w = 100 / n;
                    const time = `${hm(seg.start)}–${hm(seg.end)}`;
                    // 名稱可折多行填滿色塊（並排變窄時不會只剩「Phoe…」）；還有空間才加一行起訖小字
                    const lines = Math.max(1, Math.floor((h - 2) / LINE_PX));
                    const showTime = lines >= 2;
                    const titleLines = showTime ? lines - 1 : lines;
                    return (
                      <button
                        key={event.id}
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          onSelect(event);
                        }}
                        title={`${time} ${event.title}`}
                        style={{
                          ...eventStyle(colorOf(event.calendar_id)),
                          position: "absolute",
                          top,
                          height: h,
                          left: `calc(${col * w}% + 1px)`,
                          width: `calc(${span * w}% - 2px)`,
                        }}
                        className="flex flex-col overflow-hidden rounded px-1 py-px text-left leading-[1.25] hover:brightness-95"
                      >
                        <span
                          className={cn(
                            "overflow-hidden text-xs font-medium [overflow-wrap:anywhere]",
                            event.is_important && "text-red-600",
                          )}
                          style={{ display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: titleLines }}
                        >
                          {event.is_important && (
                            <Star className="mr-0.5 inline size-3 fill-amber-400 align-[-1px] text-amber-500" />
                          )}
                          {shortTitle(event)}
                        </span>
                        {showTime && <span className="truncate text-[11px] tabular-nums opacity-70">{time}</span>}
                      </button>
                    );
                  })}
                  {/* 現在時刻 */}
                  {ds === today && nowMin >= fromH * 60 && nowMin <= toH * 60 && (
                    <div
                      className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-red-500 print:hidden"
                      style={{ top: (nowMin / 60 - fromH) * PX_PER_HOUR }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * 週行程表：從今天起往後 1 週／2 週／1 個月／半年，每 7 天一段；
 * 行程依起訖時刻對齊每小時刻度，名稱極簡（去掉開頭時間）；可依主角篩選。
 * spec：docs/specs/週行程表-每小時對齊與主角篩選.md
 */
export default function WeekSheetPage() {
  return (
    <Suspense fallback={<ListSkeleton rows={6} />}>
      <WeekSheetInner />
    </Suspense>
  );
}
