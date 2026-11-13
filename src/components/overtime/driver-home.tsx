"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Car, Clock, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ListSkeleton } from "@/components/app/states";
import {
  deleteOvertime,
  useDriverLink,
  useDriverTrips,
  useOvertime,
  useTaiwanHolidays,
  type DriverLink,
  type OvertimeRow,
} from "@/lib/client/overtime";
import { submitOvertimeAction } from "@/lib/actions/drivers";
import { driverLegs, groupLegsByDay, legLine, type DriverLeg } from "@/lib/driver";
import {
  D,
  taipeiDateEndExclusiveUtcISO,
  taipeiDateStartUtcISO,
  taipeiTodayStr,
  twd,
} from "@/lib/date";
import {
  DAY_KIND_LABEL,
  DEFAULT_DRIVER_SALARY,
  DRIVER_SHIFTS,
  dayKind,
  dayOvertimeMinutes,
  dayWarning,
  hm,
  minutesText,
  overtimeFees,
  toMinutes,
  weekdayOf,
} from "@/lib/driver-overtime";
import { MonthNav, OvertimeItem, dateLabel, monthRange } from "./overtime-parts";
import { cn } from "@/lib/utils";

type Tab = "trips" | "fill" | "mine";

function addDays(ds: string, n: number): string {
  const d = new Date(`${ds}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

interface Draft {
  id: string | null;
  workDate: string;
  start: string;
  end: string;
  reason: string;
  eventId: string | null;
}

function blankDraft(date: string): Draft {
  // Peggy 的例子：17:30 下班後出車 → 加班從下班時間起算
  const shift = DRIVER_SHIFTS[weekdayOf(date)];
  return { id: null, workDate: date, start: shift?.end ?? "", end: "", reason: "", eventId: null };
}

/** 回程車上送回家的時間：行程結束＋單程車程（司機接送設定的車程） */
function legArrival(leg: DriverLeg, pickupMinutes: number): string {
  return D.time(new Date(new Date(leg.at).getTime() + pickupMinutes * 60000));
}

/**
 * 司機端首頁（/drive）：今天班表、接送行程、填加班、我的加班。
 * spec：docs/specs/司機打卡與加班費.md
 */
export function DriverHome() {
  const linkQ = useDriverLink();
  if (linkQ.isLoading) return <ListSkeleton rows={4} />;
  if (linkQ.isError || !linkQ.data)
    return (
      <EmptyState
        icon={Car}
        title="讀不到司機資料"
        description={linkQ.error instanceof Error ? linkQ.error.message : "請聯絡 Peggy"}
      />
    );
  return <DriverHomeInner link={linkQ.data} />;
}

function DriverHomeInner({ link }: { link: DriverLink }) {
  const qc = useQueryClient();
  const today = taipeiTodayStr();
  const [tab, setTab] = useState<Tab>("trips");
  const [ym, setYm] = useState(today.slice(0, 7));
  const [draft, setDraft] = useState<Draft>(() => blankDraft(today));
  const [pending, startTransition] = useTransition();

  const year = Number(today.slice(0, 4));
  const holidaysQ = useTaiwanHolidays([year, Number(ym.slice(0, 4)), Number(draft.workDate.slice(0, 4)) || year]);
  const holidays = useMemo(() => holidaysQ.data ?? new Map<string, string>(), [holidaysQ.data]);

  const tripFrom = taipeiDateStartUtcISO(today);
  const tripTo = taipeiDateEndExclusiveUtcISO(addDays(today, 6));
  const tripsQ = useDriverTrips(tripFrom, tripTo);
  const legs = useMemo(
    () => (tripsQ.data ?? []).flatMap(driverLegs).filter((l) => l.at >= tripFrom && l.at < tripTo),
    [tripsQ.data, tripFrom, tripTo],
  );
  const pickupOf = (eventId: string) =>
    tripsQ.data?.find((e) => e.id === eventId)?.driver?.pickupMinutes ?? 0;

  const range = monthRange(ym);
  const rowsQ = useOvertime({ contactId: link.contactId }, range);
  const rows = useMemo(() => rowsQ.data ?? [], [rowsQ.data]);
  // 今天的申請（月份切走也要知道今天填了沒）
  const todayQ = useOvertime({ contactId: link.contactId }, { from: today, to: today });
  const salary = link.salary ?? DEFAULT_DRIVER_SALARY;
  const calcs = useMemo(() => overtimeFees(rows, salary, holidays), [rows, salary, holidays]);

  const todayKind = dayKind(today, holidays);
  const todayShift = DRIVER_SHIFTS[weekdayOf(today)];

  // 提醒：今天有接送送回來時已過下班時間，但今天還沒填加班（Elsa：當天就要確認，否則會忘記）
  const lateLeg = (() => {
    if (!todayShift || (todayQ.data ?? []).length > 0) return null;
    const end = toMinutes(todayShift.end);
    return (
      legs
        .filter((l) => l.kind === "from" && !l.allDay && D.date(l.at) === D.date(tripFrom))
        .map((l) => ({ leg: l, arrive: legArrival(l, pickupOf(l.eventId)) }))
        .filter((x) => toMinutes(x.arrive) > end)
        .sort((a, b) => b.arrive.localeCompare(a.arrive))[0] ?? null
    );
  })();

  const fillFromLeg = (leg: DriverLeg, arrive: string) => {
    const date = new Date(leg.at).toLocaleString("sv-SE", { timeZone: "Asia/Taipei" }).slice(0, 10);
    const base = blankDraft(date);
    setDraft({
      ...base,
      end: arrive,
      reason: `接送${leg.passengers === "本人" ? "" : leg.passengers}${leg.title}（${leg.to === "家" ? `${leg.from}回家` : `${leg.from}→${leg.to}`}）`,
      eventId: leg.eventId,
    });
    setTab("fill");
  };

  const editRow = (r: OvertimeRow) => {
    setDraft({
      id: r.id,
      workDate: r.work_date,
      start: hm(r.start_time),
      end: hm(r.end_time),
      reason: r.reason,
      eventId: r.event_id,
    });
    setTab("fill");
  };

  const submit = () =>
    startTransition(async () => {
      const r = await submitOvertimeAction({ ...draft, contactId: link.contactId });
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.data.notified ? "已送出，已通知 Peggy 核准" : "已送出，等 Peggy 核准");
      await qc.invalidateQueries({ queryKey: ["overtime"] });
      setYm(draft.workDate.slice(0, 7));
      setDraft(blankDraft(today));
      setTab("mine");
    });

  const remove = (r: OvertimeRow) =>
    startTransition(async () => {
      const err = await deleteOvertime(r.id);
      if (err) return void toast.error(err);
      toast.success("已刪除");
      await qc.invalidateQueries({ queryKey: ["overtime"] });
    });

  // 填寫預覽
  const draftKind = draft.workDate ? dayKind(draft.workDate, holidays) : "workday";
  const draftShift = draft.workDate ? DRIVER_SHIFTS[weekdayOf(draft.workDate)] : null;
  const draftValid = !!draft.workDate && !!draft.start && !!draft.end && draft.end > draft.start;
  const preview = useMemo(() => {
    if (!draftValid) return null;
    const others = rows.filter((r) => r.id !== draft.id);
    const me = { id: "__draft", work_date: draft.workDate, start_time: draft.start, end_time: draft.end, status: "pending" as const };
    return overtimeFees([...others, me], salary, holidays).get("__draft") ?? null;
  }, [draftValid, rows, draft, salary, holidays]);
  const overlapsShift =
    draftValid &&
    draftKind === "workday" &&
    !!draftShift &&
    draft.start < draftShift.end &&
    draftShift.start < draft.end;

  const approvedFee = rows
    .filter((r) => r.status === "approved")
    .reduce((s, r) => s + (calcs.get(r.id)?.fee ?? 0), 0);
  const approvedMin = rows
    .filter((r) => r.status === "approved")
    .reduce((s, r) => s + (calcs.get(r.id)?.minutes ?? 0), 0);
  const pendingCount = rows.filter((r) => r.status === "pending").length;

  const tabs: { key: Tab; label: string }[] = [
    { key: "trips", label: "接送行程" },
    { key: "fill", label: draft.id ? "修改加班" : "填加班" },
    { key: "mine", label: "我的加班" },
  ];

  return (
    <div className="space-y-4">
      {/* 今天 */}
      <div className="rounded-xl border bg-card p-4">
        <div className="text-sm text-muted-foreground">今天 {dateLabel(today)}</div>
        {holidays.has(today) ? (
          <div className="text-lg font-semibold text-rose-600">{holidays.get(today)}（國定假日休息）</div>
        ) : todayShift ? (
          <div className="text-lg font-semibold">
            上班 {todayShift.start}–{todayShift.end}
            <span className="ml-2 text-sm font-normal text-muted-foreground">{todayShift.rest}，事情做完再休息</span>
          </div>
        ) : (
          <div className="text-lg font-semibold">今天{DAY_KIND_LABEL[todayKind]}，休息</div>
        )}
      </div>

      {lateLeg ? (
        <div className="space-y-2 rounded-xl border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          <div>
            今天送「{lateLeg.leg.title}」回來約 <b>{lateLeg.arrive}</b>，超過下班 {todayShift?.end}。有加班的話記得今天填：
          </div>
          <Button size="sm" onClick={() => fillFromLeg(lateLeg.leg, lateLeg.arrive)}>
            <Clock className="size-4" />
            填今天的加班
          </Button>
        </div>
      ) : null}

      {holidaysQ.isError ? (
        <div className="text-xs text-rose-600">讀不到政府行事曆，國定假日暫時無法判斷。</div>
      ) : null}

      <div className="flex gap-1 rounded-lg bg-muted p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "flex-1 rounded-md px-3 py-2 text-sm font-medium",
              tab === t.key ? "bg-background shadow-sm" : "text-muted-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "trips" &&
        (tripsQ.isLoading ? (
          <ListSkeleton rows={3} />
        ) : tripsQ.isError ? (
          <div className="text-sm text-destructive">{(tripsQ.error as Error).message}</div>
        ) : legs.length === 0 ? (
          <EmptyState icon={Car} title="未來 7 天沒有接送" description="有新的接送行程會出現在這裡" />
        ) : (
          <div className="space-y-3">
            {groupLegsByDay(legs).map((g) => (
              <div key={g.day} className="rounded-xl border bg-card p-3">
                <div className="mb-1.5 font-medium">{g.label}</div>
                <ul className="space-y-2 text-sm">
                  {g.legs.map((l) => (
                    <li key={`${l.eventId}-${l.kind}`} className="flex items-start justify-between gap-2">
                      <span>{legLine(l, true)}</span>
                      {l.kind === "from" && !l.allDay ? (
                        <button
                          type="button"
                          className="shrink-0 text-xs text-primary underline"
                          onClick={() => fillFromLeg(l, legArrival(l, pickupOf(l.eventId)))}
                        >
                          填加班
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ))}

      {tab === "fill" && (
        <div className="space-y-3 rounded-xl border bg-card p-4">
          <div className="space-y-1.5">
            <Label>日期</Label>
            <Input
              type="date"
              value={draft.workDate}
              onChange={(e) => {
                const d = e.target.value;
                const shift = DRIVER_SHIFTS[weekdayOf(d)];
                // 開始時間還是預設值時，跟著換成那天的下班時間
                const prevShift = DRIVER_SHIFTS[weekdayOf(draft.workDate)];
                const start = draft.start === (prevShift?.end ?? "") ? (shift?.end ?? "") : draft.start;
                setDraft({ ...draft, workDate: d, start });
              }}
            />
            {draft.workDate ? (
              <p className="text-xs text-muted-foreground">
                {holidays.has(draft.workDate)
                  ? `${holidays.get(draft.workDate)}（國定假日）：費用待人工確認`
                  : draftShift
                    ? `${DAY_KIND_LABEL[draftKind]}，下班 ${draftShift.end}`
                    : `${DAY_KIND_LABEL[draftKind]}${draftKind === "sunday" ? "：費用待人工確認" : ""}`}
              </p>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>加班開始</Label>
              <Input type="time" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>加班結束</Label>
              <Input type="time" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>事由（從哪裡到哪裡、做什麼）</Label>
            <Textarea
              rows={2}
              value={draft.reason}
              onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
              placeholder="例：接送小孩上體操（家→體操館，19:00 結束送回）"
            />
          </div>
          {draft.start && draft.end && draft.end <= draft.start ? (
            <p className="text-sm text-destructive">結束時間要晚於開始時間（過半夜請分兩天填）</p>
          ) : null}
          {overlapsShift ? (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              ⚠ 跟上班時間 {draftShift!.start}–{draftShift!.end} 重疊，上班時間內不算加班
            </p>
          ) : null}
          {preview ? (
            <p className="rounded-md bg-muted px-3 py-2 text-sm">
              加班 <b>{minutesText(preview.minutes)}</b>
              {preview.fee === null ? "，費用待人工確認" : `，約 ${twd(preview.fee)}（核准後才算）`}
              {(() => {
                const w = dayWarning(
                  draftKind,
                  dayOvertimeMinutes(rows.filter((r) => r.id !== draft.id), draft.workDate) + preview.minutes,
                );
                return w ? <span className="block text-xs text-rose-600">⚠ {w}</span> : null;
              })()}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button className="flex-1" disabled={pending || !draftValid || !draft.reason.trim()} onClick={submit}>
              {pending ? "送出中…" : draft.id ? "重新送出" : "送出給 Peggy 核准"}
            </Button>
            {draft.id ? (
              <Button variant="outline" onClick={() => setDraft(blankDraft(today))}>
                取消修改
              </Button>
            ) : null}
          </div>
        </div>
      )}

      {tab === "mine" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <MonthNav ym={ym} onChange={setYm} />
            <Button size="sm" variant="outline" onClick={() => (setDraft(blankDraft(today)), setTab("fill"))}>
              <Plus className="size-4" />
              填加班
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-lg border bg-card p-3">
              <div className="text-xs text-muted-foreground">已核准加班</div>
              <div className="font-semibold">{minutesText(approvedMin)}</div>
              <div className="font-semibold">{twd(approvedFee)}</div>
            </div>
            <div className="rounded-lg border bg-card p-3">
              <div className="text-xs text-muted-foreground">本月預估（月薪＋已核准加班）</div>
              <div className="font-semibold">{twd(salary + approvedFee)}</div>
              {pendingCount ? <div className="text-xs text-amber-700">{pendingCount} 筆待核准</div> : null}
            </div>
          </div>
          {rowsQ.isLoading ? (
            <ListSkeleton rows={3} />
          ) : rowsQ.isError ? (
            <div className="text-sm text-destructive">{(rowsQ.error as Error).message}</div>
          ) : rows.length === 0 ? (
            <EmptyState icon={Clock} title="這個月還沒有加班紀錄" description="有加班請當天填寫" />
          ) : (
            rows.map((r) => (
              <OvertimeItem
                key={r.id}
                row={r}
                calc={calcs.get(r.id)}
                holidayName={holidays.get(r.work_date)}
                actions={
                  r.status !== "approved" ? (
                    <>
                      <Button size="sm" variant="outline" onClick={() => editRow(r)}>
                        {r.status === "rejected" ? "修改後重送" : "修改"}
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive" disabled={pending} onClick={() => remove(r)}>
                        刪除
                      </Button>
                    </>
                  ) : null
                }
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
