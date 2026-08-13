"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthed, fail, type ActionResult } from "./helpers";

/** 就地標記一或多筆財務的結清狀態 */
export async function settleFinanceAction(
  ids: string[],
  settled: boolean,
): Promise<ActionResult> {
  const parsed = z.array(z.uuid()).min(1).safeParse(ids);
  if (!parsed.success) return fail("參數有誤");
  try {
    const { supabase } = await getAuthed();
    const { error } = await supabase
      .from("finance_records")
      .update({ is_settled: settled })
      .in("id", parsed.data);
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}
