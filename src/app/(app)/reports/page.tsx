"use client";

import { useMemo, useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  addWeeks,
  addMonths,
  addYears,
  format,
} from "date-fns";
import {
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Download,
  TrendingDown,
  TrendingUp,
  CircleAlert,
  BookText,
  Users,
  Tags,
  Hash,
  Wallet,
} from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState, ListSkeleton } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useAppData } from "@/components/app/app-data";
import { can } from "@/lib/permissions";
import {
  useFinanceRange,
  useNotesRange,
  useTagStatsRange,
  type FinanceItem,
} from "@/lib/client/reports";
import { settleFinanceAction } from "@/lib/actions/finance";
import { downloadCsv } from "@/lib/csv";
import { twd, D, taipeiTodayStr } from "@/lib/date";
import { PAYMENT_METHOD_LABEL, CATEGORY_GROUPS } from "@/lib/constants";
import { cn } from "@/lib/utils";

type PeriodMode = "week" | "month" | "year";

/** 這筆是否計入「實際支出」（預繳扣抵的每堂不重複計） */
function spendOf(r: FinanceItem): number {
  return r.direction === "expense" && !r.covered_by_prepaid ? r.amount : 0;
}
/** 這筆是否為一堂課（用於次數統計；排除儲值本身） */
function isSession(r: FinanceItem): boolean {
  return !!r.event_id && !r.is_prepaid_topup;
}
function groupLabel(v: string | null): string {
  return CATEGORY_GROUPS.find((g) => g.value === v)?.label ?? "未分群";
}

