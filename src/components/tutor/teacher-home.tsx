"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ListSkeleton } from "@/components/app/states";
import { TeachView } from "@/components/teach/teach-view";
import { LessonForm } from "./lesson-form";
import { DailyForm } from "./daily-form";
import { ReportCard } from "./report-card";
import { asDaily, hoursText, WORK_CATEGORIES } from "@/lib/tutor";
import {
  deleteReport,
  useCommentCounts,
  useTeacherLessonsOn,
  useTutorProfile,
  useTutorReports,
  type TutorReport,
} from "@/lib/client/tutor";
import { taipeiTodayStr } from "@/lib/date";
import { cn } from "@/lib/utils";

type Tab = "fill" | "mine" | "hours" | "shared" | "lessons";

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
 * 老師端首頁（/teach）：填報、我的紀錄、時數、（家庭老師）專科紀錄、原本的「我的課與回饋」。
 * spec：docs/specs/家教老師填報.md
 */
export function TeacherHome({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const profileQ = useTutorProfile();
  const profile = profileQ.data ?? null;
  const [tab, setTab] = useState<Tab>("fill");
  const [editing, setEditing] = useState<TutorReport | null>(null);
  const today = taipeiTodayStr();

  // 我的紀錄：最近 4 個月
  const contactId = profileQ.data?.contactId ?? null;
  const mineQ = useTutorReports({ mine: contactId }, { from: `${shiftMonth(today.slice(0, 7), -3)}-01`, to: "2999-12-31" });
  const mine = useMemo(() => mineQ.data ?? [], [mineQ.data]);
  const sharedQ = useTutorReports({ shared: profileQ.data?.kind === "home" ? contactId : null });
  const ids = useMemo(() => [...mine, ...(sharedQ.data ?? [])].map((r) => r.id), [mine, sharedQ.data]);
  const counts = useCommentCounts(ids).data;
  // 今天有沒有課還沒填（專科老師）：行事曆上的課 vs 已填紀錄
  const todayLessons = useTeacherLessonsOn(today, profile?.kind === "specialist").data ?? [];

  if (profileQ.isLoading) return <ListSkeleton rows={4} />;
  // 0023 還沒套用或讀不到 → 退回原本的「我的課與回饋」，老師照樣能寫回饋
  if (profileQ.isError || !profile) return <TeachView userId={userId} />;

  const nameOf = (id: string) => profile.students.find((s) => s.id === id)?.name ?? "學生";
  const isHome = profile.kind === "home";
  const todayDaily = isHome ? mine.find((r) => r.kind === "daily" && r.report_date === today) : undefined;
  const unfilled = todayLessons.filter((l) => !mine.some((r) => r.event_id === l.event_id));
  const lastProjectName = mine.map((r) => (r.kind === "daily" ? asDaily(r.content).project?.name : undefined)).find(Boolean);

  const tabs: { key: Tab; label: string }[] = [
    { key: "fill", label: editing ? "修改" : "填報" },
    { key: "mine", label: "我的紀錄" },
    { key: "hours", label: "時數" },
    ...(isHome ? [{ key: "shared" as const, label: "專科紀錄" }] : []),
    { key: "lessons", label: "我的課" },
  ];

  const done = () => {
    setEditing(null);
    setTab("mine");
  };

  async function remove(r: TutorReport) {
    if (!confirm(`確定刪除 ${r.report_date} 這筆紀錄？`)) return;
    const err = await deleteReport(r);
    if (err) return void toast.error(err);
    toast.success("已刪除");
    await qc.invalidateQueries({ queryKey: ["tutor"] });
  }

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 -mx-4 flex gap-1 overflow-x-auto border-b bg-background/95 px-4 py-2 backdrop-blur">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "min-h-10 shrink-0 rounded-full px-4 text-sm font-medium",
              tab === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "fill" &&
        (profile.kind == null ? (
          <div className="rounded-xl border bg-amber-50 p-4 text-sm dark:bg-amber-950/30">
            家長還沒設定您是「專科老師」或「家庭老師」，暫時只能使用「我的課」寫回饋。請通知家長到人物管理設定。
          </div>
        ) : isHome ? (
          <>
            {!editing && todayDaily && (
              <div className="rounded-lg bg-primary/5 p-2.5 text-sm">今天已經填過了，下面是今天那筆，可以繼續補充修改。</div>
            )}
            <DailyForm
              key={editing?.id ?? todayDaily?.id ?? "new"}
              profile={profile}
              userId={userId}
              report={editing ?? todayDaily ?? null}
              lastProjectName={lastProjectName}
              onDone={done}
            />
          </>
        ) : (
          <>
            {!editing && unfilled.length > 0 && (
              <div className="rounded-lg bg-amber-50 p-2.5 text-sm dark:bg-amber-950/30">
                今天行事曆上有 {unfilled.length} 堂課還沒填紀錄，選好日期後點「帶入行事曆的課」即可。
              </div>
            )}
            <LessonForm key={editing?.id ?? "new"} profile={profile} userId={userId} report={editing} onDone={done} />
          </>
        ))}

      {tab === "mine" &&
        (mineQ.isLoading ? (
          <ListSkeleton rows={3} />
        ) : mine.length === 0 ? (
          <div className="rounded-xl border p-6 text-center text-sm text-muted-foreground">
            還沒有紀錄。
            <Button className="mt-3 w-full" onClick={() => setTab("fill")}>
              <PenLine className="size-4" />
              開始填報
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {mine.map((r) => (
              <ReportCard
                key={r.id}
                report={r}
                studentName={nameOf}
                userId={userId}
                canComment
                commentCount={counts?.get(r.id)}
                onEdit={() => {
                  setEditing(r);
                  setTab("fill");
                  window.scrollTo({ top: 0 });
                }}
                onDelete={() => void remove(r)}
              />
            ))}
          </div>
        ))}

      {tab === "hours" && <MyHours contactId={profile.contactId} isHome={isHome} />}

      {tab === "shared" &&
        (sharedQ.isLoading ? (
          <ListSkeleton rows={3} />
        ) : (sharedQ.data ?? []).length === 0 ? (
          <div className="rounded-xl border p-6 text-center text-sm text-muted-foreground">
            家長還沒開放專科老師的紀錄給您，或專科老師還沒填。
          </div>
        ) : (
          <div className="space-y-3">
            {(sharedQ.data ?? []).map((r) => (
              <ReportCard
                key={r.id}
                report={r}
                studentName={nameOf}
                userId={userId}
                canComment={false}
                commentCount={counts?.get(r.id)}
              />
            ))}
          </div>
        ))}

      {tab === "lessons" && <TeachView userId={userId} />}
    </div>
  );
}

