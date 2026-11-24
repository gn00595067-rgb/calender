"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/types/database";

/**
 * 成績（0039）：家長、家庭老師看全部；老師帳號只看自己登記的（RLS 把關）。
 * spec：docs/specs/各科儀表板與成績.md
 */
export type Score = Tables<"student_scores">;

export function useScores(ownerId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ["scores", ownerId, from, to],
    enabled: !!ownerId,
    queryFn: async (): Promise<Score[] | null> => {
      const { data, error } = await createClient()
        .from("student_scores")
        .select("*")
        .eq("owner_id", ownerId!)
        .gte("test_date", from)
        .lte("test_date", to)
        .order("test_date");
      if (error) return null; // 0039 前沒有這張表
      return data ?? [];
    },
  });
}

export interface ScoreDraft {
  id?: string;
  studentId: string;
  subject: string;
  testDate: string;
  label: string;
  score: string;
  fullScore: string;
  note: string;
}

export async function saveScore(ownerId: string, userId: string, d: ScoreDraft): Promise<string | null> {
  const score = Number(d.score);
  const full = Number(d.fullScore || 100);
  if (!d.studentId) return "請選學生";
  if (!d.subject.trim()) return "請填科目";
  if (!Number.isFinite(score) || score < 0) return "分數不正確";
  if (!Number.isFinite(full) || full <= 0) return "滿分不正確";
  const row = {
    student_id: d.studentId,
    subject: d.subject.trim(),
    test_date: d.testDate,
    label: d.label.trim(),
    score,
    full_score: full,
    note: d.note.trim(),
  };
  const sb = createClient();
  const { error } = d.id
    ? await sb.from("student_scores").update(row).eq("id", d.id)
    : await sb.from("student_scores").insert({ ...row, owner_id: ownerId, author_id: userId });
  return error ? error.message : null;
}

export async function deleteScore(id: string): Promise<string | null> {
  const { error } = await createClient().from("student_scores").delete().eq("id", id);
  return error ? error.message : null;
}

/** 老師稱謂 → 科目：「數學家教」→「數學」、「羽球教練」→「羽球」、「國語老師」→「國語」 */
export function subjectOfLabel(roleLabel: string | null | undefined, name: string): string {
  const r = (roleLabel ?? "").replace(/(家教|老師|教練|課)$/, "").trim();
  return r || name;
}
