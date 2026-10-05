"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Banknote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useContactsBilling, isLegacyPlanId } from "@/lib/client/lookups";
import { recordSalaryAction } from "@/lib/actions/finance";
import type { FinanceItem } from "@/lib/client/reports";
import type { RatePlan } from "@/lib/rate-plans";
import { twd, taipeiTodayStr } from "@/lib/date";
import { cn } from "@/lib/utils";

/** 期間內（且不超過本月）的月份 yyyy-MM，新到舊 */
function monthsInPeriod(start: string, end: string): string[] {
  const thisMonth = taipeiTodayStr().slice(0, 7);
  const last = end.slice(0, 7) < thisMonth ? end.slice(0, 7) : thisMonth;
  const months: string[] = [];
  let [y, m] = start.slice(0, 7).split("-").map(Number);
  for (let i = 0; i < 24; i++) {
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    if (ym > last) break;
    months.push(ym);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return months.reverse();
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${y}年${m}月`;
}

interface SalaryRow {
  key: string;
  contactId: string;
  contactName: string;
  plan: RatePlan;
  categoryId: string | null;
  month: string;
  sessions: number;
  calendarId: string | null;
  record: FinanceItem | null;
}

/**
 * 月薪結算：月薪制老師每月記一筆固定月薪（請假可調金額）。
 * 每堂課記為 NT$0（計堂數），錢只在這裡記一次，避免重複計算。
 */
export function SalarySection({
  finance,
  start,
  end,
  fallbackCalendarId,
  onDone,
}: {
  finance: FinanceItem[];
  start: string;
  end: string;
  /** 該月沒有任何上課紀錄時，月薪記到哪個分類 */
  fallbackCalendarId: string | null;
  onDone: () => void;
}) {
  const { data: contacts = [] } = useContactsBilling();
  const [editing, setEditing] = useState<SalaryRow | null>(null);

  const teachers = contacts
    .map((c) => ({ c, plan: c.plans.find((p) => p.billing_mode === "monthly") }))
    .filter((x): x is { c: (typeof contacts)[number]; plan: RatePlan } => !!x.plan);
  if (teachers.length === 0) return null;

  const thisMonth = taipeiTodayStr().slice(0, 7);
  const rows: SalaryRow[] = [];
  for (const month of monthsInPeriod(start, end)) {
    for (const { c, plan } of teachers) {
      const sessions = finance.filter(
        (f) =>
          f.contact_id === c.id &&
          f.event_id &&
          !f.is_prepaid_topup &&
          f.occurred_on.startsWith(month),
      );
      const record =
        finance.find((f) => f.contact_id === c.id && f.salary_month === month) ?? null;
      // 沒上課也沒紀錄的過去月份不列（可能還沒開始請這位老師）
      if (!record && sessions.length === 0 && month !== thisMonth) continue;
      rows.push({
        key: `${c.id}-${month}`,
        contactId: c.id,
        contactName: c.name,
        plan,
        categoryId: c.default_category_id,
        month,
        sessions: sessions.length,
        calendarId: sessions[0]?.calendar_id ?? fallbackCalendarId,
        record,
      });
    }
  }
  if (rows.length === 0) return null;

  return (
    <section>
      <h2 className="mb-2 flex items-center gap-1.5 text-lg font-semibold">
        <Banknote className="size-5" />
        月薪結算
        <span className="text-xs font-normal text-muted-foreground">
          月薪制老師每月記一筆；請假可調整金額
        </span>
      </h2>
      <div className="divide-y overflow-hidden rounded-xl border bg-card">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <div className="font-medium">
                {r.contactName}
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {monthLabel(r.month)}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                上課 {r.sessions} 堂 · 月薪 {twd(r.plan.rate)}
              </div>
            </div>
            {r.record ? (
              <div className="text-right">
                <div className="font-semibold tabular-nums">{twd(r.record.amount)}</div>
                <div
                  className={cn(
                    "text-xs",
                    r.record.is_settled ? "text-emerald-600" : "text-amber-600",
                  )}
                >
                  {r.record.is_settled ? "已結清" : "已記錄・未結清"}
                </div>
              </div>
            ) : (
              <Button size="sm" onClick={() => setEditing(r)} disabled={!r.calendarId}>
                記錄月薪
              </Button>
            )}
          </div>
        ))}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        記錄後會出現在下方「依老師」，可在那裡標記結清；依主角會按當月各小孩上課次數分攤。
      </p>

      <SalaryDialog row={editing} onClose={() => setEditing(null)} onDone={onDone} />
    </section>
  );
}

function SalaryDialog({
  row,
  onClose,
  onDone,
}: {
  row: SalaryRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [initKey, setInitKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // 開啟時帶入預設值（月薪金額、備註）
  if (row && initKey !== row.key) {
    setAmount(String(row.plan.rate));
    setNote(`${monthLabel(row.month)}月薪`);
    setInitKey(row.key);
  }
  if (!row && initKey !== null) setInitKey(null);

  const submit = () => {
    if (!row || !row.calendarId) return;
    startTransition(async () => {
      const res = await recordSalaryAction({
        contactId: row.contactId,
        month: row.month,
        amount: Math.round(Number(amount) || 0),
        calendarId: row.calendarId,
        categoryId: row.categoryId,
        ratePlanId: isLegacyPlanId(row.plan.id) ? null : row.plan.id,
        lessonLabel: row.plan.label,
        note: note.trim() || null,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("已記錄月薪");
      onClose();
      onDone();
    });
  };

  const diff = row ? Math.round(Number(amount) || 0) - row.plan.rate : 0;

  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            記錄月薪：{row?.contactName} {row ? monthLabel(row.month) : ""}
          </DialogTitle>
          <DialogDescription>
            本月上課 {row?.sessions ?? 0} 堂。若有請假或其他扣款，直接修改金額並在備註寫原因。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">金額（TWD）</Label>
            <Input
              type="number"
              min={0}
              step={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            {row && diff !== 0 && (
              <p className="text-xs text-amber-600">
                比月薪{diff < 0 ? "少" : "多"} {twd(Math.abs(diff))}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">備註</Label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="例：10/15 請假一天扣 2,000"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            取消
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? "儲存中…" : "記錄"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
