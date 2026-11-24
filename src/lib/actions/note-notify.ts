"use server";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyOwnerOfNote } from "@/lib/note-notify";
import { getAuthed } from "./helpers";

/**
 * 前端直接寫入回饋後（老師「我的課」、家教填報）呼叫：確認是自己剛寫的才推播，避免被拿來亂推。
 */
export async function notifyNoteAction(noteId: string): Promise<void> {
  if (!z.uuid().safeParse(noteId).success) return;
  try {
    const { user } = await getAuthed();
    const { data } = await createAdminClient()
      .from("event_notes")
      .select("author_id, created_at")
      .eq("id", noteId)
      .maybeSingle();
    if (!data || data.author_id !== user.id) return;
    if (Date.now() - Date.parse(data.created_at) > 10 * 60_000) return;
    await notifyOwnerOfNote(noteId);
  } catch {
    /* 推播失敗不影響回饋 */
  }
}
