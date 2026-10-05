"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthed, fail, type ActionResult } from "./helpers";

const nameSchema = z.string().trim().min(1, { error: "請輸入標籤名稱" }).max(30);

/**
 * 標籤改名。若新名稱已存在，就把這個標籤「合併」進既有的標籤
 * （所有行程改掛既有標籤、刪掉舊標籤），用來整理「運動／健身」這類同義標籤。
 */
export async function renameTagAction(
  id: string,
  rawName: string,
): Promise<ActionResult<{ merged: boolean }>> {
  if (!z.uuid().safeParse(id).success) return fail("參數有誤");
  const parsed = nameSchema.safeParse(rawName);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "名稱有誤");
  const name = parsed.data;
  try {
    const { supabase, user } = await getAuthed();
    const { data: target } = await supabase
      .from("tags")
      .select("id")
      .eq("owner_id", user.id)
      .eq("name", name)
      .neq("id", id)
      .maybeSingle();

    if (!target) {
      const { error } = await supabase.from("tags").update({ name }).eq("id", id);
      if (error) return fail(error.message);
      revalidatePath("/", "layout");
      return { ok: true, data: { merged: false } };
    }

    // 合併：舊標籤的行程改掛到既有標籤（已經有掛的跳過）
    const [{ data: fromRows }, { data: toRows }] = await Promise.all([
      supabase.from("event_tags").select("event_id").eq("tag_id", id),
      supabase.from("event_tags").select("event_id").eq("tag_id", target.id),
    ]);
    const already = new Set((toRows ?? []).map((r) => r.event_id));
    const moveRows = (fromRows ?? [])
      .filter((r) => !already.has(r.event_id))
      .map((r) => ({ event_id: r.event_id, tag_id: target.id }));
    if (moveRows.length) {
      const { error } = await supabase.from("event_tags").insert(moveRows);
      if (error) return fail(error.message);
    }
    // 刪舊標籤（event_tags 會跟著 cascade 刪除）
    const { error: delErr } = await supabase.from("tags").delete().eq("id", id);
    if (delErr) return fail(delErr.message);
    revalidatePath("/", "layout");
    return { ok: true, data: { merged: true } };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}

/** 刪除標籤：只拿掉標籤本身與它在各行程上的關聯，行程不會被刪 */
export async function deleteTagAction(id: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success) return fail("參數有誤");
  try {
    const { supabase } = await getAuthed();
    const { error } = await supabase.from("tags").delete().eq("id", id);
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}
