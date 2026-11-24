"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, LayoutGrid, Plus, Printer } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState, ListSkeleton } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { useAppData } from "@/components/app/app-data";
import { AiSummary } from "@/components/learning/ai-summary";
import { ScoreDialog } from "@/components/scores/score-dialog";
import { useLearningFeed, type LearningGroup } from "@/lib/client/learning";
import { subjectOfLabel, useScores, type Score, type ScoreDraft } from "@/lib/client/scores";
import { useMyStaffLinks } from "@/lib/client/staff";
import { teacherLabel } from "@/lib/learning";
import { D, taipeiTodayStr } from "@/lib/date";
import { cn } from "@/lib/utils";

/**
 * 各科儀表板（使用者 11/24）：選小孩＋月份，每科一張卡——上課堂數、回饋則數、最近進度、成績趨勢、AI 本月總結。
 * 成績由家長、家庭老師、老師登記（0039）。主要給家長、家庭老師看。
 * spec：docs/specs/各科儀表板與成績.md
 */

function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function monthEnd(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

interface Card {
  subject: string;
  groups: LearningGroup[];
  scores: Score[];
}

export default function SubjectsPage() {
  const { me, calendars } = useAppData();
  const qc = useQueryClient();
  const links = useMyStaffLinks();
  // 家長自己；家庭老師看分享給她的家長
  const ownerId =
    (calendars.some((c) => c.isOwned) ? me.id : null) ??
    calendars.find((c) => !c.isOwned)?.owner_id ??
    links.data?.[0]?.owner_id ??
    null;
  const thisMonth = taipeiTodayStr().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const feed = useLearningFeed(`${month}-01`, monthEnd(month));
  // 成績看近 6 個月（畫趨勢），本月的另外標
  const scoresQ = useScores(ownerId, `${shiftMonth(month, -5)}-01`, monthEnd(month));
  const [pick, setPick] = useState<string | null>(null);
  const [draft, setDraft] = useState<ScoreDraft | null>(null);

  const children = feed.data?.children ?? [];
  const childId = pick && children.some((c) => c.id === pick) ? pick : (children[0]?.id ?? null);
  const groups = useMemo(() => (childId && feed.data?.groupsByChild.get(childId)) || [], [feed.data, childId]);
  const scores = useMemo(() => (scoresQ.data ?? []).filter((s) => s.student_id === childId), [scoresQ.data, childId]);

  const cards = useMemo((): Card[] => {
    const m = new Map<string, Card>();
    const get = (subject: string) => {
      let c = m.get(subject);
      if (!c) m.set(subject, (c = { subject, groups: [], scores: [] }));
      return c;
    };
    for (const g of groups) {
      const subject = g.teacher ? subjectOfLabel(g.teacher.role_label, g.teacher.name) : "其他";
      get(subject).groups.push(g);
    }
    for (const s of scores) get(s.subject).scores.push(s);
    return [...m.values()].sort((a, b) => totalClasses(b) - totalClasses(a) || b.scores.length - a.scores.length);
  }, [groups, scores]);
  const subjectNames = cards.map((c) => c.subject).filter((s) => s !== "其他");
  const [y, mo] = month.split("-").map(Number);
  const childName = children.find((c) => c.id === childId)?.name ?? "";

  const newScore = (subject = "") =>
    setDraft({ studentId: childId ?? "", subject, testDate: taipeiTodayStr(), label: "", score: "", fullScore: "100", note: "" });

  return (
    <div className="mx-auto max-w-5xl">
      <style>{"@media print { @page { size: A4 portrait; margin: 12mm; } }"}</style>
      <PageHeader
        title="各科儀表板"
        description="每個小孩各科這個月的上課、回饋、進度與成績；成績由老師或家庭老師登記"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="size-4" />
              列印／存 PDF
            </Button>
            <Button onClick={() => newScore()} disabled={!ownerId || children.length === 0}>
              <Plus className="size-4" />
              登記成績
            </Button>
          </div>
        }
      />
      <div className="mb-3 flex items-center gap-2 print:hidden">
        <Button variant="outline" size="icon" aria-label="上個月" onClick={() => setMonth(shiftMonth(month, -1))}>
          <ChevronLeft className="size-4" />
        </Button>
        <Button variant="outline" onClick={() => setMonth(thisMonth)} disabled={month === thisMonth}>
          本月
        </Button>
        <Button variant="outline" size="icon" aria-label="下個月" onClick={() => setMonth(shiftMonth(month, 1))}>
          <ChevronRight className="size-4" />
        </Button>
        <span className="ml-1 text-lg font-semibold">
          {y} 年 {mo} 月
        </span>
      </div>
      {feed.isLoading ? (
        <ListSkeleton rows={4} />
      ) : children.length === 0 ? (
        <EmptyState icon={LayoutGrid} title="這個月沒有上課紀錄" description="行程設了主角（小孩）與老師就會出現在這裡。" />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2 print:hidden">
            {children.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={c.id === childId}
                onClick={() => setPick(c.id)}
                className={cn(
                  "rounded-full border px-4 py-1.5 text-sm font-medium",
                  c.id === childId ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
                )}
              >
                {c.name}
              </button>
            ))}
          </div>
          {scoresQ.data === null && (
            <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              成績功能需要先套用資料庫更新（0039）。
            </p>
          )}
          <div id="print-area">
            <h1 className="mb-3 hidden text-xl font-bold print:block">
              {childName} {y} 年 {mo} 月 各科儀表板
            </h1>
            <div className="grid gap-4 md:grid-cols-2 print:grid-cols-2">
              {cards.map((c) => (
                <SubjectCard
                  key={`${c.subject}-${childId}-${month}`}
                  card={c}
                  month={month}
                  childName={childName}
                  onAddScore={() => newScore(c.subject === "其他" ? "" : c.subject)}
                  onEditScore={(s) =>
                    setDraft({
                      id: s.id,
                      studentId: s.student_id,
                      subject: s.subject,
                      testDate: s.test_date,
                      label: s.label,
                      score: String(s.score),
                      fullScore: String(s.full_score),
                      note: s.note,
                    })
                  }
                />
              ))}
            </div>
          </div>
        </>
      )}
      {ownerId && (
        <ScoreDialog
          draft={draft}
          ownerId={ownerId}
          userId={me.id}
          students={children}
          subjects={subjectNames}
          onClose={() => setDraft(null)}
          onSaved={() => {
            setDraft(null);
            qc.invalidateQueries({ queryKey: ["scores"] });
          }}
        />
      )}
    </div>
  );
}