/** 自己的時數（不顯示金額）：依月份，家庭老師依工作類別分開 */
function MyHours({ contactId, isHome }: { contactId: string; isHome: boolean }) {
  const [month, setMonth] = useState(taipeiTodayStr().slice(0, 7));
  const { data = [], isLoading } = useTutorReports({ mine: contactId }, { from: `${month}-01`, to: monthEnd(month) });
  const total = data.reduce((a, r) => a + r.minutes, 0);
  const byCat: Record<string, number> = {};
  const bySubject: Record<string, number> = {};
  for (const r of data) {
    for (const [k, v] of Object.entries(r.minutes_by_category ?? {})) byCat[k] = (byCat[k] ?? 0) + v;
    if (r.kind === "lesson") bySubject[r.subject ?? "其他"] = (bySubject[r.subject ?? "其他"] ?? 0) + r.minutes;
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="上個月">
          <ChevronLeft className="size-4" />
        </Button>
        <span className="text-lg font-semibold">{month.replace("-", " 年 ")} 月</span>
        <Button variant="outline" size="icon" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="下個月">
          <ChevronRight className="size-4" />
        </Button>
      </div>
      {isLoading ? (
        <ListSkeleton rows={2} />
      ) : (
        <div className="space-y-2 rounded-xl border bg-card p-4">
          <div className="text-sm text-muted-foreground">本月共 {data.length} 筆</div>
          <div className="text-3xl font-bold">{hoursText(total)}</div>
          {isHome
            ? WORK_CATEGORIES.filter((k) => byCat[k]).map((k) => (
                <div key={k} className="flex justify-between text-sm">
                  <span>{k}</span>
                  <span className="font-medium">{hoursText(byCat[k])}</span>
                </div>
              ))
            : Object.entries(bySubject).map(([k, v]) => (
                <div key={k} className="flex justify-between text-sm">
                  <span>{k}</span>
                  <span className="font-medium">{hoursText(v)}</span>
                </div>
              ))}
        </div>
      )}
    </div>
  );
}
