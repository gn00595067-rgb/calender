"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScoreDialog } from "@/components/scores/score-dialog";
import { useTutorProfile } from "@/lib/client/tutor";
import { useScores, type ScoreDraft } from "@/lib/client/scores";
import { taipeiTodayStr } from "@/lib/date";

/** 老師登記成績（0039）：只看得到、改得到自己登記的 */
export function TeacherScores({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const { data: profile } = useTutorProfile();
  const today = taipeiTodayStr();
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - 120 * 864e5).toISOString().slice(0, 10);
  const scoresQ = useScores(profile?.ownerId ?? null, from, "2999-12-31");
  const [draft, setDraft] = useState<ScoreDraft | null>(null);
  const [open, setOpen] = useState(false);
  if (!profile || scoresQ.data === null) return null;
  const students = profile.students;
  const mine = scoresQ.data ?? [];
  const nameOf = (id: string) => students.find((s) => s.id === id)?.name ?? "";
  const lastSubject = mine.at(-1)?.subject ?? "";

  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="flex items-center gap-2">
        <ClipboardList className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">成績</span>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setOpen(!open)}>
          {open ? "收起" : `我登記的（${mine.length}）`}
        </Button>
        <Button
          size="sm"
          className="ml-auto h-7"
          onClick={() =>
            setDraft({ studentId: students[0]?.id ?? "", subject: lastSubject, testDate: today, label: "", score: "", fullScore: "100", note: "" })
          }
        >
          登記成績
        </Button>
      </div>
      {open && (
        <ul className="mt-2 space-y-1 text-sm">
          {mine.length === 0 && <li className="text-muted-foreground">還沒有登記過</li>}
          {[...mine].reverse().map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="flex w-full gap-2 text-left hover:underline"
                onClick={() =>
                  setDraft({ id: s.id, studentId: s.student_id, subject: s.subject, testDate: s.test_date, label: s.label, score: String(s.score), fullScore: String(s.full_score), note: s.note })
                }
              >
                <span className="tabular-nums text-muted-foreground">{s.test_date.slice(5).replace("-", "/")}</span>
                <span>{nameOf(s.student_id)}</span>
                <span className="flex-1 truncate">{s.subject} {s.label}</span>
                <span className="font-semibold tabular-nums">{s.score}/{s.full_score}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <ScoreDialog
        draft={draft}
        ownerId={profile.ownerId}
        userId={userId}
        students={students}
        subjects={[...new Set(mine.map((s) => s.subject))]}
        onClose={() => setDraft(null)}
        onSaved={() => {
          setDraft(null);
          qc.invalidateQueries({ queryKey: ["scores"] });
        }}
      />
    </div>
  );
}
