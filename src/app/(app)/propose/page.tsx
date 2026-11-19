"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { useAppData } from "@/components/app/app-data";
import { ProposalDialog, type ProposalForm } from "@/components/proposals/proposal-dialog";
import { ProposalStatus } from "@/components/proposals/proposal-status";
import {
  useBusyBlocks,
  useFreebusyCalendars,
  useMyProposals,
  waitingDays,
  type ProposalRow,
} from "@/lib/client/proposals";
import { withdrawProposalAction } from "@/lib/actions/proposals";
import { busyOnDay, freeOnDay, humanMinutes, minToHHMM, type Segment } from "@/lib/availability";
import { fmt, taipeiDateEndExclusiveUtcISO, taipeiDateStartUtcISO, taipeiNowWall, taipeiTodayStr } from "@/lib/date";
import { cn } from "@/lib/utils";

/**
 * 幫排行程（只看空檔的人，例如秘書、家庭老師看小孩私人行程）：
 * 看得到「什麼時間忙」，從空檔提議行程，等擁有者審核後才成立。
 * spec：docs/specs/只看空檔與提議行程審核.md
 */

/** 可以排事情的時段 08:00–22:00；空檔至少 30 分鐘才列 */
const WINDOW = { start: 8 * 60, end: 22 * 60 };
const MIN_GAP = 30;
const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"];

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}
function weekday(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
/** 那週的週一 */
function mondayOf(dateStr: string): string {
  return addDays(dateStr, -((weekday(dateStr) + 6) % 7));
}
const md = (dateStr: string) => `${Number(dateStr.slice(5, 7))}/${Number(dateStr.slice(8, 10))}`;

export default function ProposePage() {
  const { me } = useAppData();
  const qc = useQueryClient();
  const today = taipeiTodayStr();
  const [weekStart, setWeekStart] = useState(mondayOf(today));
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [form, setForm] = useState<ProposalForm | null>(null);

  const calsQ = useFreebusyCalendars(me.id);
  const allCals = useMemo(() => calsQ.data ?? [], [calsQ.data]);
  const owners = useMemo(
    () => [...new Map(allCals.map((c) => [c.ownerId, c.ownerName])).entries()],
    [allCals],
  );
  const owner = ownerId ?? owners[0]?.[0] ?? null;
  const ownerName = owners.find(([id]) => id === owner)?.[1] ?? "";
  const cals = allCals.filter((c) => c.ownerId === owner);
  const calIds = new Set(cals.map((c) => c.id));

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const fromIso = taipeiDateStartUtcISO(days[0]);
  const toIso = taipeiDateEndExclusiveUtcISO(days[6]);
  const busyQ = useBusyBlocks(fromIso, toIso, cals.length > 0);
  const busy = (busyQ.data ?? []).filter((b) => calIds.has(b.calendar_id));

  const mineQ = useMyProposals(me.id);
  const mine = (mineQ.data ?? []).filter((p) => calIds.has(p.calendar_id));
  const pendingByDay = new Map<string, ProposalRow[]>();
  for (const p of mine) {
    if (p.status !== "pending") continue;
    const d = fmt(p.starts_at, "yyyy-MM-dd");
    pendingByDay.set(d, [...(pendingByDay.get(d) ?? []), p]);
  }

  const nowWall = taipeiNowWall();
  const nowMin = Number(nowWall.slice(11, 13)) * 60 + Number(nowWall.slice(14, 16));

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["proposals"] });
    qc.invalidateQueries({ queryKey: ["busy-blocks"] });
  };

  async function withdraw(p: ProposalRow) {
    const res = await withdrawProposalAction(p.id);
    if (!res.ok) return toast.error(res.error);
    toast.success("已撤回");
    refresh();
  }

  function openNew(day: string, slot: Segment) {
    const start = slot.start;
    setForm({
      calendarId: cals[0]?.id ?? "",
      title: "",
      date: day,
      start: minToHHMM(start),
      end: minToHHMM(Math.min(start + 60, slot.end)),
      location: "",
      note: "",
    });
  }

  if (calsQ.isLoading) return <ListSkeleton rows={6} />;
  if (calsQ.isError) return <ErrorState message={(calsQ.error as Error).message} onRetry={() => calsQ.refetch()} />;
  if (allCals.length === 0)
    return (
      <EmptyState
        icon={CalendarPlus}
        title="還沒有人分享空檔給你"
        description="請對方到「分享與權限」，把分類分享給你、身分選「只看空檔」。"
      />
    );

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="幫排行程"
        description={`看得到 ${ownerName} 哪些時間有空（看不到行程內容）。從空檔提議行程，${ownerName} 審核後才會成立。`}
      />

      {owners.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {owners.map(([id, name]) => (
            <Button
              key={id}
              size="sm"
              variant={id === owner ? "default" : "outline"}
              className="rounded-full"
              onClick={() => setOwnerId(id)}
            >
              {name}
            </Button>
          ))}
        </div>
      )}

      <div className="mb-3 flex items-center gap-2">
        <Button variant="outline" size="icon" aria-label="上一週" onClick={() => setWeekStart(addDays(weekStart, -7))}>
          <ChevronLeft className="size-4" />
        </Button>
        <Button variant="outline" onClick={() => setWeekStart(mondayOf(today))} disabled={weekStart === mondayOf(today)}>
          本週
        </Button>
        <Button variant="outline" size="icon" aria-label="下一週" onClick={() => setWeekStart(addDays(weekStart, 7))}>
          <ChevronRight className="size-4" />
        </Button>
        <span className="text-lg font-bold">
          {md(days[0])}–{md(days[6])}
        </span>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        分類：{cals.map((c) => c.name).join("、")}　·　只列 08:00–22:00、30 分鐘以上的空檔；接送車程也算忙碌
      </p>

      {busyQ.isError ? (
        <ErrorState message={(busyQ.error as Error).message} onRetry={() => busyQ.refetch()} />
      ) : busyQ.isLoading ? (
        <ListSkeleton rows={7} />
      ) : (
        <div className="space-y-3">
          {days.map((day) => {
            const past = day < today;
            const timed = busy.filter((b) => !b.all_day);
            const hasAllDay = busy.some(
              (b) => b.all_day && fmt(b.starts_at, "yyyy-MM-dd") <= day && fmt(new Date(Date.parse(b.ends_at) - 1), "yyyy-MM-dd") >= day,
            );
            const busySegs = busyOnDay(timed, day, WINDOW);
            const pend = pendingByDay.get(day) ?? [];
            // 空檔扣掉自己已提議、還在等審核的時段（避免重複提議）；今天從現在開始算
            const win = day === today ? { start: Math.max(WINDOW.start, Math.ceil(nowMin / 5) * 5), end: WINDOW.end } : WINDOW;
            const freeSegs =
              win.end <= win.start
                ? []
                : freeOnDay([...timed, ...pend.map((p) => ({ ...p, all_day: false }))], day, win, MIN_GAP);
            const items = [
              ...busySegs.map((s) => ({ kind: "busy" as const, s })),
              ...(past ? [] : freeSegs.map((s) => ({ kind: "free" as const, s }))),
              // 自己待審核的提議也照時間排進去（虛線）
              ...pend.map((p) => {
                const st = fmt(p.starts_at, "HH:mm");
                return { kind: "pending" as const, s: { start: Number(st.slice(0, 2)) * 60 + Number(st.slice(3)), end: 0 }, p };
              }),
            ].sort((a, b) => a.s.start - b.s.start);
            return (
              <section key={day} className={cn("rounded-xl border bg-card p-3", past && "opacity-60")}>
                <h2 className="mb-2 flex items-center font-bold">
                  {md(day)}（{WEEKDAY[weekday(day)]}）
                  {day === today && <span className="ml-2 text-xs font-normal text-primary">今天</span>}
                  {!past && (
                    // 空檔以外的時間也能提議（撞到會提醒，由擁有者決定）
                    <button
                      type="button"
                      className="ml-auto text-xs font-normal text-primary underline"
                      onClick={() => openNew(day, { start: 9 * 60, end: 10 * 60 })}
                    >
                      提議其他時間
                    </button>
                  )}
                </h2>
                {hasAllDay && (
                  <p className="mb-1 text-xs text-amber-700 dark:text-amber-400">這天有整日行程，排之前最好先問一下</p>
                )}
                <ul className="space-y-1.5">
                  {items.length === 0 && (
                    <li className="text-sm text-muted-foreground">{past ? "已過" : "沒有 30 分鐘以上的空檔"}</li>
                  )}
                  {items.map((it) => {
                    const { kind, s } = it;
                    if (it.kind === "pending")
                      return (
                        <li key={it.p.id} className="rounded-md border border-dashed border-primary/60 px-3 py-1.5 text-sm">
                          <span className="tabular-nums">
                            {fmt(it.p.starts_at, "HH:mm")}–{fmt(it.p.ends_at, "HH:mm")}
                          </span>{" "}
                          待審核：{it.p.title}
                        </li>
                      );
                    return kind === "busy" ? (
                      <li key={`b${s.start}`} className="flex items-center gap-2 rounded-md bg-muted px-3 py-1.5 text-sm text-muted-foreground">
                        <span className="tabular-nums">
                          {minToHHMM(s.start)}–{minToHHMM(s.end)}
                        </span>
                        忙碌
                      </li>
                    ) : (
                      <li
                        key={`f${s.start}`}
                        className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm dark:border-emerald-800 dark:bg-emerald-950/40"
                      >
                        <span className="tabular-nums">
                          {minToHHMM(s.start)}–{minToHHMM(s.end)}
                        </span>
                        <span className="text-emerald-800 dark:text-emerald-300">空檔 {humanMinutes(s.end - s.start)}</span>
                        <Button size="sm" className="ml-auto h-7" onClick={() => openNew(day, s)}>
                          ＋ 提議
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <h2 className="mt-8 mb-2 text-lg font-bold">我提議的行程</h2>
      {mine.length === 0 ? (
        <p className="text-sm text-muted-foreground">還沒有提議過。</p>
      ) : (
        <ul className="space-y-2">
          {mine.map((p) => (
            <li key={p.id} className="rounded-xl border bg-card p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <ProposalStatus status={p.status} />
                <span className="font-medium">{p.title}</span>
                {p.status === "pending" && waitingDays(p.created_at) >= 2 && (
                  <span className="text-xs font-medium text-destructive">超過 2 天還沒審核，可以提醒一下</span>
                )}
                <span className="text-muted-foreground tabular-nums">
                  {fmt(p.starts_at, "M/d(EEEEE) HH:mm")}–{fmt(p.ends_at, "HH:mm")}
                </span>
              </div>
              {p.location && <div className="mt-1 text-muted-foreground">地點：{p.location}</div>}
              {p.note && <div className="mt-1 text-muted-foreground">備註：{p.note}</div>}
              {p.status === "rejected" && p.review_note && (
                <div className="mt-1 text-destructive">退回原因：{p.review_note}</div>
              )}
              {p.status === "pending" && (
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setForm({
                        id: p.id,
                        calendarId: p.calendar_id,
                        title: p.title,
                        date: fmt(p.starts_at, "yyyy-MM-dd"),
                        start: fmt(p.starts_at, "HH:mm"),
                        end: fmt(p.ends_at, "HH:mm"),
                        location: p.location ?? "",
                        note: p.note ?? "",
                      })
                    }
                  >
                    修改
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => withdraw(p)}>
                    撤回
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <ProposalDialog
        form={form}
        calendars={cals}
        ownerName={ownerName}
        busy={busy}
        onClose={() => setForm(null)}
        onSaved={() => {
          setForm(null);
          refresh();
        }}
      />
    </div>
  );
}
