"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Briefcase, ChevronLeft, ChevronRight, FileSpreadsheet, Settings2 } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { WorkImportDialog } from "@/components/work/import-dialog";
import { WorkSetupDialog } from "@/components/work/setup-dialog";
import { useContacts } from "@/lib/client/lookups";
import { useWorkLogs, useWorkPeople, useWorkSetup } from "@/lib/client/work";
import { setWorkLogCategoryAction } from "@/lib/actions/work";
import { taipeiTodayStr, twd } from "@/lib/date";
import { cn } from "@/lib/utils";

const WD = ["日", "一", "二", "三", "四", "五", "六"];

function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const h1 = (n: number) => Math.round(n * 10) / 10;

/**
 * 工作效益：匯入員工（Phoenix）的工作報告 Excel，依工作分類的暫訂時薪算出當月工作價值，
 * 跟月薪比對是否達標。spec：docs/specs/工作紀錄匯入與效益.md
 */
export default function WorkPage() {
  const qc = useQueryClient();
  const thisMonth = taipeiTodayStr().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const { data: contacts = [] } = useContacts();
  const people = useWorkPeople();
  const [pick, setPick] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [showDetail, setShowDetail] = useState(false);

  const staff = contacts.filter((c) => !c.is_family);
  const peopleIds = people.data ?? [];
  // 預設：有設定的第一位（通常是 Phoenix）
  const contactId = pick ?? peopleIds[0] ?? null;
  const contact = contacts.find((c) => c.id === contactId) ?? null;
  const setup = useWorkSetup(contactId);
  const logs = useWorkLogs(contactId, month);
  const categories = useMemo(() => setup.data?.categories ?? [], [setup.data]);
  const salary = setup.data?.monthlySalary ?? null;

  const stats = useMemo(() => {
    const list = logs.data ?? [];
    const byCat = new Map<string | null, { hours: number; count: number }>();
    for (const l of list) {
      const k = categories.some((c) => c.id === l.category_id) ? l.category_id : null;
      const cur = byCat.get(k) ?? { hours: 0, count: 0 };
      byCat.set(k, { hours: cur.hours + l.hours, count: cur.count + 1 });
    }
    const rows = categories.map((c) => {
      const s = byCat.get(c.id) ?? { hours: 0, count: 0 };
      return { cat: c, ...s, value: Math.round(s.hours * c.hourly_rate) };
    });
    const unclassified = byCat.get(null) ?? { hours: 0, count: 0 };
    const totalHours = list.reduce((s, l) => s + l.hours, 0);
    const value = rows.reduce((s, r) => s + r.value, 0);
    return { rows, unclassified, totalHours, value, count: list.length };
  }, [logs.data, categories]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["work"] });
  const pct = salary ? Math.round((stats.value / salary) * 100) : null;
  const [y, m] = month.split("-").map(Number);

  async function changeCategory(id: string, categoryId: string) {
    const res = await setWorkLogCategoryAction(id, categoryId || null);
    if (!res.ok) toast.error(res.error);
    else refresh();
  }

  if (people.data === null) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="工作效益" />
        <EmptyState
          icon={Briefcase}
          title="資料庫還沒更新"
          description="請先在 Supabase SQL Editor 套用 0018_work_logs.sql。"
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="工作效益"
        description="匯入工作報告 Excel，依工作分類時薪算出當月工作價值，跟月薪比對"
        actions={
          contactId ? (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setSetupOpen(true)}>
                <Settings2 className="size-4" />
                月薪與分類
              </Button>
              <Button onClick={() => setImportOpen(true)} disabled={categories.length === 0}>
                <FileSpreadsheet className="size-4" />
                匯入 Excel
              </Button>
            </div>
          ) : undefined
        }
      />

      {/* 對象 */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {peopleIds.map((id) => {
          const c = contacts.find((x) => x.id === id);
          if (!c) return null;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setPick(id)}
              className={cn(
                "rounded-full border px-4 py-1.5 text-sm",
                id === contactId ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
              )}
            >
              {c.name}
            </button>
          );
        })}
        <select
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value=""
          onChange={(e) => e.target.value && setPick(e.target.value)}
          aria-label="其他人"
        >
          <option value="">＋ 其他人…</option>
          {staff
            .filter((c) => !peopleIds.includes(c.id))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
      </div>

      {!contactId ? (
        <EmptyState icon={Briefcase} title="選一位要看工作效益的人" />
      ) : setup.isLoading ? (
        <ListSkeleton rows={4} />
      ) : setup.error ? (
        <ErrorState message={(setup.error as Error).message} onRetry={() => setup.refetch()} />
      ) : categories.length === 0 ? (
        <EmptyState
          icon={Settings2}
          title={`還沒設定 ${contact?.name ?? ""} 的工作分類`}
          description="先設定月薪和工作分類（大項、時薪），才能匯入工作報告。"
          action={<Button onClick={() => setSetupOpen(true)}>設定月薪與分類</Button>}
        />
      ) : (
        <>
          {/* 月份 */}
          <div className="mb-3 flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="上個月">
              <ChevronLeft className="size-4" />
            </Button>
            <span className="min-w-24 text-center font-semibold">
              {y}年{m}月
            </span>
            <Button variant="outline" size="icon" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="下個月">
              <ChevronRight className="size-4" />
            </Button>
            {month !== thisMonth && (
              <Button variant="ghost" size="sm" onClick={() => setMonth(thisMonth)}>
                本月
              </Button>
            )}
          </div>

          {logs.isLoading ? (
            <ListSkeleton rows={4} />
          ) : stats.count === 0 ? (
            <EmptyState
              icon={FileSpreadsheet}
              title={`${m} 月還沒有工作紀錄`}
              description={`把 ${contact?.name ?? ""} 的工作報告 Excel 匯入就會算出來。`}
              action={<Button onClick={() => setImportOpen(true)}>匯入 Excel</Button>}
            />
          ) : (
            <div className="space-y-4">
              {/* 摘要 */}
              <div className="rounded-xl border bg-card p-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="工作時數" value={`${h1(stats.totalHours)} 小時`} sub={`${stats.count} 筆`} />
                  <Stat label="工作價值" value={twd(stats.value)} sub="時數 × 分類時薪" />
                  <Stat label="月薪" value={salary != null ? twd(salary) : "未設定"} />
                  <Stat
                    label="換算時薪"
                    value={salary && stats.totalHours ? twd(salary / stats.totalHours) : "—"}
                    sub="月薪 ÷ 工作時數"
                  />
                </div>
                {pct != null && (
                  <div className="mt-4">
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className={cn("font-semibold", pct >= 100 ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400")}>
                        {pct >= 100
                          ? `已達到月薪標準（${pct}%）`
                          : `達到月薪的 ${pct}%，還差 ${twd(salary! - stats.value)}`}
                      </span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn("h-full rounded-full", pct >= 100 ? "bg-emerald-500" : "bg-amber-500")}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                  </div>
                )}
                {stats.unclassified.hours > 0 && (
                  <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
                    有 {h1(stats.unclassified.hours)} 小時（{stats.unclassified.count} 筆）未分類，沒有算進工作價值；可在下方明細選分類。
                  </p>
                )}
              </div>

              {/* 各分類 */}
              <div className="overflow-hidden rounded-xl border bg-card">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      <th className="p-2 text-left font-medium">大項</th>
                      <th className="p-2 text-right font-medium">時數</th>
                      <th className="p-2 text-right font-medium">時薪</th>
                      <th className="p-2 text-right font-medium">價值</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.rows.map((r) => (
                      <tr key={r.cat.id} className={cn("border-t", r.hours === 0 && "text-muted-foreground")}>
                        <td className="p-2">
                          <div className="font-medium">{r.cat.name}</div>
                          {r.cat.sub_label && r.cat.sub_label !== r.cat.name && (
                            <div className="text-xs text-muted-foreground">{r.cat.sub_label}</div>
                          )}
                        </td>
                        <td className="p-2 text-right tabular-nums">{r.hours ? h1(r.hours) : "—"}</td>
                        <td className="p-2 text-right tabular-nums">{r.cat.hourly_rate}</td>
                        <td className="p-2 text-right tabular-nums">{r.value ? twd(r.value) : "—"}</td>
                      </tr>
                    ))}
                    {stats.unclassified.hours > 0 && (
                      <tr className="border-t text-amber-700 dark:text-amber-400">
                        <td className="p-2">未分類</td>
                        <td className="p-2 text-right tabular-nums">{h1(stats.unclassified.hours)}</td>
                        <td className="p-2 text-right">—</td>
                        <td className="p-2 text-right">不計</td>
                      </tr>
                    )}
                    <tr className="border-t bg-muted/30 font-semibold">
                      <td className="p-2">合計</td>
                      <td className="p-2 text-right tabular-nums">{h1(stats.totalHours)}</td>
                      <td className="p-2" />
                      <td className="p-2 text-right tabular-nums">{twd(stats.value)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* 明細 */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowDetail((s) => !s)}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  {showDetail ? "收合明細" : `看明細（${stats.count} 筆）`}
                </button>
                {showDetail && (
                  <ul className="mt-2 divide-y rounded-xl border bg-card">
                    {(logs.data ?? []).map((l) => {
                      const d = new Date(`${l.work_date}T12:00:00Z`);
                      return (
                        <li key={l.id} className="space-y-1 p-2.5 text-sm">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {d.getUTCMonth() + 1}/{d.getUTCDate()}（{WD[d.getUTCDay()]}）
                              {l.start_time ? ` ${l.start_time}–${l.end_time ?? ""}` : ""} · {h1(l.hours)} 小時
                            </span>
                            <select
                              className={cn(
                                "h-8 max-w-40 rounded-md border bg-background px-1.5 text-xs",
                                !categories.some((c) => c.id === l.category_id) && "border-amber-500",
                              )}
                              value={categories.some((c) => c.id === l.category_id) ? l.category_id! : ""}
                              onChange={(e) => void changeCategory(l.id, e.target.value)}
                              aria-label="分類"
                            >
                              <option value="">未分類</option>
                              {categories.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>{l.content || "（沒寫內容）"}</div>
                          {l.category_raw && (
                            <div className="text-xs text-muted-foreground">Excel 類別：{l.category_raw}</div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {contactId && (
        <>
          <WorkImportDialog
            open={importOpen}
            onOpenChange={setImportOpen}
            contactId={contactId}
            contactName={contact?.name ?? ""}
            categories={categories}
            onImported={(months) => {
              refresh();
              // 跳到匯入的最新月份
              if (months.length) setMonth(months[months.length - 1]);
            }}
          />
          <WorkSetupDialog
            key={`${contactId}-${setupOpen}`}
            open={setupOpen}
            onOpenChange={setSetupOpen}
            contactId={contactId}
            contactName={contact?.name ?? ""}
            categories={categories}
            monthlySalary={salary}
            onSaved={refresh}
          />
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-bold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
