"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthed, fail, type ActionResult } from "./helpers";

const noteSchema = z.object({
  eventId: z.uuid(),
  content: z.string().trim().min(1, { error: "請輸入回饋內容" }).max(2000),
  progressLabel: z.string().trim().max(80).optional().nullable(),
});

export async function createNoteAction(input: unknown): Promise<ActionResult> {
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "輸入有誤");
  try {
    const { supabase, user } = await getAuthed();
    const { error } = await supabase.from("event_notes").insert({
      event_id: parsed.data.eventId,
      author_id: user.id,
      content: parsed.data.content,
      progress_label: parsed.data.progressLabel ?? null,
    });
    if (error) return fail(error.message);
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
