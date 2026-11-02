"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft, ChevronRight, GraduationCap, Settings2 } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { useAppData } from "@/components/app/app-data";
import { PctBar, ReportCard } from "@/components/tutor/report-card";
import { Chips } from "@/components/tutor/fields";
import {
  deleteReport,
  useCommentCounts,
  useTutorContacts,
  useTutorRates,
  useTutorReports,
  type TutorReport,
} from "@/lib/client/tutor";
import { absorptionTrends, hoursByTeacher, latestProgress, todos, type TrendPoint } from "@/lib/tutor-stats";
import { hoursText, WORK_CATEGORIES } from "@/lib/tutor";
import { taipeiTodayStr, twd } from "@/lib/date";
import { cn } from "@/lib/utils";

function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function monthEnd(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

/**
 * 家長端「家教填報」：全部紀錄（篩選、留言）＋報表（時數、各科進度、吸收趨勢、待辦）。
 * spec：docs/specs/家教老師填報.md
 */
export default function TutoringPage() {
  const { me } = useAppData();
  const qc = useQueryClient();
  const today = taipeiTodayStr();
  const [tab, setTab] = useState<"records" | "report">("records");
  const [month, setMonth] = useState(today.slice(0, 7));
  // 趨勢、進度、待辦看近半年；清單與時數看選的月份
  const sixMonths = `${shiftMonth(today.slice(0, 7), -5)}-01`;
  const allQ = useTutorReports({ owner: me.id }, { from: sixMonths < `${month}-01` ? sixMonths : `${month}-01`, to: "2999-12-31" });
  const contactsQ = useTutorContacts(me.id);
  const ratesQ = useTutorRates(me.id);
  const all = useMemo(() => allQ.data ?? [], [allQ.data]);
  const monthReports = useMemo(
    () => all.filter((r) => r.report_date >= `${month}-01` && r.report_date <= monthEnd(month)),
    [all, month],
  );
  const counts = useCommentCounts(monthReports.map((r) => r.id)).data;

  const contacts = contactsQ.data ?? [];
  const students = contacts.filter((c) => c.is_student);
  const nameOf = (id: string) => contacts.find((c) => c.id === id)?.name ?? "學生";
  const teachers = contacts.filter((c) => c.tutor_kind);

  const [teacherPick, setTeacherPick] = useState<string[]>([]);
  const [subjectPick, setSubjectPick] = useState<string[]>([]);
  const [studentPick, setStudentPick] = useState<string[]>([]);
  const subjectOptions = [...new Set(monthReports.map((r) => (r.kind === "lesson" ? r.subject ?? "其他" : "每日回報")))];
  const teacherOptions = [...new Set(monthReports.map((r) => r.teacher_contact_id))];
  const filtered = monthReports.filter(
    (r) =>
      (teacherPick.length === 0 || teacherPick.includes(r.teacher_contact_id)) &&
      (subjectPick.length === 0 || subjectPick.includes(r.kind === "lesson" ? r.subject ?? "其他" : "每日回報")) &&
      (studentPick.length === 0 || r.student_ids.some((id) => studentPick.includes(id))),
  );
  const teacherNameOf = (id: string) => monthReports.find((r) => r.teacher_contact_id === id)?.teacher_name ?? "";

  async function remove(r: TutorReport) {
    if (!confirm(`確定刪除 ${r.teacher_name}老師 ${r.report_date} 的紀錄？老師端與行事曆那堂課的回饋摘要也會一起刪除。`)) return;
    const err = await deleteReport(r);
    if (err) return void toast.error(err);
    toast.success("已刪除");
    await qc.invalidateQueries({ queryKey: ["tutor"] });
  }

  const pendingTodos = todos(all, today);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="家教填報"
        description="老師填的上課紀錄與每日回報、時數與學習成效"
        actions={
          <Button variant="outline" asChild>
            <Link href="/settings/contacts">
              <Settings2 className="size-4" />
              老師設定
            </Link>
          </Button>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border p-0.5">
          {(
            [
              ["records", "紀錄"],
              ["report", "報表"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={cn(
                "rounded px-4 py-1.5 text-sm font-medium",
                tab === k ? "bg-primary text-primary-foreground" : "hover:bg-muted",
              )}
            >
              {label}
              {k === "report" && pendingTodos.some((t) => t.kind === "contact") && (
                <span className="ml-1 inline-block size-2 rounded-full bg-red-500" />
              )}
            </button>
          ))}
        </div>
        <Button variant="outline" size="icon" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="上個月">
          <ChevronLeft className="size-4" />
        </Button>
        <span className="font-semibold">{month.replace("-", " 年 ")} 月</span>
        <Button variant="outline" size="icon" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="下個月">
          <ChevronRight className="size-4" />
        </Button>
      </div>

      {allQ.isError ? (
        <ErrorState message={(allQ.error as Error).message} onRetry={() => allQ.refetch()} />
      ) : allQ.isLoading ? (
        <ListSkeleton rows={4} />
      ) : teachers.length === 0 && all.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title="還沒有設定家教老師"
          description="到「人物管理」打開老師，設定是專科老師或家庭老師、建立老師帳號，老師就能登入填報。"
        />
      ) : tab === "records" ? (
        <div className="space-y-3">
          {monthReports.length > 0 && (
            <div className="space-y-2 rounded-xl border bg-card p-3">
              <Chips options={teacherOptions} value={teacherPick} onChange={setTeacherPick} labelOf={(id) => `${teacherNameOf(id)}老師`} />
              <Chips options={subjectOptions} value={subjectPick} onChange={setSubjectPick} />
              {students.length > 1 && (
                <Chips options={students.map((s) => s.id)} value={studentPick} onChange={setStudentPick} labelOf={nameOf} />
              )}
            </div>
          )}
          {filtered.length === 0 ? (
            <div className="rounded-xl border p-6 text-center text-sm text-muted-foreground">這個月沒有符合的紀錄</div>
          ) : (
            filtered.map((r) => (
              <ReportCard
                key={r.id}
                report={r}
                studentName={nameOf}
                userId={me.id}
                canComment
                commentCount={counts?.get(r.id)}
                onDelete={() => void remove(r)}
              />
            ))
          )}
        </div>
      ) : (
        <ReportTab
          monthReports={monthReports}
          all={all}
          today={today}
          rates={ratesQ.data ?? new Map()}
          students={students}
          pendingTodos={pendingTodos}
        />
      )}
    </div>
  );
}

function ReportTab({
  monthReports,
  all,
  today,
  rates,
  students,
  pendingTodos,
}: {
  monthReports: TutorReport[];
  all: TutorReport[];
  today: string;
  rates: Map<string, Record<string, number>>;
  students: { id: string; name: string }[];
  pendingTodos: ReturnType<typeof todos>;
}) {
  const hours = hoursByTeacher(monthReports);
  const progress = latestProgress(all);
  const trends = absorptionTrends(all);

  return (
    <div className="space-y-4">
      {/* 待辦提醒 */}
      <section className="rounded-xl border bg-card p-3">
        <h2 className="mb-2 font-semibold">待辦提醒</h2>
        {pendingTodos.length === 0 ? (
          <p className="text-sm text-muted-foreground">目前沒有需要處理的事</p>
        ) : (
          <ul className="space-y-1.5">
            {pendingTodos.map((t, i) => (
              <li
                key={i}
                className={cn("rounded-lg p-2.5 text-sm", t.kind === "contact" ? "bg-red-50 dark:bg-red-950/30" : "bg-muted/40")}
              >
                <div className="flex items-center gap-1.5 font-medium">
                  {t.kind === "contact" && <AlertTriangle className="size-4 text-red-600" />}
                  {t.title}
                  <span className="ml-auto text-xs font-normal text-muted-foreground">
                    {t.date.slice(5).replace("-", "/")} {t.teacherName}老師
                  </span>
                </div>
                <div className="whitespace-pre-wrap text-muted-foreground">{t.detail}</div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted-foreground">需家長處理的聯繫列近 30 天；採購報名、專題以最新一次回報為準，完成後就不再列出。</p>
      </section>

      {/* 時數統計 */}
      <section className="rounded-xl border bg-card p-3">
        <h2 className="mb-2 font-semibold">時數統計（本月）</h2>
        {hours.length === 0 ? (
          <p className="text-sm text-muted-foreground">這個月還沒有紀錄</p>
        ) : (
          <div className="space-y-3">
            {hours.map((h) => {
              const rate = rates.get(h.teacherId) ?? {};
              const cats = Object.entries(h.byCategory);
              const amount = cats.reduce((a, [k, v]) => a + (rate[k] ?? 0) * (v / 60), 0);
              const missingRate = cats.some(([k]) => !rate[k]);
              return (
                <div key={h.teacherId} className="rounded-lg bg-muted/40 p-2.5">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-semibold">{h.teacherName}老師</span>
                    <span className="text-sm text-muted-foreground">{h.count} 筆</span>
                    <span className="ml-auto text-lg font-bold">{hoursText(h.minutes)}</span>
                  </div>
                  {cats.length > 0 ? (
                    <div className="mt-1 space-y-0.5 text-sm">
                      {WORK_CATEGORIES.filter((k) => h.byCategory[k]).map((k) => (
                        <div key={k} className="flex justify-between">
                          <span>{k}</span>
                          <span>
                            {hoursText(h.byCategory[k])}
                            {rate[k] ? ` × ${twd(rate[k])} = ${twd(Math.round(rate[k] * (h.byCategory[k] / 60)))}` : "（未設時薪）"}
                          </span>
                        </div>
                      ))}
                      <div className="flex justify-between border-t pt-1 font-semibold">
                        <span>本月金額{missingRate && "（部分類別未設時薪）"}</span>
                        <span>{twd(Math.round(amount))}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-1 text-sm text-muted-foreground">
                      {Object.entries(h.bySubject)
                        .map(([k, v]) => `${k} ${hoursText(v)}`)
                        .join("・")}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">金額只有家長看得到；家庭老師各工作類別的時薪在「人物管理 → 老師設定」。</p>
      </section>

      {/* 吸收程度趨勢 */}
      <section className="rounded-xl border bg-card p-3">
        <h2 className="mb-2 font-semibold">吸收程度趨勢（近半年）</h2>
        {students.length === 0 || trends.size === 0 ? (
          <p className="text-sm text-muted-foreground">還沒有吸收程度的紀錄</p>
        ) : (
          <div className="space-y-4">
            {students.map((s) => {
              const bySub = trends.get(s.id);
              if (!bySub) return null;
              return (
                <div key={s.id}>
                  <div className="mb-1 font-semibold">{s.name}</div>
                  <div className="space-y-1.5">
                    {[...bySub.entries()].map(([subject, pts]) => {
                      const last = pts[pts.length - 1];
                      const prev = pts.length > 1 ? pts[pts.length - 2] : null;
                      const drop = prev && last.value < prev.value - 10;
                      return (
                        <div key={subject} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                          <span className="w-20 shrink-0">{subject}</span>
                          <Spark points={pts} />
                          <PctBar value={last.value} />
                          <span className="text-xs text-muted-foreground">
                            {last.date.slice(5).replace("-", "/")} {last.unit}
                          </span>
                          {(last.value < 60 || drop) && (
                            <span className="rounded bg-red-100 px-1.5 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
                              {last.value < 60 ? "需加強" : "下降"}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 各科進度 */}
      <section className="rounded-xl border bg-card p-3">
        <h2 className="mb-2 font-semibold">各科進度（最近一次）</h2>
        {progress.length === 0 ? (
          <p className="text-sm text-muted-foreground">還沒有進度紀錄</p>
        ) : (
          <div className="divide-y text-sm">
            {progress.map((p) => (
              <div key={p.subject} className="flex flex-wrap gap-x-3 py-1.5">
                <span className="w-20 shrink-0 font-medium">{p.subject}</span>
                <span className="flex-1">{p.unit}</span>
                <span className="text-xs text-muted-foreground">
                  {p.date.slice(5).replace("-", "/")} {p.teacherName}老師
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">今天 {today}；可對照學校進度。</p>
      </section>
    </div>
  );
}

/** 迷你折線：0–100%，最近 12 次 */
function Spark({ points }: { points: TrendPoint[] }) {
  const pts = points.slice(-12);
  const w = 96;
  const h = 24;
  if (pts.length < 2) return <span className="inline-block w-24" />;
  const d = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${((i / (pts.length - 1)) * w).toFixed(1)},${(h - (p.value / 100) * h).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} className="shrink-0 text-primary" aria-hidden>
      <line x1={0} x2={w} y1={h - 0.6 * h} y2={h - 0.6 * h} className="stroke-red-300" strokeDasharray="2 2" strokeWidth={1} />
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  );
}
