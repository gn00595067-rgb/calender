"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, FileSpreadsheet, Pencil, Plus, Printer, Sparkles, Trash2 } from "lucide-react";
import { WorkImportDialog } from "./import-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ListSkeleton } from "@/components/app/states";
import { cn } from "@/lib/utils";
import { taipeiNowWall, taipeiTodayStr } from "@/lib/date";
import {
  useStaffCategories,
  useStaffLogs,
  useWeeklyReport,
  type StaffCategory,
  type StaffLog,
} from "@/lib/client/staff";
import { deleteWorkLogAction, saveWeeklyReportAction, saveWorkLogAction } from "@/lib/actions/staff-work";
import { addDays, groupOf, groupStats, hoursBetween, mondayOf, pctText } from "@/lib/work-groups";

/**
 * 家庭老師的「工作紀錄（每日分時表）」與「週報」。家長（工作效益）與老師（我的工作）共用。
 * spec：docs/specs/Elsa需求-多人權限與家庭老師報告.md
 */

const WD = ["日", "一", "二", "三", "四", "五", "六"];
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const wd = (d: string) => WD[new Date(`${d}T12:00:00Z`).getUTCDay()];

export function StaffWorkspace({
  people,
  defaultTab = "logs",
  asStaff = false,
}: {
  /** 可以看／記的人（家長：自己的員工；老師：自己） */
  people: { id: string; name: string }[];
  defaultTab?: "logs" | "report";
  /** 家庭老師自己用（我的工作）：匯入說明不提錢 */
  asStaff?: boolean;
}) {
  const today = taipeiTodayStr();
  const [pick, setPick] = useState<string | null>(null);
  const [weekStart, setWeekStart] = useState(mondayOf(today));
  const [tab, setTab] = useState(defaultTab);
  const [importOpen, setImportOpen] = useState(false);
  const qc = useQueryClient();
  const contactId = pick ?? people[0]?.id ?? null;
  const weekEnd = addDays(weekStart, 6);
  const cats = useStaffCategories(contactId);
  const logs = useStaffLogs(contactId, weekStart, weekEnd);

  return (
    <div className="space-y-3">
      {people.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {people.map((p) => (
            <Button
              key={p.id}
              size="sm"
              className="rounded-full"
              variant={p.id === contactId ? "default" : "outline"}
              onClick={() => setPick(p.id)}
            >
              {p.name}
            </Button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 print:hidden">
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
          {md(weekStart)}–{md(weekEnd)}
        </span>
        <Button variant="outline" className="ml-auto" onClick={() => setImportOpen(true)} disabled={!contactId}>
          <FileSpreadsheet className="size-4" />
          匯入 Excel
        </Button>
        <div className="flex rounded-md border p-0.5">
          {(
            [
              ["logs", "每日紀錄"],
              ["report", "週報"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={cn("rounded px-3 py-1 text-sm", tab === k ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {contactId && (
        <WorkImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          contactId={contactId}
          contactName={people.find((p) => p.id === contactId)?.name ?? ""}
          categories={cats.data ?? []}
          staffMode={asStaff}
          onImported={(_months, lastDate) => {
            qc.invalidateQueries({ queryKey: ["staff"] });
            qc.invalidateQueries({ queryKey: ["work"] });
            // 跳到最後一筆那一週，馬上看得到匯入的內容
            if (lastDate) setWeekStart(mondayOf(lastDate));
          }}
        />
      )}

      {!contactId ? null : cats.isLoading || logs.isLoading ? (
        <ListSkeleton rows={5} />
      ) : cats.isError ? (
        <p className="text-sm text-destructive">讀不到工作類別：{(cats.error as Error).message}</p>
      ) : tab === "logs" ? (
        <DailyLogs
          contactId={contactId}
          weekStart={weekStart}
          categories={cats.data ?? []}
          logs={logs.data ?? []}
        />
      ) : (
        <WeeklyReport
          contactId={contactId}
          name={people.find((p) => p.id === contactId)?.name ?? ""}
          weekStart={weekStart}
          categories={cats.data ?? []}
          logs={logs.data ?? []}
        />
      )}
    </div>
  );
}

// ---------------- 每日紀錄 ----------------

interface Draft {
  id?: string;
  workDate: string;
  start: string;
  end: string;
  categoryId: string;
  subLabel: string;
  content: string;
}

function DailyLogs({
  contactId,
  weekStart,
  categories,
  logs,
}: {
  contactId: string;
  weekStart: string;
  categories: StaffCategory[];
  logs: StaffLog[];
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, startTransition] = useTransition();
  const catById = new Map(categories.map((c) => [c.id, c]));
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const refresh = () => qc.invalidateQueries({ queryKey: ["staff"] });

  function newFor(day: string) {
    const dayLogs = logs.filter((l) => l.work_date === day && l.end_time);
    // 預設接在上一筆後面；沒有就用現在（今天）或 17:00
    const last = dayLogs.at(-1)?.end_time?.slice(0, 5);
    const now = taipeiNowWall();
    const start = last ?? (day === now.slice(0, 10) ? now.slice(11, 16) : "17:00");
    const [h, m] = start.split(":").map(Number);
    const end = `${String(Math.min(23, h + (m >= 30 ? 1 : 0))).padStart(2, "0")}:${m >= 30 ? "00" : "30"}`;
    setDraft({ workDate: day, start, end, categoryId: dayLogs.at(-1)?.category_id ?? "", subLabel: "", content: "" });
  }

  function save() {
    if (!draft) return;
    startTransition(async () => {
      const res = await saveWorkLogAction({ ...draft, contactId, categoryId: draft.categoryId || null });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("已記錄");
      setDraft(null);
      refresh();
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const res = await deleteWorkLogAction(id);
      if (!res.ok) toast.error(res.error);
      else refresh();
    });
  }

  const groups = [...new Set(categories.map((c) => groupOf(c)))];
  const weekHours = logs.reduce((s, l) => s + l.hours, 0);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        本週合計 <b className="text-foreground">{weekHours.toFixed(2)}</b> 小時。到班時做完一件事記一筆；已經用 Excel 記的，按上面「匯入 Excel」。
      </p>
      {categories.length === 0 && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          還沒有工作類別，請先請家長設定。
        </p>
      )}
      {days.map((day) => {
        const dayLogs = logs.filter((l) => l.work_date === day);
        const editingHere = draft && draft.workDate === day;
        return (
          <section key={day} className="rounded-xl border bg-card p-3">
            <div className="mb-2 flex items-center gap-2">
              <h3 className="font-bold">
                {md(day)}（{wd(day)}）
              </h3>
              {dayLogs.length > 0 && (
                <span className="text-xs text-muted-foreground">{dayLogs.reduce((s, l) => s + l.hours, 0).toFixed(2)} 小時</span>
              )}
              <Button size="sm" variant="outline" className="ml-auto h-7" onClick={() => newFor(day)}>
                <Plus className="size-3.5" />
                記一筆
              </Button>
            </div>
            <ul className="space-y-1.5">
              {dayLogs.map((l) => (
                <li key={l.id} className="flex items-start gap-2 rounded-md bg-muted/50 px-2.5 py-1.5 text-sm">
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {l.start_time?.slice(0, 5) ?? "—"}–{l.end_time?.slice(0, 5) ?? "—"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="mr-1 rounded bg-background px-1.5 text-xs">
                      {l.category_id ? catById.get(l.category_id)?.name : (l.category_raw ?? "未分類")}
                      {l.sub_label ? `・${l.sub_label}` : ""}
                    </span>
                    {l.content}
                  </span>
                  <button
                    type="button"
                    aria-label="修改"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      setDraft({
                        id: l.id,
                        workDate: l.work_date,
                        start: l.start_time?.slice(0, 5) ?? "17:00",
                        end: l.end_time?.slice(0, 5) ?? "18:00",
                        categoryId: l.category_id ?? "",
                        subLabel: l.sub_label ?? "",
                        content: l.content ?? "",
                      })
                    }
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="刪除"
                    className="text-muted-foreground hover:text-destructive"
                    disabled={pending}
                    onClick={() => remove(l.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
              {dayLogs.length === 0 && !editingHere && <li className="text-sm text-muted-foreground">沒有紀錄</li>}
            </ul>
            {editingHere && draft && (
              <div className="mt-2 space-y-2 rounded-lg border border-primary/40 p-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">開始</Label>
                    <Input type="time" step={300} value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">
                      結束
                      {draft.start && draft.end && (
                        <span className="ml-1 font-normal text-muted-foreground">
                          {hoursBetween(draft.start, draft.end).toFixed(2)} 小時
                        </span>
                      )}
                    </Label>
                    <Input type="time" step={300} value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">類別</Label>
                  <select
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    value={draft.categoryId}
                    onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}
                  >
                    <option value="">（不分類）</option>
                    {groups.map((g) => (
                      <optgroup key={g} label={g}>
                        {categories
                          .filter((c) => groupOf(c) === g)
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">細項（選填，例：複習、作業訂正、回報）</Label>
                  <Input value={draft.subLabel} onChange={(e) => setDraft({ ...draft, subLabel: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">做了什麼</Label>
                  <Textarea
                    rows={2}
                    value={draft.content}
                    onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                    placeholder="例：社會 U1-2 期中範圍複習／地形、建築特色、氣候"
                  />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" disabled={pending} onClick={save}>
                    {draft.id ? "儲存修改" : "記下來"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                    取消
                  </Button>
                </div>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

// ---------------- 週報 ----------------

function WeeklyReport({
  contactId,
  name,
  weekStart,
  categories,
  logs,
}: {
  contactId: string;
  name: string;
  weekStart: string;
  categories: StaffCategory[];
  logs: StaffLog[];
}) {
  const qc = useQueryClient();
  const report = useWeeklyReport(contactId, weekStart);
  const { groups, total } = useMemo(() => groupStats(logs, categories), [logs, categories]);
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [review, setReview] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 換週／讀到已存的週報時帶入
    setSummaries(report.data?.summaries ?? {});
    setReview(report.data?.review ?? "");
  }, [report.data, weekStart, contactId]);

  async function aiDraft() {
    setDrafting(true);
    try {
      const res = await fetch("/api/work/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId, weekStart }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "擬稿失敗");
      // 已經寫過的不蓋掉
      setSummaries((cur) => {
        const next = { ...cur };
        for (const [g, t] of Object.entries(j.summaries as Record<string, string>)) if (!next[g]?.trim()) next[g] = t;
        return next;
      });
      toast.success("已擬好概述，請看過再修改");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "擬稿失敗");
    } finally {
      setDrafting(false);
    }
  }

  function save(submit: boolean) {
    startTransition(async () => {
      const res = await saveWeeklyReportAction({ contactId, weekStart, summaries, review, submit });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(submit ? "週報已送出" : "已存草稿");
      qc.invalidateQueries({ queryKey: ["staff", "report"] });
    });
  }

  return (
    <div className="space-y-4" id="print-area">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 className="text-xl font-bold">本週工作執行與學習輔導成果報告</h2>
        <span className="text-sm text-muted-foreground">
          {name}　{weekStart.replaceAll("-", "/")}–{addDays(weekStart, 6).replaceAll("-", "/")}
        </span>
        {report.data?.submitted_at && (
          <span className="rounded-full bg-emerald-100 px-2 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">已送出</span>
        )}
      </div>

      <h3 className="font-bold">一、本週工作項目與時長比例</h3>
      {total === 0 ? (
        <p className="text-sm text-muted-foreground">這週還沒有工作紀錄。</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-muted/60">
                <th className="border px-2 py-1.5 text-left">工作大項</th>
                <th className="border px-2 py-1.5 text-left">類別</th>
                <th className="border px-2 py-1.5 text-right">工時(h)</th>
                <th className="border px-2 py-1.5 text-right">佔比</th>
                <th className="hidden border px-2 py-1.5 text-left sm:table-cell print:table-cell">執行內容與成效概述</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g, gi) =>
                g.rows.map((r, i) => (
                  <tr key={`${g.group}-${r.name}`} className={gi % 2 ? "" : "bg-orange-50/60 dark:bg-orange-950/20"}>
                    {i === 0 && (
                      <td className="border px-2 py-1.5 align-top font-medium" rowSpan={g.rows.length}>
                        {gi + 1}. {g.group}
                        <div className="text-xs font-normal text-muted-foreground">
                          總計 {g.hours.toFixed(2)}h　佔 {pctText(g.hours, total)}
                        </div>
                      </td>
                    )}
                    <td className="border px-2 py-1.5 align-top">{r.name}</td>
                    <td className="border px-2 py-1.5 text-right align-top tabular-nums">{r.hours.toFixed(2)}</td>
                    <td className="border px-2 py-1.5 text-right align-top tabular-nums">{pctText(r.hours, total)}</td>
                    {i === 0 && (
                      <td className="hidden border px-2 py-1 align-top sm:table-cell print:table-cell" rowSpan={g.rows.length}>
                        <Textarea
                          rows={Math.max(2, g.rows.length)}
                          className="min-h-0 border-0 px-0 shadow-none focus-visible:ring-0 print:hidden"
                          value={summaries[g.group] ?? ""}
                          onChange={(e) => setSummaries({ ...summaries, [g.group]: e.target.value })}
                          placeholder="這個大項做了什麼、有什麼成果"
                        />
                        <div className="hidden whitespace-pre-wrap print:block">{summaries[g.group]}</div>
                      </td>
                    )}
                  </tr>
                )),
              )}
              <tr className="font-bold">
                <td className="border px-2 py-1.5">總計</td>
                <td className="border px-2 py-1.5" />
                <td className="border px-2 py-1.5 text-right tabular-nums">{total.toFixed(2)}</td>
                <td className="border px-2 py-1.5 text-right">100%</td>
                <td className="hidden border px-2 py-1.5 sm:table-cell print:table-cell" />
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* 手機：表格放不下概述欄，改排在表格下面 */}
      {total > 0 && (
        <div className="space-y-2 sm:hidden print:hidden">
          <p className="text-sm font-medium">執行內容與成效概述</p>
          {groups.map((g) => (
            <div key={g.group} className="space-y-1">
              <Label className="text-xs">{g.group}</Label>
              <Textarea
                rows={2}
                value={summaries[g.group] ?? ""}
                onChange={(e) => setSummaries({ ...summaries, [g.group]: e.target.value })}
                placeholder="這個大項做了什麼、有什麼成果"
              />
            </div>
          ))}
        </div>
      )}

      <h3 className="font-bold">二、本週重點說明與檢討</h3>
      <Textarea
        rows={6}
        className="print:hidden"
        value={review}
        onChange={(e) => setReview(e.target.value)}
        placeholder={"1. 這週陸續視訊數學與鋼琴老師，已挑出人選試上\n2. 遇到的狀況與改進做法…"}
      />
      <div className="hidden whitespace-pre-wrap text-sm print:block">{review}</div>

      <div className="flex flex-wrap gap-2 print:hidden">
        <Button variant="outline" onClick={aiDraft} disabled={drafting || total === 0}>
          <Sparkles className="size-4" />
          {drafting ? "擬稿中…" : "AI 擬概述"}
        </Button>
        <Button variant="outline" onClick={() => save(false)} disabled={pending}>
          存草稿
        </Button>
        <Button onClick={() => save(true)} disabled={pending}>
          送出週報
        </Button>
        <Button variant="ghost" onClick={() => window.print()}>
          <Printer className="size-4" />
          列印／存 PDF
        </Button>
      </div>
    </div>
  );
}
