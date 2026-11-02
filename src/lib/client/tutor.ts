"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/types/database";
import { lessonNoteText, type LessonContent, type Photo } from "@/lib/tutor";

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

/** 資料庫訊息 → 看得懂的中文：TUTOR: 前綴是觸發器的檢查；表／函式不存在＝還沒套 migration */
function friendly(msg: string): string {
  const m = /TUTOR:(.+)$/.exec(msg);
  if (m) return m[1].trim();
  if (/does not exist|schema cache|Could not find/i.test(msg)) return MISSING;
  if (/row-level security/i.test(msg)) return "沒有權限做這個動作（可能是帳號或老師設定變了），請通知家長";
  return msg;
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
  /** 新照片：存檔後上傳到 r/<紀錄 id>/；content.photos 會自動補上 */
  newPhotos?: { file: File; section: Photo["section"] }[];
  /** 修改時移除的舊照片路徑 */
  removedPaths?: string[];
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
  // 新紀錄先決定 id，照片路徑才能一起寫進內容
  const id = x.id ?? crypto.randomUUID();
  const planned = (x.newPhotos ?? []).map((p) => ({
    ...p,
    path: `r/${id}/${crypto.randomUUID()}.jpg`,
  }));
  // 只認這筆紀錄自己資料夾的照片（防止內容被塞進別筆的路徑）
  const own = (p: string) => p.startsWith(`r/${id}/`);
  const removed = (x.removedPaths ?? []).filter(own);
  const kept = ((x.content.photos as Photo[] | undefined) ?? []).filter((p) => own(p.path) && !removed.includes(p.path));
  const content = { ...x.content, photos: [...kept, ...planned.map(({ path, section }) => ({ path, section }))] };

  const core = await saveReportCore({ ...x, id, content }, !x.id);
  if (core.error) return core;

  const warnings = core.warning ? [core.warning] : [];
  // 上傳新照片（紀錄要先存在，權限才過）；失敗的從內容拿掉
  const failed: string[] = [];
  for (const p of planned) {
    const err = await uploadFile(p.path, p.file);
    if (err) failed.push(p.path);
  }
  if (failed.length) {
    await createClient()
      .from("tutor_reports")
      .update({ content: { ...content, photos: content.photos.filter((p) => !failed.includes(p.path)) } })
      .eq("id", id);
    warnings.push(`有 ${failed.length} 張照片沒有上傳成功（只能傳 JPG／PNG，HEIC 請先轉成 JPG），請再試一次`);
  }
  if (removed.length && (await removeFiles(removed))) warnings.push("有照片沒刪乾淨，不影響紀錄");
  return { id, warning: warnings.length ? warnings.join("；") : undefined };
}

async function saveReportCore(
  x: SaveReportInput & { id: string },
  isNew: boolean,
): Promise<{ error?: string; warning?: string; id?: string }> {
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
  const id = x.id;
  if (!isNew) {
    const { error } = await supabase.from("tutor_reports").update(row).eq("id", id);
    if (error) return { error: friendly(error.message) };
  } else {
    const { error } = await supabase
      .from("tutor_reports")
      .insert({ ...row, id, owner_id: x.profile.ownerId, author_id: x.authorId });
    if (error) {
      if (/tutor_reports_daily_once|duplicate key/i.test(error.message)) {
        return { error: "這天已經有一筆每日回報了，請到「我的紀錄」打開那筆修改" };
      }
      return { error: friendly(error.message) };
    }
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

/** 刪紀錄；照片先刪（紀錄還在權限才過），行事曆回饋摘要由資料庫觸發器一併刪除 */
export async function deleteReport(r: TutorReport): Promise<string | null> {
  const photos = ((r.content as { photos?: Photo[] }).photos ?? [])
    .map((p) => p.path)
    .filter((p) => p.startsWith(`r/${r.id}/`));
  // 照片刪不掉就先別刪紀錄（紀錄刪了就沒有權限再刪照片）
  if (photos.length) {
    const err = await removeFiles(photos);
    if (err) return `照片刪除失敗，請再試一次（${err}）`;
  }
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

// ---------------- 照片（Storage：tutor-files） ----------------

const BUCKET = "tutor-files";

/**
 * 手機照片動輒 3–5MB：縮到長邊 1600px、JPEG 品質 0.82 再上傳。
 * 瀏覽器解不開（例如電腦上的 HEIC）→ JPG／PNG／WebP 傳原檔，其他格式回 null（請使用者改傳 JPG）。
 */
async function compress(file: File): Promise<Blob | null> {
  const fallback = /^image\/(jpeg|png|webp)$/.test(file.type) ? file : null;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.82));
    return blob ?? fallback;
  } catch {
    return fallback;
  }
}

/** 上傳一張照片到指定路徑；回傳錯誤訊息（null＝成功） */
export async function uploadFile(path: string, file: File): Promise<string | null> {
  const blob = await compress(file);
  if (!blob) return "這種照片格式無法上傳，請改傳 JPG";
  const { error } = await createClient()
    .storage.from(BUCKET)
    .upload(path, blob, { contentType: blob.type || "image/jpeg", upsert: false });
  return error ? friendly(error.message) : null;
}

/** 刪檔；回傳錯誤訊息（null＝成功） */
export async function removeFiles(paths: string[]): Promise<string | null> {
  if (!paths.length) return null;
  const { error } = await createClient().storage.from(BUCKET).remove(paths);
  return error ? error.message : null;
}

