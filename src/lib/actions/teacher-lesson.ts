"use server";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushToUser } from "@/lib/push";
import { taipeiWallToUtcISO } from "@/lib/date";
import { notifyOwnerOfNote } from "@/lib/note-notify";
import { getAuthed, fail, type ActionResult } from "./helpers";

/**
 * 老師補登一堂課（家庭老師沒排到行事曆上，老師就沒地方寫回饋；Peggy 11/24）。
 * 課建在家長的小孩分類（依學生選「哥哥」「妹妹」「哥哥+妹妹」），相關人物＝老師、主角＝學生，
 * 可以一起寫回饋；推播通知家長。不記費用（家長在行程上補）。
 */
const schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
  title: z.string().trim().min(1, "請填課名").max(60),
  studentIds: z.array(z.uuid()).min(1, "請選學生").max(6),
  progress: z.string().trim().max(1000).optional().default(""),
  content: z.string().trim().max(4000).optional().default(""),
});

export async function teacherAddLessonAction(input: unknown): Promise<ActionResult<{ eventId: string }>> {
  const p = schema.safeParse(input);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "資料有誤");
  const v = p.data;
  if (v.end <= v.start) return fail("結束時間要晚於開始時間");
  const startsAt = taipeiWallToUtcISO(`${v.date}T${v.start}`);
  if (Date.parse(startsAt) > Date.now() + 864e5) return fail("補登只能登已經上過（或今天）的課");
  try {
    const { supabase, user } = await getAuthed();
    const { data: links } = await supabase.rpc("my_teacher_links");
    const link = links?.[0];
    if (!link) return fail("這個帳號不是老師帳號");
    const admin = createAdminClient();
    const { data: teacher } = await admin.from("contacts").select("id, owner_id, name").eq("id", link.contact_id).single();
    if (!teacher) return fail("找不到老師資料");
    const ownerId = teacher.owner_id;
    const { data: students } = await admin
      .from("contacts")
      .select("id, name")
      .eq("owner_id", ownerId)
      .eq("is_student", true)
      .in("id", v.studentIds);
    if (!students?.length || students.length !== v.studentIds.length) return fail("學生不正確");
    // 分類：名稱剛好等於學生組合（哥哥+妹妹）或單一學生名，找不到就用小孩類的第一個
    const { data: cals } = await admin.from("calendars").select("id, name, kind").eq("owner_id", ownerId);
    const names = students.map((s) => s.name);
    const cal =
      cals?.find((c) => names.length > 1 && names.every((n) => c.name.includes(n)) && c.name.includes("+")) ??
      cals?.find((c) => names.length === 1 && c.name === names[0]) ??
      cals?.find((c) => c.kind === "child");
    if (!cal) return fail("家長沒有小孩分類，請通知家長");

    const { data: ev, error } = await admin
      .from("events")
      .insert({
        calendar_id: cal.id,
        creator_id: user.id,
        title: `${v.title}-${names.join("、")}`,
        starts_at: startsAt,
        ends_at: taipeiWallToUtcISO(`${v.date}T${v.end}`),
        description: `（${teacher.name} 老師補登）`,
      })
      .select("id")
      .single();
    if (error || !ev) return fail(error?.message ?? "新增失敗");
    await admin.from("event_contacts").insert([
      { event_id: ev.id, contact_id: teacher.id, role: "participant" },
      ...students.map((s) => ({ event_id: ev.id, contact_id: s.id, role: "subject" as const })),
    ]);

    if (v.content) {
      const { data: note } = await admin
        .from("event_notes")
        .insert({ event_id: ev.id, author_id: user.id, content: v.content, progress_label: v.progress || null })
        .select("id")
        .single();
      if (note) await notifyOwnerOfNote(note.id);
    } else {
      try {
        await sendPushToUser(admin, ownerId, {
          title: `${teacher.name} 老師補登了一堂課`,
          body: `${Number(v.date.slice(5, 7))}/${Number(v.date.slice(8, 10))} ${v.start}–${v.end}｜${v.title}-${names.join("、")}`,
          tag: `lesson-${ev.id}`,
          url: `/calendar?date=${v.date}&view=day`,
        });
      } catch {
        /* 推播失敗不影響 */
      }
    }
    return { ok: true, data: { eventId: ev.id } };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}
