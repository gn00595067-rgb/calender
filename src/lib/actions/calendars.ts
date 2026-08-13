"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthed, fail, type ActionResult } from "./helpers";

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, { error: "顏色格式需為 #RRGGBB" });
const kind = z.enum(["self", "child", "work", "private", "other"]);

const createSchema = z.object({
  name: z.string().trim().min(1, { error: "請輸入分類名稱" }).max(40),
  kind,
  color: hexColor,
});

const updateSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(40),
  color: hexColor,
});

function revalidateAll() {
  revalidatePath("/", "layout");
}

export async function createCalendarAction(input: unknown): Promise<ActionResult> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "輸入有誤");

  try {
    const { supabase, user } = await getAuthed();
    // 新分類排在最後
    const { count } = await supabase
      .from("calendars")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", user.id);

    const { error } = await supabase.from("calendars").insert({
      owner_id: user.id,
      name: parsed.data.name,
      kind: parsed.data.kind,
      color: parsed.data.color,
      position: count ?? 0,
    });
    if (error) return fail(error.message);
    revalidateAll();
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}

export async function updateCalendarAction(input: unknown): Promise<ActionResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "輸入有誤");

  try {
    const { supabase } = await getAuthed();
    const { error } = await supabase
      .from("calendars")
      .update({ name: parsed.data.name, color: parsed.data.color })
      .eq("id", parsed.data.id);
    if (error) return fail(error.message);
    revalidateAll();
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}

export async function deleteCalendarAction(id: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success) return fail("參數有誤");
  try {
    const { supabase } = await getAuthed();
    const { error } = await supabase.from("calendars").delete().eq("id", id);
    if (error) return fail(error.message);
    revalidateAll();
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}

/** 與相鄰分類交換 position（上移／下移） */
export async function moveCalendarAction(
  id: string,
  direction: "up" | "down",
): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success) return fail("參數有誤");
  try {
    const { supabase, user } = await getAuthed();
    const { data: cals, error } = await supabase
      .from("calendars")
      .select("id, position")
      .eq("owner_id", user.id)
      .order("position", { ascending: true });
    if (error) return fail(error.message);

    const list = cals ?? [];
    const idx = list.findIndex((c) => c.id === id);
    if (idx === -1) return fail("找不到分類");
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= list.length) return { ok: true, data: undefined };

    const a = list[idx];
    const b = list[swapIdx];
    // 正規化 position 為索引順序，交換兩者
    await Promise.all([
      supabase.from("calendars").update({ position: swapIdx }).eq("id", a.id),
      supabase.from("calendars").update({ position: idx }).eq("id", b.id),
    ]);
    revalidateAll();
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}
