"use client";

import { useMemo, useState } from "react";
import { addDays, addMonths, addWeeks, format } from "date-fns";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { ErrorState, ListSkeleton } from "@/components/app/states";
import { useAppData } from "@/components/app/app-data";
import { can } from "@/lib/permissions";
import { useCalendarEvents } from "@/lib/client/events";
import { useContacts } from "@/lib/client/lookups";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Filter } from "lucide-react";
import {
  monthGrid,
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

  const [detail, setDetail] = useState<CalEvent | null>(null);
  const [editing, setEditing] = useState<CalEvent | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createStart, setCreateStart] = useState<string | undefined>(undefined);

  const { days, range, monthStart } = useMemo(() => {
    if (view === "month") {
      const g = monthGrid(anchor);
      return { days: g.days, range: g.range, monthStart: g.monthStart };
    }
    if (view === "week") {
      const w = weekDays(anchor);
      return { days: w.days, range: w.range, monthStart: anchor };
    }
    const d = dayRange(anchor);
    return { days: [d.day], range: d.range, monthStart: anchor };
  }, [view, anchor]);

  const { data: events = [], isLoading, isError, error, refetch } = useCalendarEvents(
    range.startIso,
    range.endIso,
  );
  const { data: contacts = [] } = useContacts();

  // 空檔對象：只看某分類或某人物的行程與其空檔（"all" | "cal:<id>" | "ct:<name>"）
  const [gapTarget, setGapTarget] = useState("all");
  const events2 = useMemo(() => {
    if (gapTarget === "all") return events;
    if (gapTarget.startsWith("cal:")) {
      const id = gapTarget.slice(4);
      return events.filter((e) => e.calendar_id === id);
    }
    if (gapTarget.startsWith("ct:")) {
      const name = gapTarget.slice(3);
      return events.filter((e) => e.contactNames.includes(name));
    }
    return events;
  }, [events, gapTarget]);

  const conflicts = useMemo(() => conflictIds(events2), [events2]);
  const colorOf = (calendarId: string) =>
    calendarById.get(calendarId)?.color ?? "#64748B";

  const navigate = (dir: -1 | 0 | 1) => {
    if (dir === 0) return setAnchor(new Date());
    const z = zoned(anchor);
    const nz =
      view === "month" ? addMonths(z, dir) : view === "week" ? addWeeks(z, dir) : addDays(z, dir);
    setAnchor(new Date(zonedToIso(nz)));
  };

  const title = useMemo(() => {
    if (view === "month") return D.monthYear(anchor);
    if (view === "week") {
      const wd = weekDays(anchor).days;
      return `${format(wd[0], "M/d")} – ${format(wd[6], "M/d")}`;
    }
    return D.full(anchor).slice(0, 14); // yyyy/MM/dd(EEE)
  }, [view, anchor]);

  const openCreate = (dateStr: string, hour = 9, minute = 0) => {
    if (!canCreate) return;
    const hh = String(hour).padStart(2, "0");
    const mm = String(minute).padStart(2, "0");
    setCreateStart(`${dateStr}T${hh}:${mm}`);
    setCreateOpen(true);
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
                onClick={() => setView(v)}
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
              {contacts.length > 0 && (
                <div className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">
                  人物
                </div>
              )}
              {contacts.map((ct) => (
                <SelectItem key={ct.id} value={`ct:${ct.name}`}>
                  {ct.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {gapTarget !== "all" && (
        <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
            只看
            {gapTarget.startsWith("cal:")
              ? `分類：${calendarById.get(gapTarget.slice(4))?.name ?? ""}`
              : `人物：${gapTarget.slice(3)}`}
            的行程與空檔
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
      ) : isLoading ? (
        <ListSkeleton rows={6} />
      ) : view === "month" ? (
        <MonthView
          days={days}
          monthStart={monthStart}
          events={events2}
          colorOf={colorOf}
          conflicts={conflicts}
          canCreate={canCreate}
          onSelectEvent={setDetail}
          onCreateAt={openCreate}
          onOpenDay={openDay}
        />
      ) : (
        <TimeGridView
          days={days}
          events={events2}
          colorOf={colorOf}
          conflicts={conflicts}
          canCreate={canCreate}
          onSelectEvent={setDetail}
          onCreateAt={openCreate}
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