export default function ReportsPage() {
  const { calendars, calendarById } = useAppData();
  const financeCals = calendars.filter((c) => can.viewFinance(c.effectiveRole));
  const [scope, setScope] = useState<Set<string>>(new Set());
  const scopeIds = scope.size > 0 ? [...scope] : financeCals.map((c) => c.id);

  const [mode, setMode] = useState<PeriodMode>("month");
  const [refDate, setRefDate] = useState(taipeiTodayStr());

  const period = useMemo(() => {
    const d = new Date(`${refDate}T12:00:00`);
    let s: Date;
    let e: Date;
    let label: string;
    if (mode === "week") {
      s = startOfWeek(d, { weekStartsOn: 1 });
      e = endOfWeek(d, { weekStartsOn: 1 });
      label = `${format(s, "yyyy/M/d")} – ${format(e, "M/d")}`;
    } else if (mode === "year") {
      s = startOfYear(d);
      e = endOfYear(d);
      label = format(d, "yyyy 年");
    } else {
      s = startOfMonth(d);
      e = endOfMonth(d);
      label = format(d, "yyyy 年 M 月");
    }
    return { start: format(s, "yyyy-MM-dd"), end: format(e, "yyyy-MM-dd"), label };
  }, [mode, refDate]);

  const shift = (dir: number) => {
    const d = new Date(`${refDate}T12:00:00`);
    const nd =
      mode === "week"
        ? addWeeks(d, dir)
        : mode === "year"
          ? addYears(d, dir)
          : addMonths(d, dir);
    setRefDate(format(nd, "yyyy-MM-dd"));
  };

  const { data: finance = [], isLoading } = useFinanceRange(
    period.start,
    period.end,
    scopeIds,
  );
  const { data: notes = [], isLoading: notesLoading } = useNotesRange(
    period.start,
    period.end,
    scopeIds,
  );
  const { data: tagStats = [] } = useTagStatsRange(
    period.start,
    period.end,
    scopeIds,
  );
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
      expense += spendOf(f);
      if (f.direction === "income") income += f.amount;
      if (!f.is_settled && !f.covered_by_prepaid) {
        unsettledAmount += f.amount;
        unsettledCount += 1;
      }
    }
    return { expense, income, unsettledAmount, unsettledCount };
  }, [finance]);

  // 依老師
  interface ContactGroup {
    key: string;
    name: string;
    total: number;
    sessions: number;
    items: FinanceItem[];
  }
  const byContact = useMemo<ContactGroup[]>(() => {
    const map = new Map<string, ContactGroup>();
    for (const f of finance) {
      const name = f.contact_name ?? "未指定人物";
      let g = map.get(name);
      if (!g) {
        g = { key: name, name, total: 0, sessions: 0, items: [] };
        map.set(name, g);
      }
      g.total += spendOf(f);
      if (isSession(f)) g.sessions += 1;
      g.items.push(f);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [finance]);

  // 依類別（先分群，再分類別）
  interface CatRow {
    name: string;
    total: number;
    count: number;
  }
  interface CatGroup {
    group: string;
    total: number;
    rows: CatRow[];
  }
  const byCategory = useMemo<CatGroup[]>(() => {
    const groups = new Map<string, Map<string, CatRow>>();
    for (const f of finance) {
      if (f.direction !== "expense") continue;
      const g = groupLabel(f.category_group);
      const cat = f.category_name ?? "未分類";
      if (!groups.has(g)) groups.set(g, new Map());
      const rows = groups.get(g)!;
      let row = rows.get(cat);
      if (!row) {
        row = { name: cat, total: 0, count: 0 };
        rows.set(cat, row);
      }
      row.total += spendOf(f);
      if (isSession(f)) row.count += 1;
    }
    return [...groups.entries()]
      .map(([group, rows]) => {
        const list = [...rows.values()].sort((a, b) => b.total - a.total);
        return { group, total: list.reduce((s, r) => s + r.total, 0), rows: list };
      })
      .sort((a, b) => b.total - a.total);
  }, [finance]);

  // 依付款方式
  const byPayment = useMemo(() => {
    const map = new Map<string, { total: number; count: number }>();
    for (const f of finance) {
      if (f.direction !== "expense") continue;
      const key = f.payment_method
        ? PAYMENT_METHOD_LABEL[f.payment_method]
        : "未指定";
      const cur = map.get(key) ?? { total: 0, count: 0 };
      cur.total += spendOf(f);
      if (isSession(f)) cur.count += 1;
      map.set(key, cur);
    }
    return [...map.entries()]
      .map(([label, v]) => ({ label, ...v }))
      .sort((a, b) => b.total - a.total);
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
    const header = [
      "日期",
      "分類",
      "費用類別",
      "人物",
      "行程",
      "付款方式",
      "收支",
      "金額",
      "預繳扣抵",
      "結清狀態",
    ];
    const rows = finance.map((f) => [
      f.occurred_on,
      calendarById.get(f.calendar_id ?? "")?.name ?? "",
      f.category_name ?? "",
      f.contact_name ?? "",
      f.event_title ?? (f.is_prepaid_topup ? "（儲值）" : ""),
      f.payment_method ? PAYMENT_METHOD_LABEL[f.payment_method] : "",
      f.direction === "expense" ? "支出" : "收入",
      f.amount,
      f.covered_by_prepaid ? "是" : "",
      f.is_settled ? "已結清" : "未結清",
    ]);
    downloadCsv(`ExecCal_財務明細_${period.start}_${period.end}.csv`, [
      header,
      ...rows,
    ]);
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
        <EmptyState
          title="沒有可檢視財務的行事曆"
          description="只有擁有者或編輯者能查看財務報表。"
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="報表結算"
        description="依週／月／年統整支出，並依老師、類別、付款方式分組。"
        actions={
          <Button variant="outline" onClick={exportCsv} disabled={finance.length === 0}>
            <Download className="size-4" />
            匯出 CSV
          </Button>
        }
      />

      {/* 期間 + 篩選 */}
      <div className="mb-4 space-y-3 rounded-xl border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-lg border">
            {(
              [
                { k: "week", l: "週" },
                { k: "month", l: "月" },
                { k: "year", l: "年" },
              ] as const
            ).map((m) => (
              <button
                key={m.k}
                type="button"
                onClick={() => setMode(m.k)}
                className={cn(
                  "px-3 py-1.5 text-sm transition",
                  mode === m.k
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-accent",
                )}
              >
                {m.l}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="size-8" onClick={() => shift(-1)}>
              <ChevronLeft className="size-4" />
            </Button>
            <span className="min-w-32 text-center text-sm font-medium tabular-nums">
              {period.label}
            </span>
            <Button variant="outline" size="icon" className="size-8" onClick={() => shift(1)}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => setRefDate(taipeiTodayStr())}
          >
            回今天
          </Button>
        </div>
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

      {/* 總覽卡 */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryCard icon={TrendingDown} label="支出" value={twd(summary.expense)} tone="expense" />
        <SummaryCard icon={TrendingUp} label="收入" value={twd(summary.income)} tone="income" />
        <SummaryCard
          icon={CircleAlert}
          label="未結清"
          value={twd(summary.unsettledAmount)}
          hint={`${summary.unsettledCount} 筆`}
          tone="warn"
        />
      </div>

      {isLoading ? (
        <ListSkeleton rows={5} />
      ) : finance.length === 0 ? (
        <EmptyState title="這段期間沒有財務紀錄" description="於行程中掛上收支後，會在此統整。" />
      ) : (
        <div className="space-y-8">
          {/* 依老師 */}
          <section>
            <h2 className="mb-2 flex items-center gap-1.5 text-lg font-semibold">
              <Users className="size-5" />
              依老師／對象
            </h2>
            <div className="divide-y overflow-hidden rounded-xl border bg-card">
              {byContact.map((g) => {
                const open = expanded.has(g.key);
                const unsettledIds = g.items
                  .filter((i) => !i.is_settled && !i.covered_by_prepaid)
                  .map((i) => i.id);
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
                          <div className="font-medium">{g.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {g.sessions} 堂
                            {unsettledIds.length > 0 && ` · 未結清 ${unsettledIds.length}`}
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
                          全部結清
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
                                disabled={pending || item.covered_by_prepaid}
                                onCheckedChange={(c) => settle([item.id], !!c)}
                              />
                              <span className="w-16 shrink-0 tabular-nums text-muted-foreground">
                                {item.occurred_on.slice(5)}
                              </span>
                              <span className="min-w-0 flex-1 truncate">
                                {item.event_title ??
                                  (item.is_prepaid_topup ? "儲值" : item.note ?? "（無關聯行程）")}
                                {item.category_name && (
                                  <span className="ml-1 text-xs text-muted-foreground">
                                    · {item.category_name}
                                  </span>
                                )}
                              </span>
                              <span className="shrink-0 tabular-nums">{twd(item.amount)}</span>
                              <span
                                className={cn(
                                  "w-16 shrink-0 text-right text-xs",
                                  item.covered_by_prepaid
                                    ? "text-sky-600"
                                    : item.is_settled
                                      ? "text-emerald-600"
                                      : "text-amber-600",
                                )}
                              >
                                {item.covered_by_prepaid
                                  ? "預繳扣抵"
                                  : item.is_settled
                                    ? "已結清"
                                    : "未結清"}
                              </span>
                            </label>
                          ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* 依類別（分群） */}
          <section>
            <h2 className="mb-2 flex items-center gap-1.5 text-lg font-semibold">
              <Tags className="size-5" />
              依費用類別
            </h2>
            <div className="space-y-3">
              {byCategory.map((grp) => (
                <div key={grp.group} className="overflow-hidden rounded-xl border bg-card">
                  <div className="flex items-center justify-between bg-muted/40 px-3 py-2">
                    <span className="font-medium">{grp.group}</span>
                    <span className="font-semibold tabular-nums">{twd(grp.total)}</span>
                  </div>
                  <div className="divide-y">
                    {grp.rows.map((r) => (
                      <div key={r.name} className="flex items-center gap-2 px-3 py-2 text-sm">
                        <span className="min-w-0 flex-1 truncate">{r.name}</span>
                        <span className="text-xs text-muted-foreground">{r.count} 筆</span>
                        <span className="w-24 shrink-0 text-right tabular-nums">{twd(r.total)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* 依付款方式 */}
          <section>
            <h2 className="mb-2 flex items-center gap-1.5 text-lg font-semibold">
              <Wallet className="size-5" />
              依付款方式
            </h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {byPayment.map((p) => (
                <div
                  key={p.label}
                  className="flex items-center justify-between rounded-lg border bg-card px-3 py-2"
                >
                  <div>
                    <div className="text-sm font-medium">{p.label}</div>
                    <div className="text-xs text-muted-foreground">{p.count} 筆</div>
                  </div>
                  <span className="font-semibold tabular-nums">{twd(p.total)}</span>
                </div>
              ))}
            </div>
          </section>

          {/* 依標籤（次數統計） */}
          {tagStats.length > 0 && (
            <section>
              <h2 className="mb-2 flex items-center gap-1.5 text-lg font-semibold">
                <Hash className="size-5" />
                依標籤（次數）
              </h2>
              <div className="flex flex-wrap gap-2">
                {tagStats.map((t) => (
                  <div
                    key={t.name}
                    className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-sm"
                  >
                    <span className="font-medium">#{t.name}</span>
                    <span className="rounded-full bg-primary/10 px-1.5 font-semibold tabular-nums text-primary">
                      {t.count} 次
                    </span>
                    {t.amount > 0 && (
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {twd(t.amount)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* 進度統整 */}
      <section className="mt-8">
        <h2 className="mb-2 flex items-center gap-1.5 text-lg font-semibold">
          <BookText className="size-5" />
          進度統整（本期回饋）
        </h2>
        {notesLoading ? (
          <ListSkeleton rows={3} />
        ) : notesByCalendar.length === 0 ? (
          <EmptyState title="這段期間沒有回饋紀錄" description="家教或協作者填寫回饋後，會依行事曆分組統整於此。" />
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
