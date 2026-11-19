"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarSearch } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAppData } from "@/components/app/app-data";
import { EventDetailDialog } from "@/components/calendar/event-detail-dialog";
import { useCalendarEvents, type CalEvent } from "@/lib/client/events";
import { useGapProfiles } from "@/lib/client/lookups";
import { createClient } from "@/lib/supabase/client";
import { driverFromRow } from "@/lib/driver";
import { freeOnDay, humanMinutes, minToHHMM, travelPadding } from "@/lib/availability";
import { D, taipeiDateEndExclusiveUtcISO, taipeiDateStartUtcISO, taipeiTodayStr } from "@/lib/date";
import { addDays, hmToMin } from "@/lib/work-groups";
import { cn } from "@/lib/utils";

/**
 * 逐週查空檔（Elsa 11/19 需求 1）：固定星期＋時段（例：每週日 14:00–16:00），
 * 從某天起逐週列出有空／不行／部分重疊，不行的寫原因。
 * 看得到行程的人看事由（Peggy）；只看空檔的人（秘書）只看到「已有行程」。
 * spec：docs/specs/Elsa需求-多人權限與家庭老師報告.md
 */

const WD = ["日", "一", "二", "三", "四", "五", "六"];
const weekdayOf = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

/** 只看空檔的人：忙碌時段（busy_blocks 一次最多 62 天，分段查） */
function useBusyRange(fromDate: string, toDate: string, enabled: boolean) {
  return useQuery({
    queryKey: ["weekly-free-busy", fromDate, toDate],
    enabled,
    queryFn: async () => {
      const sb = createClient();
      const out: { starts_at: string; ends_at: string; all_day: boolean; driver: ReturnType<typeof driverFromRow> }[] = [];
      for (let d = fromDate; d <= toDate; d = addDays(d, 56)) {
        const end = addDays(d, 55) < toDate ? addDays(d, 55) : toDate;
        const { data, error } = await sb.rpc("busy_blocks", {
          p_from: taipeiDateStartUtcISO(d),
          p_to: taipeiDateEndExclusiveUtcISO(end),
        });
        if (error) throw new Error(error.message);
        for (const b of data ?? []) out.push({ ...b, driver: driverFromRow(b) });
      }
      return out;
    },
  });
}

