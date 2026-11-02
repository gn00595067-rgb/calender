"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/types/database";
import { lessonNoteText, type LessonContent } from "@/lib/tutor";

/**
 * 家教填報的資料存取（老師端、家長端共用；權限由 RLS 把關）。
 * spec：docs/specs/家教老師填報.md
 */

export type TutorReport = Tables<"tutor_reports">;
export type TutorComment = Tables<"tutor_report_comments">;

export interface TutorProfile {
  contactId: string;
  name: string;
  ownerId: string;
  kind: "specialist" | "home" | null;
  subjects: string[];
  students: { id: string; name: string }[];
}

const MISSING = "家教填報需先套用資料庫更新（0023）";

/** 0023 未套用（表／函式不存在）→ 給看得懂的訊息 */
function friendly(msg: string): string {
  return /tutor_|my_tutor_profile|does not exist|schema cache/i.test(msg) ? MISSING : msg;
}

/** 老師自己的人物、類型、可填科目、上課學生（不含時薪） */
export function useTutorProfile() {
  return useQuery({
    queryKey: ["tutor", "profile"],
    queryFn: async (): Promise<TutorProfile | null> => {
      const { data, error } = await createClient().rpc("my_tutor_profile");
      if (error) throw new Error(friendly(error.message));
      const r = data?.[0];
      if (!r) return null;
      return {
        contactId: r.contact_id,
        name: r.contact_name,
        ownerId: r.owner_id,
        kind: r.tutor_kind,
        subjects: r.tutor_subjects ?? [],
        students: (r.students ?? []) as { id: string; name: string }[],
      };
    },
  });
}

/**
 * 紀錄清單：老師＝自己這位老師人物的（mine，換了登入帳號也看得到舊紀錄）
 * 或家長開放的專科紀錄（shared）；家長＝全部（owner）。值為 null 時先不查。
 */
export function useTutorReports(
  scope: { mine: string | null } | { shared: string | null } | { owner: string },
  range?: { from: string; to: string },
) {
  const key = "mine" in scope ? scope.mine : "shared" in scope ? scope.shared : scope.owner;
  return useQuery({
    queryKey: ["tutor", "reports", scope, range],
    enabled: !!key,
    queryFn: async (): Promise<TutorReport[]> => {
      let q = createClient().from("tutor_reports").select("*");
      if ("mine" in scope) q = q.eq("teacher_contact_id", scope.mine!);
      else if ("shared" in scope) q = q.neq("teacher_contact_id", scope.shared!).eq("kind", "lesson");
      else q = q.eq("owner_id", scope.owner);
      if (range) q = q.gte("report_date", range.from).lte("report_date", range.to);
      const { data, error } = await q
        .order("report_date", { ascending: false })
        .order("start_time", { ascending: false })
        .limit(500);
      if (error) throw new Error(friendly(error.message));
      return (data ?? []) as TutorReport[];
    },
  });
}

/** 每筆紀錄的留言數（清單上標示） */
export function useCommentCounts(reportIds: string[]) {
  return useQuery({
    queryKey: ["tutor", "comment-counts", reportIds],
    enabled: reportIds.length > 0,
    queryFn: async (): Promise<Map<string, number>> => {
      const { data, error } = await createClient()
        .from("tutor_report_comments")
        .select("report_id")
        .in("report_id", reportIds);
      if (error) throw new Error(friendly(error.message));
      const m = new Map<string, number>();
      for (const r of data ?? []) m.set(r.report_id, (m.get(r.report_id) ?? 0) + 1);
      return m;
    },
  });
}

export function useComments(reportId: string | null) {
  return useQuery({
    queryKey: ["tutor", "comments", reportId],
    enabled: !!reportId,
    queryFn: async (): Promise<TutorComment[]> => {
      const { data, error } = await createClient()
        .from("tutor_report_comments")
        .select("*")
        .eq("report_id", reportId!)
        .order("created_at", { ascending: true });
      if (error) throw new Error(friendly(error.message));
      return (data ?? []) as TutorComment[];
    },
  });
}

export async function addComment(reportId: string, authorId: string, body: string): Promise<string | null> {
  const { error } = await createClient()
    .from("tutor_report_comments")
    .insert({ report_id: reportId, author_id: authorId, body: body.trim() });
  return error ? friendly(error.message) : null;
}

export async function deleteComment(id: string): Promise<string | null> {
  const { error } = await createClient().from("tutor_report_comments").delete().eq("id", id);
  return error ? friendly(error.message) : null;
}

export interface SaveReportInput {
  id?: string;
  profile: TutorProfile;
  authorId: string;
  kind: "lesson" | "daily";
  reportDate: string;
  subject: string | null;
  start: string | null;
  end: string | null;
  mode: string | null;
  studentIds: string[];
  eventId: string | null;
  /** 修改時原本連的課與自動寫的回饋 id */
  prevEventId: string | null;
  prevEventNoteId: string | null;
  content: Record<string, unknown>;
  minutes: number;
  minutesByCategory: Record<string, number>;
  studentName: (id: string) => string;
}

/**
 * 新增／修改一筆紀錄。上課紀錄有連到行事曆那堂課時，
 * 另外在那堂課寫一則回饋摘要（作者＝老師），讓「缺回饋不付款」「學習回饋」照常運作。
 * 同一堂課就原地更新摘要（保留家長端做過的依小孩拆分）；換課或取消連結才刪舊寫新。
 * 摘要失敗不影響紀錄本身（回傳警告）。
 */
