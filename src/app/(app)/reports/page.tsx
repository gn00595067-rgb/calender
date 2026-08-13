"use client";

import { useMemo, useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  Download,
  TrendingDown,
  TrendingUp,
  CircleAlert,
  BookText,
} from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState, ListSkeleton } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useAppData } from "@/components/app/app-data";
import { can } from "@/lib/permissions";
import {
  useMonthlyFinance,
  useMonthlyNotes,
  type FinanceItem,
} from "@/lib/client/reports";
import { settleFinanceAction } from "@/lib/actions/finance";
import { downloadCsv } from "@/lib/csv";
import { twd, D } from "@/lib/date";
import { cn } from "@/lib/utils";

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

interface Group {
  key: string;
  direction: "expense" | "income";
  category: string;
  contact: string;
  items: FinanceItem[];
  total: number;
  settled: number;
  unsettled: number;
}

export default function ReportsPage() {
  const { calendars, calendarById } = useAppData();
  const financeCals = calendars.filter((c) => can.viewFinance(c.effectiveRole));
  const [month, setMonth] = useState(currentMonth());
  const [scope, setScope] = useState<Set<string>>(new Set());
  const scopeIds = scope.size > 0 ? [...scope] : financeCals.map((c) => c.id);

  const { data: finance = [], isLoading } = useMonthlyFinance(month, scopeIds);
  const { data: notes = [], isLoading: notesLoading } = useMonthlyNotes(month, scopeIds);
  const qc = useQueryClient();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const summary = useMemo(() => {
    let expense = 0;
    let income = 0;
    let unsettledAmount = 0;
    let unsettledCount = 0;
    for (const f of finance) {
      if (f.direction === "expense") expense += f.amount;
      else income += f.amount;
      if (!f.is_settled) {
        unsettledAmount += f.amount;
        unsettledCount += 1;
      }
    }
    return { expense, income, unsettledAmount, unsettledCount };
  }, [finance]);

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    for (const f of finance) {
      const category = f.category_label ?? "未分類";
      const contact = f.contact_name ?? "—";
      const key = `${f.direction}||${category}||${contact}`;
      let g = map.get(key);
      if (!g) {
        g = { key, direction: f.direction, category, contact, items: [], total: 0, settled: 0, unsettled: 0 };
        map.set(key, g);
      }
      g.items.push(f);
      g.total += f.amount;
      if (f.is_settled) g.settled += 1;
      else g.unsettled += 1;
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [finance]);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["report-finance"] });
    router.refresh();
  };

  const settle = (ids: string[], settled: boolean) => {
    if (ids.length === 0) return;
    startTransition(async () => {
      const res = await settleFinanceAction(ids, settled);
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(settled ? "已標記結清" : "已標記未結清");
        await refresh();
      }
    });
  };

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const exportCsv = () => {
    const header = ["日期", "分類", "費用類別", "人物", "行程", "收支", "金額", "結清狀態"];
    const rows = finance.map((f) => [
      f.occurred_on,
      calendarById.get(f.calendar_id ?? "")?.name ?? "",
      f.category_label ?? "",
      f.contact_name ?? "",
      f.event_title ?? "",
      f.direction === "expense" ? "支出" : "收入",
      f.amount,
      f.is_settled ? "已結清" : "未結清",
    ]);
    downloadCsv(`ExecCal_財務明細_${month}.csv`, [header, ...rows]);
  };

  const notesByCalendar = useMemo(() => {
    const m = new Map<string, typeof notes>();
    for (const n of notes) {
      const arr = m.get(n.calendar_id);
      if (arr) arr.push(n);
      else m.set(n.calendar_id, [n]);
    }
    return [...m.entries()];
  }, [notes]);

  if (financeCals.length === 0) {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader title="報表結算" />
        <EmptyState title="沒有可檢視財務的行事曆" description="只有擁有者或編輯者能查看財務報表。" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="報表結算"
        description="每月財務統整、費用結清與教學進度統整。"
        actions={
          <Button variant="outline" onClick={exportCsv} disabled={finance.length === 0}>
            <Download className="size-4" />
            匯出 CSV
          </Button>
        }
      />

      {/* 篩選 */}
      <div className="mb-4 flex flex-col gap-3 rounded-xl border bg-card p-3 sm:flex-row sm:items-center">
        <Input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="h-9 w-44"
          aria-label="選擇月份"
        />
        <div className="flex flex-wrap gap-1.5">
          {financeCals.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() =>
                setScope((prev) => {
                  const next = new Set(prev);
                  if (next.has(c.id)) next.delete(c.id);
                  else next.add(c.id);
                  return next;
                })
              }
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm",
                scope.size === 0 || scope.has(c.id)
                  ? "border-primary bg-primary/10"
                  : "opacity-50 hover:bg-accent",
              )}
            >
              <span className="size-2.5 rounded-full" style={{ backgroundColor: c.color }} />
              {c.name}
            </button>
          ))}
        </div>
      </div>

      {/* 財務總覽卡 */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryCard
          icon={TrendingDown}
          label="本月支出"
          value={twd(summary.expense)}
          tone="expense"
        />
        <SummaryCard
          icon={TrendingUp}
          label="本月收入"
          value={twd(summary.income)}
          tone="income"
        />
        <SummaryCard
          icon={CircleAlert}
          label="未結清"
          value={twd(summary.unsettledAmount)}
          hint={`${summary.unsettledCount} 筆`}
          tone="warn"
        />
      </div>

      {/* 費用明細表 */}
      <section className="mb-8">
        <h2 className="mb-2 text-lg font-semibold">費用明細（依類別 × 人物）</h2>
        {isLoading ? (
          <ListSkeleton rows={4} />
        ) : groups.length === 0 ? (
          <EmptyState title="本月沒有財務紀錄" description="於行程中掛上收支後，會在此統整。" />
        ) : (
          <div className="divide-y overflow-hidden rounded-xl border bg-card">
            {groups.map((g) => {
              const open = expanded.has(g.key);
              const unsettledIds = g.items.filter((i) => !i.is_settled).map((i) => i.id);
              return (
                <div key={g.key}>
                  <div className="flex items-center gap-2 p-3">
                    <button
                      type="button"
                      onClick={() => toggleExpand(g.key)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      {open ? (
                        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 font-medium">
                          {g.category}
                          <span className="text-sm text-muted-foreground">／{g.contact}</span>
                          {g.direction === "income" && (
                            <Badge variant="secondary" className="text-xs">收入</Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {g.items.length} 筆 · 已結清 {g.settled} · 未結清 {g.unsettled}
                        </div>
                      </div>
                      <div className="shrink-0 text-right font-semibold tabular-nums">
                        {twd(g.total)}
                      </div>
                    </button>
                    {unsettledIds.length > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={pending}
                        onClick={() => settle(unsettledIds, true)}
                      >
                        本組全部結清
                      </Button>
                    )}
                  </div>

                  {open && (
                    <div className="border-t bg-muted/20">
                      {g.items
                        .slice()
                        .sort((a, b) => a.occurred_on.localeCompare(b.occurred_on))
                        .map((item) => (
                          <label
                            key={item.id}
                            className="flex items-center gap-3 border-b px-3 py-2 pl-9 text-sm last:border-b-0"
                          >
                            <Checkbox
                              checked={item.is_settled}
                              disabled={pending}
                              onCheckedChange={(c) => settle([item.id], !!c)}
                            />
                            <span className="w-20 shrink-0 tabular-nums text-muted-foreground">
                              {item.occurred_on.slice(5)}
                            </span>
                            <span className="min-w-0 flex-1 truncate">
                              {item.event_title ?? item.note ?? "（無關聯行程）"}
                            </span>
                            <span className="shrink-0 tabular-nums">{twd(item.amount)}</span>
                            <span
                              className={cn(
                                "w-14 shrink-0 text-right text-xs",
                                item.is_settled ? "text-emerald-600" : "text-amber-600",
                              )}
                            >
                              {item.is_settled ? "已結清" : "未結清"}
                            </span>
                          </label>
                        ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 進度統整 */}
      <section>
        <h2 className="mb-2 flex items-center gap-1.5 text-lg font-semibold">
          <BookText className="size-5" />
          進度統整（本月回饋）
        </h2>
        {notesLoading ? (
          <ListSkeleton rows={3} />
        ) : notesByCalendar.length === 0 ? (
          <EmptyState title="本月沒有回饋紀錄" description="家教或協作者填寫回饋後，會依行事曆分組統整於此。" />
        ) : (
          <div className="space-y-4">
            {notesByCalendar.map(([calId, list]) => (
              <div key={calId} className="rounded-xl border bg-card p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span
                    className="size-3 rounded-full"
                    style={{ backgroundColor: calendarById.get(calId)?.color ?? "#64748B" }}
                  />
                  <h3 className="font-semibold">{calendarById.get(calId)?.name ?? "分類"}</h3>
                  <Badge variant="secondary">{list.length} 則</Badge>
                </div>
                <ol className="relative space-y-3 border-l pl-4">
                  {list.map((n) => (
                    <li key={n.id} className="relative">
                      <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-primary" />
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{n.event_title}</span>
                        <span>{D.date(n.event_start)}</span>
                        <span>· {n.authorName}</span>
                        {n.progress_label && (
                          <Badge variant="outline" className="ml-auto">
                            {n.progress_label}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-sm">{n.content}</p>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
  tone: "expense" | "income" | "warn";
}) {
  const toneClass =
    tone === "expense"
      ? "text-rose-600"
      : tone === "income"
        ? "text-emerald-600"
        : "text-amber-600";
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className={cn("size-4", toneClass)} />
        {label}
      </div>
      <div className={cn("mt-1 text-2xl font-bold tabular-nums", toneClass)}>{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