export default function WeeklyFreePage() {
  const { calendars, me } = useAppData();
  const freebusyOnly = calendars.length === 0 && !!me.canPropose;
  const today = taipeiTodayStr();
  const [weekday, setWeekday] = useState(0);
  const [start, setStart] = useState("14:00");
  const [end, setEnd] = useState("16:00");
  const [weeks, setWeeks] = useState(12);
  const [who, setWho] = useState<"all" | "self">("all");
  const [detail, setDetail] = useState<CalEvent | null>(null);

  // 第一個符合星期的日子（今天起）
  const first = addDays(today, (weekday - weekdayOf(today) + 7) % 7);
  const dates = Array.from({ length: weeks }, (_, i) => addDays(first, i * 7));
  const last = dates[dates.length - 1];

  const evQ = useCalendarEvents(taipeiDateStartUtcISO(first), taipeiDateEndExclusiveUtcISO(last));
  const busyQ = useBusyRange(first, last, freebusyOnly);
  const { data: gap } = useGapProfiles();
  const selfName = gap?.selfName ?? null;

  const winStart = hmToMin(start);
  const winEnd = hmToMin(end);
  const valid = winEnd > winStart;

  const rows = (() => {
    if (!valid) return [];
    // 行程（或忙碌時段）統一成可算空檔的格式
    type Item = { starts_at: string; ends_at: string; all_day: boolean; driver: CalEvent["driver"] | ReturnType<typeof driverFromRow>; ev?: CalEvent };
    const items: Item[] = freebusyOnly
      ? (busyQ.data ?? [])
      : (evQ.data ?? [])
          .filter((e) => !e.proposal)
          .filter(
            (e) =>
              who === "all" ||
              e.subjectNames.length === 0 ||
              (selfName != null && e.subjectNames.includes(selfName)),
          )
          .map((e) => ({ starts_at: e.starts_at, ends_at: e.ends_at, all_day: e.all_day, driver: e.driver, ev: e }));
    return dates.map((d) => {
      const dayStart = Date.parse(taipeiDateStartUtcISO(d));
      const s = dayStart + winStart * 60000;
      const e = dayStart + winEnd * 60000;
      const hits = items.filter((it) => {
        if (it.all_day) return Date.parse(it.starts_at) < dayStart + 864e5 && Date.parse(it.ends_at) > dayStart;
        const pad = travelPadding(it);
        return Date.parse(it.starts_at) - pad.before * 60000 < e && Date.parse(it.ends_at) + pad.after * 60000 > s;
      });
      const free = freeOnDay(
        items.filter((it) => !it.all_day),
        d,
        { start: winStart, end: winEnd },
        0,
      );
      const freeMin = free.reduce((n, f) => n + f.end - f.start, 0);
      const timedHits = hits.filter((h) => !h.all_day);
      const status: "free" | "busy" | "partial" =
        timedHits.length === 0 ? "free" : freeMin === 0 ? "busy" : "partial";
      return { date: d, status, free, hits, allDay: hits.some((h) => h.all_day) };
    });
  })();

  const loading = freebusyOnly ? busyQ.isLoading : evQ.isLoading;
  const error = freebusyOnly ? busyQ.error : evQ.error;
  const freeCount = rows.filter((r) => r.status === "free" && !r.allDay).length;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="逐週查空檔"
        description="固定星期與時段（例：每週日 14:00–16:00），一次列出接下來每週有沒有空、不行的原因"
      />

      <div className="mb-4 space-y-3 rounded-xl border bg-card p-3">
        <div className="space-y-1.5">
          <Label className="text-xs">星期</Label>
          <div className="flex flex-wrap gap-1.5">
            {WD.map((w, i) => (
              <button
                key={w}
                type="button"
                onClick={() => setWeekday(i)}
                className={cn(
                  "size-9 rounded-full border text-sm",
                  weekday === i ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
                )}
              >
                {w}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="space-y-1">
            <Label className="text-xs">從</Label>
            <Input type="time" step={900} value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">到</Label>
            <Input type="time" step={900} value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">查幾週</Label>
            <div className="flex gap-1.5">
              {[4, 8, 12, 26].map((n) => (
                <Button key={n} size="sm" variant={weeks === n ? "default" : "outline"} onClick={() => setWeeks(n)}>
                  {n} 週
                </Button>
              ))}
            </div>
          </div>
        </div>
        {!freebusyOnly && (
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="text-xs text-muted-foreground">算誰的行程：</span>
            {(
              [
                ["all", "全部（含小孩、家人）"],
                ["self", `只算${selfName ?? "本人"}`],
              ] as const
            ).map(([k, label]) => (
              <Button key={k} size="sm" variant={who === k ? "default" : "outline"} onClick={() => setWho(k)}>
                {label}
              </Button>
            ))}
          </div>
        )}
      </div>

      {!valid ? (
        <p className="text-sm text-destructive">結束時間要晚於開始時間</p>
      ) : error ? (
        <ErrorState message={(error as Error).message} />
      ) : loading ? (
        <ListSkeleton rows={6} />
      ) : rows.length === 0 ? (
        <EmptyState icon={CalendarSearch} title="沒有日期" />
      ) : (
        <>
          <p className="mb-2 text-sm text-muted-foreground">
            每週{WD[weekday]} {start}–{end}：{weeks} 週裡 <b className="text-foreground">{freeCount}</b> 週有空
          </p>
          <ul className="space-y-1.5">
            {rows.map((r) => (
              <li
                key={r.date}
                className={cn(
                  "rounded-lg border px-3 py-2 text-sm",
                  r.status === "free" && !r.allDay && "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40",
                  r.status === "busy" && "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40",
                  (r.status === "partial" || (r.status === "free" && r.allDay)) &&
                    "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40",
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-20 font-semibold tabular-nums">
                    {md(r.date)}（{WD[weekdayOf(r.date)]}）
                  </span>
                  <span className="font-medium">
                    {r.status === "free" ? (r.allDay ? "時段有空（當天有整日行程）" : "有空") : r.status === "busy" ? "不行" : "部分重疊"}
                  </span>
                  {r.status === "partial" && (
                    <span className="text-muted-foreground">
                      剩 {r.free.map((f) => `${minToHHMM(f.start)}–${minToHHMM(f.end)}（${humanMinutes(f.end - f.start)}）`).join("、")}
                    </span>
                  )}
                </div>
                {r.hits.length > 0 && (
                  <ul className="mt-1 space-y-0.5 pl-[5.5rem] max-sm:pl-0">
                    {r.hits.map((h, i) => (
                      <li key={i} className="text-xs text-muted-foreground">
                        {h.all_day ? "整日" : `${D.time(h.starts_at)}–${D.time(h.ends_at)}`}{" "}
                        {h.ev ? (
                          <button type="button" className="text-foreground underline" onClick={() => setDetail(h.ev!)}>
                            {h.ev.subjectNames.length > 0 && `${h.ev.subjectNames.join("、")}：`}
                            {h.ev.title}
                          </button>
                        ) : (
                          "已有行程"
                        )}
                        {h.driver && h.driver.pickupMinutes > 0 && "（含接送車程）"}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <EventDetailDialog
        open={!!detail}
        onOpenChange={(o) => !o && setDetail(null)}
        event={detail}
        onEdit={() => setDetail(null)}
      />
    </div>
  );
}
