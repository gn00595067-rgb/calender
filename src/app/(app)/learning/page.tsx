"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, GraduationCap } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState, ListSkeleton } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useLearningFeed, type LearningGroup } from "@/lib/client/learning";
import { teacherLabel } from "@/lib/learning";
import { taipeiTodayStr, D } from "@/lib/date";
import { cn } from "@/lib/utils";

/** yyyy-MM 加減 n 個月 */
function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthRange(ym: string): { start: string; end: string } {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${ym}-01`, end: `${ym}-${String(last).padStart(2, "0")}` };
}

/**
 * 學習回饋：選小孩＋月份，依老師（科目）看每堂課的回饋與統計。
 * spec：docs/specs/學習回饋-依小孩拆分與統整.md
 */
export default function LearningPage() {
  const thisMonth = taipeiTodayStr().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const { start, end } = monthRange(month);
  const { data, isLoading } = useLearningFeed(start, end);
  const [childPick, setChildPick] = useState<string | null>(null);

  const children = data?.children ?? [];
  // 預設選回饋最多的小孩；換月份後原本選的不在名單就改回預設
  const childId =
    childPick && children.some((c) => c.id === childPick)
      ? childPick
      : ([...children].sort(
          (a, b) => countEntries(data?.groupsByChild.get(b.id)) - countEntries(data?.groupsByChild.get(a.id)),
        )[0]?.id ?? null);
  const groups = (childId && data?.groupsByChild.get(childId)) || [];
  const withEntries = groups.filter((g) => g.entries.length > 0);

  const [y, m] = month.split("-").map(Number);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="學習回饋" description="每個小孩各科的上課堂數與老師回饋" />

      {/* 月份 */}
      <div className="mb-3 flex items-center gap-2">
        <Button variant="outline" size="icon" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="上個月">
          <ChevronLeft className="size-4" />
        </Button>
        <Button variant="outline" onClick={() => setMonth(thisMonth)} disabled={month === thisMonth}>
          本月
        </Button>
        <Button variant="outline" size="icon" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="下個月">
          <ChevronRight className="size-4" />
        </Button>
        <span className="ml-1 text-lg font-semibold">
          {y} 年 {m} 月
        </span>
      </div>

      {isLoading ? (
        <ListSkeleton rows={4} />
      ) : children.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title="這個月沒有上課紀錄"
          description="行程設了主角（小孩）與老師（或有付鐘點費）就會統計在這裡；在行程的「回饋與筆記」填寫回饋。"
        />
      ) : (
        <>
          {/* 小孩 */}
          <div className="mb-4 flex flex-wrap gap-2">
            {children.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setChildPick(c.id)}
                className={cn(
                  "rounded-full border px-4 py-1.5 text-sm font-medium transition",
                  c.id === childId ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
                )}
              >
                {c.name}
              </button>
            ))}
          </div>

          {/* 統計：每位老師上課幾堂、回饋幾則 */}
          <div className="mb-6 grid gap-2 sm:grid-cols-2">
            {groups.map((g) => (
              <div key={g.key} className="flex items-center justify-between rounded-lg border bg-card px-3 py-2">
                <span className="truncate text-sm font-medium">
                  {g.teacher ? teacherLabel(g.teacher) : "其他（未指定老師）"}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {g.teacher && `上課 ${g.classCount} 堂 · `}
                  <span className={cn(g.entries.length > 0 && "font-semibold text-foreground")}>
                    回饋 {g.entries.length} 則
                  </span>
                </span>
              </div>
            ))}
          </div>

          {withEntries.length === 0 ? (
            <EmptyState title="這個月還沒有回饋" description="在行程詳情的「回饋與筆記」填寫後會出現在這裡。" />
          ) : (
            <div className="space-y-6">
              {withEntries.map((g) => (
                <GroupSection key={g.key} group={g} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function countEntries(groups: LearningGroup[] | undefined): number {
  return (groups ?? []).reduce((n, g) => n + g.entries.length, 0);
}

function GroupSection({ group }: { group: LearningGroup }) {
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 text-base font-semibold">
        {group.teacher ? teacherLabel(group.teacher) : "其他（未指定老師）"}
        <Badge variant="secondary">{group.entries.length} 則</Badge>
      </h2>
      <ol className="relative space-y-3 border-l pl-4">
        {group.entries.map((e) => (
          <li key={e.noteId} className="relative rounded-lg border bg-card p-3">
            <span className="absolute -left-[21px] top-4 size-2 rounded-full bg-primary" />
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{D.date(e.eventStart)}</span>
              <span>{e.eventTitle}</span>
              {group.teacher && e.authorName !== group.teacher.name && <span>· {e.authorName} 代填</span>}
              {e.unsplit && (
                <Badge variant="outline" className="text-amber-700">
                  未依小孩拆開
                </Badge>
              )}
              {e.progressLabel && (
                <Badge variant="outline" className="ml-auto">
                  {e.progressLabel}
                </Badge>
              )}
            </div>
            {e.shared && (
              <details className="mt-1.5 text-sm text-muted-foreground">
                <summary className="cursor-pointer select-none text-xs">共同內容（教學概念等）</summary>
                <p className="mt-1 whitespace-pre-wrap">{e.shared}</p>
              </details>
            )}
            <p className="mt-1.5 whitespace-pre-wrap text-sm">{e.content}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