/** 私有照片的暫時網址（1 小時） */
export function useSignedUrls(paths: string[]) {
  return useQuery({
    queryKey: ["tutor", "signed", paths],
    enabled: paths.length > 0,
    staleTime: 30 * 60 * 1000,
    queryFn: async (): Promise<Map<string, string>> => {
      const { data } = await createClient().storage.from(BUCKET).createSignedUrls(paths, 3600);
      return new Map((data ?? []).flatMap((d) => (d.signedUrl && d.path ? [[d.path, d.signedUrl] as const] : [])));
    },
  });
}

// ---------------- 週課表 ----------------

export type ScheduleItem = Tables<"tutor_schedule_items">;

export function useSchedule(ownerId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ["tutor", "schedule", ownerId, from, to],
    enabled: !!ownerId,
    queryFn: async (): Promise<ScheduleItem[]> => {
      const { data, error } = await createClient()
        .from("tutor_schedule_items")
        .select("*")
        .eq("owner_id", ownerId!)
        .gte("item_date", from)
        .lte("item_date", to)
        .order("item_date")
        .order("start_time");
      if (error) throw new Error(friendly(error.message));
      return (data ?? []) as ScheduleItem[];
    },
  });
}

export type ScheduleDraft = Pick<
  ScheduleItem,
  "item_date" | "start_time" | "end_time" | "title" | "responsible" | "tag" | "is_exam" | "status"
>;

export async function saveScheduleItem(
  ownerId: string,
  userId: string,
  d: ScheduleDraft,
  id?: string,
): Promise<string | null> {
  const supabase = createClient();
  const { error } = id
    ? await supabase
        .from("tutor_schedule_items")
        .update({ ...d, updated_at: new Date().toISOString() })
        .eq("id", id)
    : await supabase.from("tutor_schedule_items").insert({ ...d, owner_id: ownerId, created_by: userId });
  return error ? friendly(error.message) : null;
}

export async function deleteScheduleItem(id: string): Promise<string | null> {
  const { error } = await createClient().from("tutor_schedule_items").delete().eq("id", id);
  return error ? friendly(error.message) : null;
}

/** 把上週的課表複製到這週（請假／停課不複製狀態） */
export async function copyScheduleWeek(
  ownerId: string,
  userId: string,
  items: ScheduleItem[],
  dayShift: number,
): Promise<string | null> {
  if (!items.length) return "上週沒有課表可以複製";
  const rows = items.map((it) => ({
    owner_id: ownerId,
    created_by: userId,
    item_date: new Date(Date.parse(`${it.item_date}T12:00:00Z`) + dayShift * 86400000).toISOString().slice(0, 10),
    start_time: it.start_time,
    end_time: it.end_time,
    title: it.title,
    responsible: it.responsible,
    tag: "",
    is_exam: false,
    status: "" as const,
  }));
  const { error } = await createClient().from("tutor_schedule_items").insert(rows);
  return error ? friendly(error.message) : null;
}

/** 週課表圖片（過渡期直接上傳 Excel 截圖）：s/<家長>/<週一>/ */
export function useScheduleImages(ownerId: string | null, monday: string) {
  return useQuery({
    queryKey: ["tutor", "schedule-images", ownerId, monday],
    enabled: !!ownerId,
    queryFn: async (): Promise<string[]> => {
      const folder = `s/${ownerId}/${monday}`;
      const { data, error } = await createClient().storage.from(BUCKET).list(folder, { limit: 50 });
      if (error) return [];
      return (data ?? []).filter((f) => f.name && !f.name.startsWith(".")).map((f) => `${folder}/${f.name}`);
    },
  });
}

// ---------------- 課本單元清單 ----------------

export function useUnits(ownerId: string | null) {
  return useQuery({
    queryKey: ["tutor", "units", ownerId],
    enabled: !!ownerId,
    queryFn: async (): Promise<Map<string, string[]>> => {
      const { data, error } = await createClient()
        .from("tutor_units")
        .select("subject, units")
        .eq("owner_id", ownerId!);
      if (error) return new Map();
      return new Map((data ?? []).map((r) => [r.subject, r.units ?? []]));
    },
  });
}

export async function saveUnits(ownerId: string, subject: string, units: string[]): Promise<string | null> {
  const { error } = await createClient()
    .from("tutor_units")
    .upsert({ owner_id: ownerId, subject, units, updated_at: new Date().toISOString() }, { onConflict: "owner_id,subject" });
  return error ? friendly(error.message) : null;
}

// ---------------- 待辦已處理 ----------------

export function useTodoDone(ownerId: string | null) {
  return useQuery({
    queryKey: ["tutor", "todo-done", ownerId],
    enabled: !!ownerId,
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await createClient().from("tutor_todo_done").select("key").eq("owner_id", ownerId!);
      if (error) return new Set();
      return new Set((data ?? []).map((r) => r.key));
    },
  });
}

export async function setTodoDone(ownerId: string, key: string, done: boolean): Promise<string | null> {
  const supabase = createClient();
  const { error } = done
    ? await supabase.from("tutor_todo_done").upsert({ owner_id: ownerId, key }, { onConflict: "owner_id,key" })
    : await supabase.from("tutor_todo_done").delete().eq("owner_id", ownerId).eq("key", key);
  return error ? friendly(error.message) : null;
}
