"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Clock } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState, ListSkeleton } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppData } from "@/components/app/app-data";
import { MonthNav, OvertimeItem } from "@/components/overtime/overtime-parts";
import {
  reviewOvertime,
  useMyDrivers,
  useOvertime,
  useTaiwanHolidays,
  type OvertimeRow,
} from "@/lib/client/overtime";
import { createClient } from "@/lib/supabase/client";
import { taipeiTodayStr, twd } from "@/lib/date";
import {
  DEFAULT_DRIVER_SALARY,
  MONTH_LIMIT_MINUTES,
  dayKind,
  dayOvertimeMinutes,
  dayWarning,
  minutesText,
  overlaps,
  overtimeFees,
  perMinuteWage,
} from "@/lib/driver-overtime";
import { monthRange } from "@/components/overtime/overtime-parts";

/**
 * 司機加班（Peggy 端）：司機送來的加班申請逐筆核准／退回，月底看合計與預估薪資。
 * 有爭議的直接退回並寫原因，當面談完司機再改。
 * spec：docs/specs/司機打卡與加班費.md
 */
export default function OvertimePage() {
  const { me } = useAppData();
  const qc = useQueryClient();
  const today = taipeiTodayStr();
  const [ym, setYm] = useState(today.slice(0, 7));
  const [driverId, setDriverId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const driversQ = useMyDrivers(me.id);
  const drivers = useMemo(() => driversQ.data ?? [], [driversQ.data]);
  const driver = drivers.find((d) => d.id === driverId) ?? drivers[0] ?? null;

  const range = monthRange(ym);
  const rowsQ = useOvertime({ ownerId: me.id }, range);
  const rows = useMemo(
    () => (rowsQ.data ?? []).filter((r) => !driver || r.contact_id === driver.id),
    [rowsQ.data, driver],
  );
  const holidaysQ = useTaiwanHolidays([Number(ym.slice(0, 4))]);
  const holidays = useMemo(() => holidaysQ.data ?? new Map<string, string>(), [holidaysQ.data]);

  const salary = driver?.salary ?? DEFAULT_DRIVER_SALARY;
  // null＝沒在改，顯示目前月薪
  const [salaryEdit, setSalaryEdit] = useState<string | null>(null);
  const salaryInput = salaryEdit ?? String(salary);
  const calcs = useMemo(() => overtimeFees(rows, salary, holidays), [rows, salary, holidays]);

  const approved = rows.filter((r) => r.status === "approved");
  const pendingRows = rows.filter((r) => r.status === "pending");
  const others = rows.filter((r) => r.status !== "pending");
  const approvedMin = approved.reduce((s, r) => s + (calcs.get(r.id)?.minutes ?? 0), 0);
  const approvedFee = approved.reduce((s, r) => s + (calcs.get(r.id)?.fee ?? 0), 0);
  const manual = approved.filter((r) => calcs.get(r.id)?.fee === null).length;

  const warningOf = (r: OvertimeRow): string | null => {
    const w = dayWarning(dayKind(r.work_date, holidays), dayOvertimeMinutes(rows, r.work_date));
    const clash = rows.some((o) => overlaps(r, o));
    return [w, clash ? "跟同一天另一筆時間重疊" : null].filter(Boolean).join("；") || null;
  };

  const review = (r: OvertimeRow, status: "approved" | "rejected" | "pending") =>
    startTransition(async () => {
      const err = await reviewOvertime(r.id, status, notes[r.id] ?? null);
      if (err) return void toast.error(err);
      toast.success(status === "approved" ? "已核准" : status === "rejected" ? "已退回，司機會看到原因" : "已改回待核准");
      setRejecting(null);
      await qc.invalidateQueries({ queryKey: ["overtime"] });
    });

  const saveSalary = () =>
    startTransition(async () => {
      if (!driver) return;
      const n = Number(salaryInput);
      if (!Number.isFinite(n) || n <= 0) return void toast.error("月薪要是正數");
      const { error } = await createClient().from("contacts").update({ monthly_salary: Math.round(n) }).eq("id", driver.id);
      if (error) return void toast.error(error.message);
      toast.success("月薪已更新，加班費重新計算");
      await qc.invalidateQueries({ queryKey: ["overtime"] });
      setSalaryEdit(null);
    });

  if (driversQ.isLoading) return <ListSkeleton rows={4} />;
  if (driversQ.isError)
    return <div className="text-sm text-destructive">{(driversQ.error as Error).message}</div>;
  if (!driver)
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="司機加班" />
        <EmptyState
          icon={Clock}
          title="還沒有司機帳號"
          description="到「人物管理」編輯司機這位人物，按「建立司機帳號」，把帳密傳給司機。"
        />
      </div>
    );

  const item = (r: OvertimeRow) => (
    <OvertimeItem
      key={r.id}
      row={r}
      calc={calcs.get(r.id)}
      holidayName={holidays.get(r.work_date)}
      warning={warningOf(r)}
      actions={
        r.status === "pending" ? (
          rejecting === r.id ? (
            <div className="flex w-full flex-wrap gap-2">
              <Input
                className="min-w-48 flex-1"
                autoFocus
                placeholder="退回原因（司機看得到），例：19:00 後才算"
                value={notes[r.id] ?? ""}
                onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
              />
              <Button size="sm" variant="destructive" disabled={pending} onClick={() => review(r, "rejected")}>
                確定退回
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRejecting(null)}>
                取消
              </Button>
            </div>
          ) : (
            <>
              <Button size="sm" disabled={pending} onClick={() => review(r, "approved")}>
                核准
              </Button>
              <Button size="sm" variant="outline" onClick={() => setRejecting(r.id)}>
                退回
              </Button>
            </>
          )
        ) : (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => review(r, "pending")}>
            改回待核准
          </Button>
        )
      }
    />
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title="司機加班"
        description="司機自己填加班，送來這裡核准；有爭議就退回並寫原因。"
        actions={<MonthNav ym={ym} onChange={setYm} />}
      />

      {drivers.length > 1 ? (
        <div className="flex flex-wrap gap-1.5">
          {drivers.map((d) => (
            <Button
              key={d.id}
              size="sm"
              variant={d.id === driver.id ? "default" : "outline"}
              onClick={() => (setDriverId(d.id), setSalaryEdit(null))}
            >
              {d.name}
            </Button>
          ))}
        </div>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="待核准" value={`${pendingRows.length} 筆`} tone={pendingRows.length ? "warn" : undefined} />
        <Stat
          label="已核准加班"
          value={minutesText(approvedMin)}
          sub={approvedMin > MONTH_LIMIT_MINUTES ? "⚠ 超過每月 46 小時上限" : "上限 46 小時"}
          tone={approvedMin > MONTH_LIMIT_MINUTES ? "bad" : undefined}
        />
        <Stat
          label="加班費合計"
          value={twd(approvedFee)}
          sub={manual ? `另有 ${manual} 筆假日待人工確認` : undefined}
          tone={manual ? "bad" : undefined}
        />
        <Stat label="預估薪資（未扣勞健保）" value={twd(salary + approvedFee)} />
      </div>

      {holidaysQ.isError ? (
        <div className="text-xs text-rose-600">讀不到政府行事曆，國定假日暫時無法判斷（會當平日算）。</div>
      ) : null}

      {rowsQ.isLoading ? (
        <ListSkeleton rows={3} />
      ) : rowsQ.isError ? (
        <div className="text-sm text-destructive">{(rowsQ.error as Error).message}</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={Clock} title="這個月沒有加班申請" />
      ) : (
        <>
          {pendingRows.length ? (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold">待核准</h2>
              {pendingRows.map(item)}
            </section>
          ) : null}
          {others.length ? (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold">已處理</h2>
              {others.map(item)}
            </section>
          ) : null}
        </>
      )}

      <section className="space-y-2 rounded-xl border bg-card p-3 text-sm">
        <h2 className="font-semibold">{driver.name} 的月薪</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Input className="w-32" inputMode="numeric" value={salaryInput} onChange={(e) => setSalaryEdit(e.target.value)} />
          <Button size="sm" variant="outline" disabled={pending} onClick={saveSalary}>
            儲存
          </Button>
          <span className="text-xs text-muted-foreground">
            時薪 {(perMinuteWage(salary) * 60).toFixed(2)}（月薪÷30÷8），加班按分鐘計：平日前 2 小時 ×1⅓、之後 ×1⅔；
            週一休息日前 2 小時 ×1⅓、3–8 小時 ×1⅔、9 小時起 ×2⅔。國定假日、週日的費用待人資確認後再自動算。
          </span>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "warn" | "bad" }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={
          tone === "warn" ? "font-semibold text-amber-700 dark:text-amber-400" : tone === "bad" ? "font-semibold text-rose-600" : "font-semibold"
        }
      >
        {value}
      </div>
      {sub ? <div className="text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
}
