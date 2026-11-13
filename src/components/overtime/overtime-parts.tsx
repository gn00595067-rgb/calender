"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OvertimeRow } from "@/lib/client/overtime";
import {
  DAY_KIND_LABEL,
  hm,
  minutesText,
  rateLabel,
  weekdayOf,
  type OvertimeCalc,
} from "@/lib/driver-overtime";
import { twd } from "@/lib/date";
import { cn } from "@/lib/utils";

/**
 * 司機加班的共用小元件（司機端、Peggy 端）。
 * spec：docs/specs/司機打卡與加班費.md
 */

const WD = ["日", "一", "二", "三", "四", "五", "六"];

/** 「12/1（二）」 */
export function dateLabel(ds: string): string {
  return `${Number(ds.slice(5, 7))}/${Number(ds.slice(8, 10))}（${WD[weekdayOf(ds)]}）`;
}

export function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
}

export function MonthNav({ ym, onChange }: { ym: string; onChange: (ym: string) => void }) {
  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon" aria-label="上個月" onClick={() => onChange(shiftMonth(ym, -1))}>
        <ChevronLeft className="size-4" />
      </Button>
      <span className="min-w-24 text-center font-medium">
        {ym.slice(0, 4)} 年 {Number(ym.slice(5, 7))} 月
      </span>
      <Button variant="ghost" size="icon" aria-label="下個月" onClick={() => onChange(shiftMonth(ym, 1))}>
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}

const STATUS: Record<OvertimeRow["status"], { label: string; cls: string }> = {
  pending: { label: "待核准", cls: "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  approved: { label: "已核准", cls: "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  rejected: { label: "退回", cls: "border-destructive/50 bg-destructive/10 text-destructive" },
};

export function StatusBadge({ status }: { status: OvertimeRow["status"] }) {
  const s = STATUS[status];
  return <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", s.cls)}>{s.label}</span>;
}

/** 費用文字：國定假日／例假日待人工確認 */
export function feeText(c: OvertimeCalc | undefined): string {
  if (!c) return "—";
  if (c.fee === null) return `${DAY_KIND_LABEL[c.kind]}，費用待確認`;
  return twd(c.fee);
}

/** 一筆加班 */
export function OvertimeItem({
  row,
  calc,
  holidayName,
  warning,
  actions,
}: {
  row: OvertimeRow;
  calc: OvertimeCalc | undefined;
  holidayName?: string;
  warning?: string | null;
  actions?: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{dateLabel(row.work_date)}</span>
        <span className="tabular-nums">
          {hm(row.start_time)}–{hm(row.end_time)}
        </span>
        <StatusBadge status={row.status} />
        {holidayName ? <span className="text-xs text-rose-600">{holidayName}</span> : null}
      </div>
      <div className="text-sm">{row.reason}</div>
      {calc ? (
        <div className="text-sm text-muted-foreground">
          {minutesText(calc.minutes)}
          {calc.parts.length ? `（${calc.parts.map((p) => `${minutesText(p.minutes)}${rateLabel(p.rate)}`).join("＋")}）` : ""}
          {" · "}
          <span className={cn("font-medium", calc.fee === null ? "text-rose-600" : "text-foreground")}>
            {feeText(calc)}
          </span>
          {row.status === "pending" && calc.fee !== null ? "（核准後才算）" : ""}
        </div>
      ) : null}
      {warning ? <div className="text-xs text-rose-600">⚠ {warning}</div> : null}
      {row.review_note ? (
        <div className="rounded bg-muted px-2 py-1 text-xs">回覆：{row.review_note}</div>
      ) : null}
      {actions ? <div className="flex flex-wrap gap-2 pt-1">{actions}</div> : null}
    </div>
  );
}
