"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { addDays, addWeeks, format } from "date-fns";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { ErrorState, ListSkeleton } from "@/components/app/states";
import { useAppData } from "@/components/app/app-data";
import { can } from "@/lib/permissions";
import { useCalendarEvents } from "@/lib/client/events";
import { useContacts, useGapProfiles } from "@/lib/client/lookups";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Filter } from "lucide-react";
import {
  continuousWeeks,
  weekDays,
  dayRange,
  conflictIds,
  zoned,
  zonedToIso,
} from "@/lib/calendar-utils";
import { D } from "@/lib/date";
import { CONFLICT_COLOR } from "@/lib/constants";
import { MonthView } from "./month-view";
import { TimeGridView } from "./time-grid-view";
import { EventModal } from "./event-modal";
import { EventDetailDialog } from "./event-detail-dialog";
import type { CalEvent } from "@/lib/client/events";

type ViewMode = "month" | "week" | "day";

export function CalendarView() {
  const { calendars, calendarById } = useAppData();
  const canCreate = calendars.some((c) => can.editEvents(c.effectiveRole));

  const [view, setView] = useState<ViewMode>("month");
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  // 月視圖＝連續週：從今天這週往前 weeksBefore 週開始，共 weeksCount 週（Peggy 11/9）
  const [weeksBefore, setWeeksBefore] = useState(0);
  const [weeksCount, setWeeksCount] = useState(10);
  const [topYm, setTopYm] = useState("");
  // 要捲到的元素 id（週列 week-yyyy-MM-dd 或月份分隔 month-yyyy-MM，或 "top"）：等畫出來再捲
  const [scrollTo, setScrollTo] = useState<string | null>(null);

  // 網址帶 ?date=2026-11-02&view=day（語音新增／修改／刪除後）→ 跳到那天
  const params = useSearchParams();
  const focusDate = params.get("date");
  const focusView = params.get("view");
  const focusNonce = params.get("t");
  useEffect(() => {
    if (!focusDate || !/^\d{4}-\d{2}-\d{2}$/.test(focusDate)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 依網址同步一次定位
    setAnchor(new Date(zonedToIso(new Date(`${focusDate}T12:00:00`))));
    if (focusView === "day" || focusView === "week" || focusView === "month") setView(focusView);
    if (focusView === "month") {
      // 連續週要涵蓋那天：在今天之前就往前補週、之後就往後補週，再捲過去
      const diffWeeks = Math.floor(
        (Date.parse(`${focusDate}T12:00:00+08:00`) - Date.now()) / (7 * 864e5),
      );
      setWeeksBefore(diffWeeks < 0 ? -diffWeeks + 1 : 0);
      setWeeksCount((n) => Math.max(n, Math.max(0, diffWeeks) + 6));
      setScrollTo(`week-${focusDate}`);
    }
  }, [focusDate, focusView, focusNonce]);

  const [detail, setDetail] = useState<CalEvent | null>(null);
  const [editing, setEditing] = useState<CalEvent | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createStart, setCreateStart] = useState<string | undefined>(undefined);

  const { days, range, monthStart } = useMemo(() => {
    if (view === "month") {
      const g = continuousWeeks(weeksBefore, weeksCount);
      return { days: g.days, range: g.range, monthStart: g.days[0] };
    }
    if (view === "week") {
      const w = weekDays(anchor);
      return { days: w.days, range: w.range, monthStart: anchor };
    }
    const d = dayRange(anchor);
    return { days: [d.day], range: d.range, monthStart: anchor };
  }, [view, anchor, weeksBefore, weeksCount]);

  const { data: events = [], isLoading, isError, error, refetch } = useCalendarEvents(
    range.startIso,
    range.endIso,
    { keepPrevious: view === "month" },
  );
  // 捲到底再接 6 週（最多約兩年）
  const loadMoreWeeks = useCallback(() => setWeeksCount((n) => (n >= 104 ? n : n + 6)), []);

  useEffect(() => {
    if (!scrollTo || view !== "month") return;
    if (scrollTo === "top") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      document.querySelector("main")?.scrollTo?.({ top: 0, behavior: "smooth" });
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 捲完清掉，只執行一次
      setScrollTo(null);
      return;
    }
    // 週列 id 是那週週一；指定某天時找含那天的週
    let el = document.getElementById(scrollTo);
    if (!el && scrollTo.startsWith("week-")) {
      const ds = scrollTo.slice(5);
      el =
        [...document.querySelectorAll<HTMLElement>("[data-week-end]")].find(
          (r) => r.id.slice(5) <= ds && ds <= r.dataset.weekEnd!,
        ) ?? null;
    }
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setScrollTo(null);
    }
  }, [scrollTo, view, days.length, events]);
  const { data: contacts = [] } = useContacts();
  // 標記為「本人」的人物（老闆）：她的行程與未指定主角的行程都算本人的
  const { data: gapProfiles } = useGapProfiles();
  const selfName = gapProfiles?.selfName ?? null;
  const familyContacts = contacts.filter((c) => c.is_family);
  const otherContacts = contacts.filter((c) => !c.is_family);

  // 空檔對象（聚焦）：選某分類或某人物後，仍顯示全部行程（其他淡化），
  // 但空檔只依所選對象計算並標名。值："all" | "cal:<id>" | "ct:<name>"
  const [gapTarget, setGapTarget] = useState("all");
  // 記住上次的聚焦對象；以 effect 讀取避免 SSR 水合不一致
  useEffect(() => {
    try {
      const saved = localStorage.getItem("execcal:gapTarget");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 掛載時自 localStorage 同步一次
      if (saved) setGapTarget(saved);
    } catch {
      /* localStorage 不可用時忽略 */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("execcal:gapTarget", gapTarget);
    } catch {
      /* 忽略 */
    }
  }, [gapTarget]);
  const gapFilter = useMemo<{
    name: string;
    match: (e: CalEvent) => boolean;
  } | null>(() => {
    // 本人：未指定主角的行程即視為本人（Peggy）自己的
    // 家庭視角也以本人為主軸（週/日視圖與提示沿用）
    if (gapTarget === "self" || gapTarget === "family") {
      return {
        name: "本人",
        match: (e) =>
          e.subjectNames.length === 0 || (!!selfName && e.subjectNames.includes(selfName)),
      };
    }
    // 主角（誰的行程）：小孩／本人
    if (gapTarget.startsWith("subj:")) {
      const name = gapTarget.slice(5);
      return { name, match: (e) => e.subjectNames.includes(name) };
    }
    if (gapTarget.startsWith("cal:")) {
      const id = gapTarget.slice(4);
      return {
        name: calendarById.get(id)?.name ?? "分類",
        match: (e) => e.calendar_id === id,
      };
    }
    // 相關人物（拜訪／參與／對象）
    if (gapTarget.startsWith("ct:")) {
      const name = gapTarget.slice(3);
      return { name, match: (e) => e.participantNames.includes(name) };
    }
    return null;
  }, [gapTarget, calendarById, selfName]);

  // 家庭視角：以本人為主軸，家人（小孩）只在「當天有活動」的日子才顯示其空檔
  const familyFocus = useMemo(() => {
    if (gapTarget !== "family") return null;
    return {
      primary: {
        name: "本人",
        match: (e: CalEvent) =>
          e.subjectNames.length === 0 || (!!selfName && e.subjectNames.includes(selfName)),
      },
      members: familyContacts
        .filter((c) => c.name !== selfName)
        .map((c) => ({
        name: c.name,
        match: (e: CalEvent) => e.subjectNames.includes(c.name),
      })),
    };
  }, [gapTarget, familyContacts, selfName]);

  const conflicts = useMemo(() => conflictIds(events), [events]);
  const colorOf = (calendarId: string) =>
    calendarById.get(calendarId)?.color ?? "#64748B";

  const navigate = (dir: -1 | 0 | 1) => {
    if (view === "month") {
      // 連續週：今天＝回到最上面；‹＝往前多看 4 週；›＝捲到下個月的第一週
      if (dir === 0) {
        setWeeksBefore(0);
        setScrollTo("top");
      } else if (dir === -1) {
        setWeeksBefore((n) => n + 4);
        setScrollTo("top");
      } else {
        const [y, m] = (topYm || format(zoned(new Date()), "yyyy-MM")).split("-").map(Number);
        const next = format(new Date(y, m, 1), "yyyy-MM");
        setWeeksCount((n) => n + 5);
        setScrollTo(`month-${next}`);
      }
      return;
    }
    if (dir === 0) return setAnchor(new Date());
    const z = zoned(anchor);
    const nz =
      view === "week" ? addWeeks(z, dir) : addDays(z, dir);
    setAnchor(new Date(zonedToIso(nz)));
  };

  const title = useMemo(() => {
    if (view === "month") {
      const [y, m] = (topYm || format(zoned(new Date()), "yyyy-MM")).split("-").map(Number);
      return `${y} 年 ${m} 月`;
    }
    if (view === "week") {
      const wd = weekDays(anchor).days;
      return `${format(wd[0], "M/d")} – ${format(wd[6], "M/d")}`;
    }
    return D.full(anchor).slice(0, 14); // yyyy/MM/dd(EEE)
  }, [view, anchor, topYm]);

  const openCreate = (dateStr: string, hour = 9, minute = 0) => {
    if (!canCreate) return;
    const hh = String(hour).padStart(2, "0");
    const mm = String(minute).padStart(2, "0");
    setCreateStart(`${dateStr}T${hh}:${mm}`);
    setCreateOpen(true);
  };

  // 切換日／週／月：目前畫面看得到今天 → 以今天為準（Peggy 10/31：今天是 10/31，
  // 先前點過 11/4，切週、日卻跑到 11/2–11/8、11/4）；特地翻到別月（看不到今天）才沿用目前位置
  const switchView = (v: ViewMode) => {
    const now = new Date();
    const todayVisible =
      now.getTime() >= Date.parse(range.startIso) &&
      now.getTime() < Date.parse(range.endIso);
    if (todayVisible) setAnchor(now);
    setView(v);
  };

  // 從月視圖點某天 → 切到「日視圖」展開整天（中午為錨，避開時區邊界）。
  const openDay = (dateStr: string) => {
    setAnchor(new Date(zonedToIso(new Date(`${dateStr}T12:00:00`))));
    setView("day");
  };

  return (
    <div>
      <PageHeader
        title="行事曆"
        actions={
          canCreate ? (
            <Button
              className="touch:h-11 touch:px-5"
              onClick={() => openCreate(format(zoned(new Date()), "yyyy-MM-dd"))}
            >
              <Plus className="size-4" />
              新增行程
            </Button>
          ) : undefined
        }
      />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="touch:size-11" onClick={() => navigate(-1)} aria-label="上一頁">
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" size="sm" className="touch:h-11 touch:px-4" onClick={() => navigate(0)}>
            今天
          </Button>
          <Button variant="outline" size="icon" className="touch:size-11" onClick={() => navigate(1)} aria-label="下一頁">
            <ChevronRight className="size-4" />
          </Button>
          <h2 className="ml-2 text-lg font-semibold">{title}</h2>
        </div>

        <div className="flex items-center gap-2">
          {conflicts.size > 0 && (
            <span
              className="rounded-full px-2 py-1 text-xs font-medium text-white"
              style={{ backgroundColor: CONFLICT_COLOR }}
            >
              {conflicts.size} 筆衝突
            </span>
          )}
          <div className="inline-flex rounded-lg border p-0.5">
            {(["month", "week", "day"] as ViewMode[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => switchView(v)}
                className={
                  "rounded-md px-3 py-1 text-sm font-medium transition touch:px-4 touch:py-2 touch:text-base " +
                  (view === v
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                {v === "month" ? "月" : v === "week" ? "週" : "日"}
              </button>
            ))}
          </div>

          {/* 空檔對象：選分類或人物，只看該對象的行程與空檔 */}
          <Select value={gapTarget} onValueChange={setGapTarget}>
            <SelectTrigger
              className="h-9 w-auto gap-1.5 touch:h-11"
              aria-label="空檔對象"
            >
              <Filter className="size-3.5 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部行程</SelectItem>
              <SelectItem value="self">本人（未指定主角）</SelectItem>
              {familyContacts.length > 0 && (
                <SelectItem value="family">本人＋家人（家庭視角）</SelectItem>
              )}
              {familyContacts.length > 0 && (
                <div className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">
                  主角（誰的行程）
                </div>
              )}
              {familyContacts.map((ct) => (
                <SelectItem key={ct.id} value={`subj:${ct.name}`}>
                  {ct.name}
                </SelectItem>
              ))}
              {calendars.length > 0 && (
                <div className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">
                  分類
                </div>
              )}
              {calendars.map((c) => (
                <SelectItem key={c.id} value={`cal:${c.id}`}>
                  <span className="flex items-center gap-2">
                    <span
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: c.color }}
                    />
                    {c.name}
                  </span>
                </SelectItem>
              ))}
              {otherContacts.length > 0 && (
                <div className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">
                  相關人物（拜訪／參與）
                </div>
              )}
              {otherContacts.map((ct) => (
                <SelectItem key={ct.id} value={`ct:${ct.name}`}>
                  {ct.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {gapFilter && (
        <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
            {familyFocus
              ? "家庭視角：本人空檔為主，家人在當天有活動時一併顯示其空檔"
              : `聚焦「${gapFilter.name}」的空檔 · 其他行程淡化顯示`}
          </span>
          <button
            type="button"
            onClick={() => setGapTarget("all")}
            className="underline hover:text-foreground"
          >
            清除
          </button>
        </div>
      )}

      {isError ? (
        <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
      ) : isLoading && events.length === 0 ? (
        <ListSkeleton rows={6} />
      ) : view === "month" ? (
        <MonthView
          days={days}
          monthStart={monthStart}
          events={events}
          gapFilter={gapFilter}
          familyFocus={familyFocus}
          colorOf={colorOf}
          conflicts={conflicts}
          canCreate={canCreate}
          onSelectEvent={setDetail}
          onCreateAt={openCreate}
          onOpenDay={openDay}
          continuous
          onTopMonthChange={setTopYm}
          onReachEnd={loadMoreWeeks}
        />
      ) : (
        <TimeGridView
          days={days}
          events={events}
          gapFilter={gapFilter}
          colorOf={colorOf}
          conflicts={conflicts}
          canCreate={canCreate}
          onSelectEvent={setDetail}
          onCreateAt={openCreate}
          onOpenDay={openDay}
        />
      )}

      {/* 詳情 */}
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
