"use server";

import { getAuthed, fail, type ActionResult } from "./helpers";

/** 讀自己的「使用習慣」（0026 前沒有這欄 → 回 null，畫面提示要先套 migration） */
export async function getHabitsAction(): Promise<ActionResult<string | null>> {
  try {
    const { supabase, user } = await getAuthed();
    const { data, error } = await supabase
      .from("profiles")
      .select("habits_text")
      .eq("id", user.id)
      .maybeSingle();
    if (error) return /habits_text/.test(error.message) ? { ok: true, data: null } : fail(error.message);
    return { ok: true, data: data?.habits_text ?? "" };
  } catch (e) {
    return fail((e as Error).message);
  }
}

/** 存自己的「使用習慣」（語音新增時交給 AI，見 docs/specs/測試回饋第四輪-月曆連續捲動與語音人名.md §三） */
export async function saveHabitsAction(text: string): Promise<ActionResult> {
  try {
    const { supabase, user } = await getAuthed();
    const clean = text.replace(/\r\n/g, "\n").trim().slice(0, 4000);
    const { error } = await supabase
      .from("profiles")
      .update({ habits_text: clean || null })
      .eq("id", user.id);
    if (error) return fail(error.message);
    return { ok: true, data: undefined };
  } catch (e) {
    return fail((e as Error).message);
  }
}