function totalClasses(c: Card): number {
  return c.groups.reduce((n, g) => n + g.classCount, 0);
}

function SubjectCard({
  card,
  month,
  childName,
  onAddScore,
  onEditScore,
}: {
  card: Card;
  month: string;
  childName: string;
  onAddScore: () => void;
  onEditScore: (s: Score) => void;
}) {
  const classes = totalClasses(card);
  const entries = card.groups.flatMap((g) => g.entries).sort((a, b) => a.eventStart.localeCompare(b.eventStart));
  const latestProgress = [...entries].reverse().find((e) => e.progressLabel)?.progressLabel ?? null;
  const monthScores = card.scores.filter((s) => s.test_date.startsWith(month));
  const avg = monthScores.length
    ? Math.round(monthScores.reduce((n, s) => n + (s.score / s.full_score) * 100, 0) / monthScores.length)
    : null;
  const teachers = card.groups.filter((g) => g.teacher).map((g) => teacherLabel(g.teacher!));
  const missing = Math.max(0, classes - new Set(entries.map((e) => e.eventStart)).size);

  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-card p-4 print:break-inside-avoid">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-lg font-bold">{card.subject}</h2>
        {teachers.length > 0 && <span className="text-xs text-muted-foreground">{teachers.join("、")}</span>}
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="本月上課" value={classes ? `${classes} 堂` : "—"} />
        <Stat
          label="回饋"
          value={`${entries.length} 則`}
          warn={classes > 0 && missing > 0 ? `缺 ${missing} 堂` : undefined}
        />
        <Stat label="本月平均" value={avg != null ? `${avg} 分` : "—"} />
      </div>
      <div className="text-sm">
        <span className="text-xs text-muted-foreground">最近進度：</span>
        {latestProgress ?? <span className="text-muted-foreground">回饋裡還沒填課程進度</span>}
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">成績（近 6 個月）</span>
          <Button size="sm" variant="ghost" className="ml-auto h-6 px-2 text-xs print:hidden" onClick={onAddScore}>
            <Plus className="size-3" />
            登記
          </Button>
        </div>
        {card.scores.length === 0 ? (
          <p className="text-sm text-muted-foreground">還沒有成績</p>
        ) : (
          <>
            <Trend scores={card.scores} />
            <ul className="space-y-0.5 text-sm">
              {[...card.scores].reverse().slice(0, 5).map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => onEditScore(s)} className="flex w-full items-baseline gap-2 text-left hover:underline">
                    <span className="w-12 shrink-0 tabular-nums text-muted-foreground">{s.test_date.slice(5).replace("-", "/")}</span>
                    <span className="flex-1 truncate">{s.label || "測驗"}</span>
                    <span className="font-semibold tabular-nums">
                      {s.score}
                      <span className="font-normal text-muted-foreground">/{s.full_score}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      {entries.length > 0 && (
        <div className="mt-auto">
          <AiSummary teacher={`${card.subject}（${teachers.join("、") || "老師"}）`} items={entries.map((entry) => ({ child: childName, entry }))} />
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: string }) {
  return (
    <div className="rounded-lg bg-muted/50 px-2 py-1.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
      {warn && <div className="text-xs text-amber-700 dark:text-amber-400">{warn}</div>}
    </div>
  );
}

/** 成績趨勢（換算成百分）：單一數列，一條 2px 線＋點，0–100 一個軸；滑過點顯示分數 */
function Trend({ scores }: { scores: Score[] }) {
  if (scores.length < 2) return null;
  const W = 300;
  const H = 70;
  const pad = 8;
  const pts = scores.map((s, i) => ({
    x: pad + (i * (W - 2 * pad)) / (scores.length - 1),
    y: pad + (1 - Math.min(1, s.score / s.full_score)) * (H - 2 * pad),
    s,
  }));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-16 w-full" role="img" aria-label="成績趨勢">
      <line x1={pad} x2={W - pad} y1={pad} y2={pad} className="stroke-border" strokeDasharray="2 3" />
      <line x1={pad} x2={W - pad} y1={H - pad} y2={H - pad} className="stroke-border" />
      <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" className="stroke-primary" strokeWidth={2} />
      {pts.map((p) => (
        <circle key={p.s.id} cx={p.x} cy={p.y} r={4} className="fill-primary stroke-card" strokeWidth={2}>
          <title>{`${D.dateShort(p.s.test_date)} ${p.s.label || "測驗"}：${p.s.score}/${p.s.full_score}`}</title>
        </circle>
      ))}
    </svg>
  );
}
