"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Printer } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { ErrorState, ListSkeleton } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { EventDetailDialog } from "@/components/calendar/event-detail-dialog";
import { EventModal } from "@/components/calendar/event-modal";
import { useAppData } from "@/components/app/app-data";
import { useCalendarEvents, type CalEvent } from "@/lib/client/events";
import {
  taipeiDateStartUtcISO,
  taipeiTodayStr,
  utcToTaipeiWall,
} from "@/lib/date";
import { cn } from "@/lib/utils";

const WD = ["一", "二", "三", "四", "五", "六", "日"];

/** 時段（依開始時刻）：仿 Peggy 手做的週表 */
const PERIODS = [
  { key: "am", label: "上午", until: "11:30" },
  { key: "noon", label: "中午", until: "13:30" },
  { key: "pm", label: "下午", until: "17:00" },
  { key: "eve", label: "晚上", until: "24:00" },
] as const;

function addDaysStr(ds: string, n: number): string {
  return new Date(Date.parse(`${ds}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}
function mondayOf(ds: string): string {
  const d = new Date(`${ds}T12:00:00Z`);
  return addDaysStr(ds, -((d.getUTCDay() + 6) % 7));
}
function md(ds: string): string {
  return `${Number(ds.slice(5, 7))}/${Number(ds.slice(8, 10))}`;
}

/** 卡片上的時間：短行程只寫開始；兩小時以上寫起訖（17:00–22:00 Phoenix） */
function timeText(e: CalEvent): string {
  const s = utcToTaipeiWall(e.starts_at);
  const en = utcToTaipeiWall(e.ends_at);
  const long = Date.parse(e.ends_at) - Date.parse(e.starts_at) >= 2 * 3600000;
  if (!long) return s.slice(11);
  return `${s.slice(11)}–${en.slice(0, 10) !== s.slice(0, 10) ? `${md(en.slice(0, 10))} ` : ""}${en.slice(11)}`;
}

/** 標題開頭已自帶時間（0730小游、17:30小杜、17-22 Phoenix）→ 不再重複加時間 */
function titleHasTime(title: string): boolean {
  return /^(\d{3,4}|\d{1,2}[:：\-–])/.test(title.trim());
}

function WeekSheetInner() {
  const params = useSearchParams();
  const today = taipeiTodayStr();
  const [monday, setMonday] = useState(() => mondayOf(params.get("start") ?? today));
  const { calendarById } = useAppData();
  const [detail, setDetail] = useState<CalEvent | null>(null);
  const [editing, setEditing] = useState<CalEvent | null>(null);

  const days = Array.from({ length: 7 }, (_, i) => addDaysStr(monday, i));
  const startIso = taipeiDateStartUtcISO(monday);
  const endIso = taipeiDateStartUtcISO(addDaysStr(monday, 7));
  const { data: events = [], isLoading, isError, error, refetch } = useCalendarEvents(startIso, endIso);

  // cells[dayIndex][periodKey | "allDay"] = 行程
  const cells = useMemo(() => {
    const m = days.map(() => new Map<string, CalEvent[]>());
    for (const e of events) {
      if (e.all_day) {
        // 整天：每個涵蓋到的日子都列
        days.forEach((ds, i) => {
          const ds0 = Date.parse(taipeiDateStartUtcISO(ds));
          if (Date.parse(e.starts_at) < ds0 + 86400000 && Date.parse(e.ends_at) > ds0) {
            m[i].set("allDay", [...(m[i].get("allDay") ?? []), e]);
          }
        });
        continue;
      }
      const wall = utcToTaipeiWall(e.starts_at);
      const i = days.indexOf(wall.slice(0, 10));
      if (i < 0) continue;
      const hm = wall.slice(11);
      const p = PERIODS.find((x) => hm < x.until) ?? PERIODS[3];
      m[i].set(p.key, [...(m[i].get(p.key) ?? []), e]);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, monday]);

  const rows = [{ key: "allDay", label: "整天" }, ...PERIODS];
  const isThisWeek = monday === mondayOf(today);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="print:hidden">
        <PageHeader
          title="週行程表"
          description="一週七天、分上午／中午／下午／晚上，可列印或存成 PDF 傳給別人"
          actions={
            <Button onClick={() => window.print()}>
              <Printer className="size-4" />
              列印／存 PDF
            </Button>
          }
        />
        <div className="mb-3 flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setMonday(addDaysStr(monday, -7))} aria-label="上一週">
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" onClick={() => setMonday(mondayOf(today))} disabled={isThisWeek}>
            本週
          </Button>
          <Button variant="outline" onClick={() => setMonday(mondayOf(addDaysStr(today, 7)))}>
            下週
          </Button>
          <Button variant="outline" size="icon" onClick={() => setMonday(addDaysStr(monday, 7))} aria-label="下一週">
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      {isError ? (
        <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
      ) : isLoading ? (
        <ListSkeleton rows={6} />
      ) : (
        <div id="print-area">
          <h2 className="mb-2 text-base font-bold">
            {md(days[0])}（一）– {md(days[6])}（日） 一週行程
          </h2>
          {/* 手機上表格可左右滑，頁面本身不會橫向捲動 */}
          <div className="overflow-x-auto print:overflow-visible">
            <table className="w-full min-w-[760px] table-fixed border-collapse text-xs print:min-w-0 print:text-[8pt]">
              <colgroup>
                <col className="w-10" />
                {days.map((d) => (
                  <col key={d} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th className="border bg-muted/50 p-1" />
                  {days.map((ds, i) => (
                    <th
                      key={ds}
                      className={cn(
                        "border bg-muted/50 p-1 text-center font-semibold",
                        ds === today && "bg-primary/15",
                      )}
                    >
                      <div>週{WD[i]}</div>
                      <div className="font-normal text-muted-foreground">{md(ds)}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const empty = cells.every((c) => !(c.get(r.key)?.length));
                  if (r.key === "allDay" && empty) return null;
                  return (
                    <tr key={r.key}>
                      <th className="border bg-muted/30 p-1 text-center align-middle font-semibold [writing-mode:vertical-rl] sm:[writing-mode:horizontal-tb]">
                        {r.label}
                      </th>
                      {days.map((ds, i) => (
                        <td key={ds} className="border p-1 align-top">
                          <div className="space-y-1">
                            {(cells[i].get(r.key) ?? []).map((e) => {
                              const color = calendarById.get(e.calendar_id)?.color ?? "#64748B";
                              return (
                                <button
                                  key={e.id}
                                  type="button"
                                  onClick={() => setDetail(e)}
                                  className="block w-full rounded px-1 py-0.5 text-left leading-snug print:break-inside-avoid"
                                  style={{
                                    backgroundColor: `${color}26`,
                                    borderLeft: `3px solid ${color}`,
                                  }}
                                >
                                  <span className={cn("font-medium", e.is_important && "text-red-600")}>
                                    {r.key !== "allDay" && !titleHasTime(e.title) && (
                                      <span className="tabular-nums">{timeText(e)} </span>
                                    )}
                                    {e.title}
                                  </span>
                                  {e.location && !e.title.includes(e.location) && (
                                    <span className="text-muted-foreground">（{e.location}）</span>
                                  )}
                                  {e.description && (
                                    <span className="mt-0.5 block whitespace-pre-line text-[10px] text-muted-foreground print:text-[7pt]">
                                      {e.description.length > 80 ? `${e.description.slice(0, 80)}…` : e.description}
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground print:hidden">
            只會列出左側選單目前勾選顯示的分類；行程下方灰字是行程的備註。點行程可看詳情或修改。
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
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        mode="edit"
        event={editing ?? undefined}
        onSaved={() => refetch()}
      />
    </div>
  );
}

/**
 * 週行程表：仿 Peggy 手做的一週表（七天 × 上午／中午／下午／晚上＋備註），
 * 比 Google 週檢視好讀，可列印或存 PDF 分享。spec：docs/specs/多週總覽與週行程表.md
 */
export default function WeekSheetPage() {
  return (
    <Suspense fallback={<ListSkeleton rows={6} />}>
      <WeekSheetInner />
    </Suspense>
  );
}
