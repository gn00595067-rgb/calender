"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthed, fail, type ActionResult } from "./helpers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const partSchema = z.object({
  /** 哪個小孩；null＝共同內容 */
  subjectId: z.uuid().nullable(),
  content: z.string().trim().min(1).max(4000),
});

/** 拆分確認時學到的別名（原文寫 Rick、對應到哥哥 → 哥哥多一個別名 Rick） */
const aliasSchema = z.object({
  contactId: z.uuid(),
  alias: z.string().trim().min(1).max(40),
});

const noteSchema = z.object({
  eventId: z.uuid(),
  content: z.string().trim().min(1, { error: "請輸入回饋內容" }).max(4000),
  progressLabel: z.string().trim().max(80).optional().nullable(),
  /** 依小孩拆分的段落（多個主角時）；未提供＝不拆 */
  parts: z.array(partSchema).max(10).optional(),
  learnAliases: z.array(aliasSchema).max(10).optional(),
});

const partsSchema = z.object({
  noteId: z.uuid(),
  parts: z.array(partSchema).max(10),
  learnAliases: z.array(aliasSchema).max(10).optional(),
});

type DB = SupabaseClient<Database>;

/** 覆寫某則回饋的拆分段落；回傳錯誤訊息或 null */
async function writeParts(
  supabase: DB,
  noteId: string,
  parts: z.infer<typeof partSchema>[],
): Promise<string | null> {
  const { error: delErr } = await supabase.from("note_parts").delete().eq("note_id", noteId);
  if (delErr) return partsError(delErr.message);
  if (parts.length === 0) return null;
  const { error } = await supabase.from("note_parts").insert(
    parts.map((p, i) => ({
      note_id: noteId,
      subject_contact_id: p.subjectId,
      content: p.content,
      position: i,
    })),
  );
  return error ? partsError(error.message) : null;
}

function partsError(message: string): string {
  // 尚未套 0017：note_parts 表不存在
  if (/note_parts/.test(message) && /exist|schema cache/i.test(message))
    return "依小孩拆分需先套用資料庫更新（0017），回饋本身已存好";
  return message;
}

/** 把學到的別名加進人物（已有就略過；不是自己的人物或尚未套 0017 時靜默略過） */
async function learnAliases(supabase: DB, items: z.infer<typeof aliasSchema>[]) {
  for (const { contactId, alias } of items) {
    const { data } = await supabase
      .from("contacts")
      .select("*")
      .eq("id", contactId)
      .maybeSingle();
    if (!data || !Array.isArray(data.aliases)) continue;
    const lower = alias.toLowerCase();
    if (data.name.toLowerCase() === lower) continue;
    if (data.aliases.some((a) => a.toLowerCase() === lower)) continue;
    await supabase
      .from("contacts")
      .update({ aliases: [...data.aliases, alias] })
      .eq("id", contactId);
  }
}

export async function createNoteAction(
  input: unknown,
): Promise<ActionResult<{ partsWarning: string | null }>> {
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "輸入有誤");
  try {
    const { supabase, user } = await getAuthed();
    const { data: note, error } = await supabase
      .from("event_notes")
      .insert({
        event_id: parsed.data.eventId,
        author_id: user.id,
        content: parsed.data.content,
        progress_label: parsed.data.progressLabel ?? null,
      })
      .select("id")
      .single();
    if (error || !note) return fail(error?.message ?? "新增失敗");
    let partsWarning: string | null = null;
    if (parsed.data.parts?.length) {
      partsWarning = await writeParts(supabase, note.id, parsed.data.parts);
    }
    if (parsed.data.learnAliases?.length) await learnAliases(supabase, parsed.data.learnAliases);
    revalidatePath("/", "layout");
    return { ok: true, data: { partsWarning } };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}

/** 已存的回饋補拆／重拆（只有作者可以，RLS 把關） */
export async function saveNotePartsAction(input: unknown): Promise<ActionResult> {
  const parsed = partsSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "輸入有誤");
  try {
    const { supabase } = await getAuthed();
    const err = await writeParts(supabase, parsed.data.noteId, parsed.data.parts);
    if (err) return fail(err);
    if (parsed.data.learnAliases?.length) await learnAliases(supabase, parsed.data.learnAliases);
    revalidatePath("/", "layout");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}

export async function deleteNoteAction(id: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success) return fail("參數有誤");
  try {
    const { supabase } = await getAuthed();
    const { error } = await supabase.from("event_notes").delete().eq("id", id);
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}
