"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthed, fail, type ActionResult } from "./helpers";

const roleEnum = z.enum(["editor", "contributor", "viewer"]);

const inviteSchema = z.object({
  calendarId: z.uuid(),
  email: z.email({ error: "請輸入有效的 Email" }),
  role: roleEnum,
});

export async function inviteShareAction(input: unknown): Promise<ActionResult> {
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "輸入有誤");
  const email = parsed.data.email.toLowerCase();

  try {
    const { supabase, user } = await getAuthed();

    // 僅擁有者可邀請（RLS 也會擋，這裡先友善檢查）
    const { data: cal } = await supabase
      .from("calendars")
      .select("owner_id")
      .eq("id", parsed.data.calendarId)
      .single();
    if (!cal || cal.owner_id !== user.id) return fail("你沒有管理此行事曆分享的權限");
    if (email === (user.email ?? "").toLowerCase())
      return fail("不需分享給自己");

    // 若對方已有帳號，順便回填 member_id
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    const { error } = await supabase.from("calendar_shares").insert({
      calendar_id: parsed.data.calendarId,
      invited_email: email,
      role: parsed.data.role,
      member_id: profile?.id ?? null,
    });
    if (error) {
      if (/duplicate|unique/i.test(error.message))
        return fail("此 Email 已被邀請至該行事曆");
      return fail(error.message);
    }
    revalidatePath("/", "layout");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}

export async function updateShareRoleAction(
  shareId: string,
  role: "editor" | "contributor" | "viewer",
): Promise<ActionResult> {
  if (!z.uuid().safeParse(shareId).success) return fail("參數有誤");
  if (!roleEnum.safeParse(role).success) return fail("角色有誤");
  try {
    const { supabase } = await getAuthed();
    const { error } = await supabase
      .from("calendar_shares")
      .update({ role })
      .eq("id", shareId);
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}

export async function removeShareAction(shareId: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(shareId).success) return fail("參數有誤");
  try {
    const { supabase } = await getAuthed();
    const { error } = await supabase.from("calendar_shares").delete().eq("id", shareId);
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}