export async function saveReport(x: SaveReportInput): Promise<{ error?: string; warning?: string; id?: string }> {
  const supabase = createClient();
  const row = {
    teacher_contact_id: x.profile.contactId,
    kind: x.kind,
    report_date: x.reportDate,
    subject: x.subject,
    start_time: x.start || null,
    end_time: x.end || null,
    mode: x.mode,
    student_ids: x.studentIds,
    event_id: x.eventId,
    content: x.content,
    minutes: x.minutes,
    minutes_by_category: x.minutesByCategory,
  };
  let id = x.id;
  if (id) {
    const { error } = await supabase.from("tutor_reports").update(row).eq("id", id);
    if (error) return { error: friendly(error.message) };
  } else {
    const { data, error } = await supabase
      .from("tutor_reports")
      .insert({ ...row, owner_id: x.profile.ownerId, author_id: x.authorId })
      .select("id")
      .single();
    if (error) {
      if (/tutor_reports_daily_once|duplicate key/i.test(error.message)) {
        return { error: "這天已經有一筆每日回報了，請到「我的紀錄」打開那筆修改" };
      }
      return { error: friendly(error.message) };
    }
    id = data.id;
  }

  // 行事曆回饋摘要
  const NOTE_WARN = "紀錄已存，但沒能同步到行事曆那堂課的回饋";
  const wantNote = x.kind === "lesson" && !!x.eventId && !!x.subject;
  const noteBody = wantNote
    ? {
        content: lessonNoteText(x.subject!, x.content as unknown as LessonContent, x.studentName),
        progress_label: (x.content as { unit?: string }).unit || null,
      }
    : null;

  // 同一堂課、已有摘要 → 原地更新
  if (wantNote && x.prevEventNoteId && x.prevEventId === x.eventId) {
    const { error } = await supabase.from("event_notes").update(noteBody!).eq("id", x.prevEventNoteId);
    return { id, warning: error ? NOTE_WARN : undefined };
  }
  // 換課或取消連結 → 先刪舊摘要；刪不掉就不寫新的，避免同一堂課兩則
  if (x.prevEventNoteId) {
    const { error } = await supabase.from("event_notes").delete().eq("id", x.prevEventNoteId);
    if (error) return { id, warning: NOTE_WARN };
    await supabase.from("tutor_reports").update({ event_note_id: null }).eq("id", id!);
  }
  if (!wantNote) return { id };
  const { data: note, error: noteErr } = await supabase
    .from("event_notes")
    .insert({ event_id: x.eventId!, author_id: x.authorId, ...noteBody! })
    .select("id")
    .single();
  if (noteErr) return { id, warning: NOTE_WARN };
  const { error: linkErr } = await supabase.from("tutor_reports").update({ event_note_id: note.id }).eq("id", id!);
  if (linkErr) {
    // 連不上就把剛寫的摘要刪掉，下次修改才不會多一則
    await supabase.from("event_notes").delete().eq("id", note.id);
    return { id, warning: NOTE_WARN };
  }
  return { id };
}

/** 刪紀錄；連到行事曆的回饋摘要由資料庫觸發器一併刪除 */
export async function deleteReport(r: TutorReport): Promise<string | null> {
  const { error } = await createClient().from("tutor_reports").delete().eq("id", r.id);
  return error ? friendly(error.message) : null;
}

/** 老師某天在行事曆上的課（帶入時間用） */
export function useTeacherLessonsOn(date: string, enabled: boolean) {
  return useQuery({
    queryKey: ["tutor", "lessons-on", date],
    enabled: enabled && /^\d{4}-\d{2}-\d{2}$/.test(date),
    queryFn: async () => {
      const from = new Date(`${date}T00:00:00+08:00`).toISOString();
      const to = new Date(`${date}T23:59:59+08:00`).toISOString();
      const { data, error } = await createClient().rpc("teacher_lessons", { p_from: from, p_to: to });
      if (error) return [];
      return (data ?? []).filter((l) => !l.all_day);
    },
  });
}

/** 家長端：老師（有 tutor_kind 的人物）與上課學生 */
export interface TutorContact {
  id: string;
  name: string;
  tutor_kind: "specialist" | "home" | null;
  tutor_subjects: string[];
  tutor_shared: boolean;
  is_student: boolean;
  is_family: boolean;
}

export function useTutorContacts(ownerId: string | null) {
  return useQuery({
    queryKey: ["tutor", "contacts", ownerId],
    enabled: !!ownerId,
    queryFn: async (): Promise<TutorContact[]> => {
      const { data, error } = await createClient()
        .from("contacts")
        .select("id, name, tutor_kind, tutor_subjects, tutor_shared, is_student, is_family")
        .eq("owner_id", ownerId!)
        .order("name");
      if (error) throw new Error(friendly(error.message));
      return (data ?? []) as unknown as TutorContact[];
    },
  });
}

/** 家長端：家庭老師各工作類別時薪（只有家長讀得到） */
export function useTutorRates(ownerId: string | null) {
  return useQuery({
    queryKey: ["tutor", "rates", ownerId],
    enabled: !!ownerId,
    queryFn: async (): Promise<Map<string, Record<string, number>>> => {
      const { data, error } = await createClient()
        .from("tutor_rate_settings")
        .select("contact_id, rates")
        .eq("owner_id", ownerId!);
      if (error) return new Map();
      return new Map((data ?? []).map((r) => [r.contact_id, (r.rates ?? {}) as Record<string, number>]));
    },
  });
}
