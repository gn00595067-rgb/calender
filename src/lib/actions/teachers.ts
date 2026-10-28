"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { getAuthed, fail, type ActionResult } from "./helpers";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 老師帳號：家長在人物管理按一下就建好登入帳號，老師登入後只看得到自己的課、只能寫回饋。
 * spec：docs/specs/老師自填回饋與缺回饋不付款.md
 */

/** 好念好打的密碼：去掉 0/O、1/l/I 等容易看錯的字 */
function makePassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(8);
  return [...bytes].map((b) => chars[b % chars.length]).join("");
}

/** 確認是自己的人物（非家人）；回傳人物資料 */
async function ownContact(contactId: string) {
  const { supabase, user } = await getAuthed();
  const { data, error } = await supabase
    .from("contacts")
    .select("*")
    .eq("id", contactId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("找不到這位人物");
  if (data.is_family) throw new Error("家人不能建立老師帳號");
  return { supabase, contact: data };
}

const MISSING_0021 = "老師帳號需先套用資料庫更新（0021）";

export async function createTeacherAccountAction(
  contactId: string,
  emailInput: string | null,
): Promise<ActionResult<{ email: string; password: string }>> {
  if (!z.uuid().safeParse(contactId).success) return fail("參數有誤");
  const email = emailInput?.trim().toLowerCase() || `t-${randomBytes(3).toString("hex")}@execcal.test`;
  if (!z.email().safeParse(email).success) return fail("Email 格式不正確");
  try {
    const { supabase, contact } = await ownContact(contactId);
    if (!("teacher_user_id" in contact)) return fail(MISSING_0021);
    if (contact.teacher_user_id) return fail("這位老師已經有帳號了，要換密碼請按「重設密碼」");

    const admin = createAdminClient();
    const password = makePassword();
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: contact.name, role: "teacher" },
    });
    if (error || !data.user) {
      return fail(
        /already|registered|exists/i.test(error?.message ?? "")
          ? "這個 Email 已經有帳號了，請換一個（或留空自動產生）"
          : (error?.message ?? "建立帳號失敗"),
      );
    }
    const { error: linkErr } = await supabase
      .from("contacts")
      .update({ teacher_user_id: data.user.id })
      .eq("id", contactId);
    if (linkErr) {
      // 連不上就把剛建的帳號刪掉，避免留下沒人管的帳號
      await admin.auth.admin.deleteUser(data.user.id);
      return fail(/teacher_user_id/.test(linkErr.message) ? MISSING_0021 : linkErr.message);
    }
    revalidatePath("/settings/contacts");
    return { ok: true, data: { email, password } };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}

export async function resetTeacherPasswordAction(
  contactId: string,
): Promise<ActionResult<{ email: string; password: string }>> {
  if (!z.uuid().safeParse(contactId).success) return fail("參數有誤");
  try {
    const { contact } = await ownContact(contactId);
    if (!contact.teacher_user_id) return fail("這位老師還沒有帳號");
    const admin = createAdminClient();
    const password = makePassword();
    const { data, error } = await admin.auth.admin.updateUserById(contact.teacher_user_id, {
      password,
      ban_duration: "none",
    });
    if (error) return fail(error.message);
    return { ok: true, data: { email: data.user.email ?? "", password } };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}

/** 停用：帳號鎖住不能登入、解除連結；老師寫過的回饋保留 */
export async function disableTeacherAccountAction(contactId: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(contactId).success) return fail("參數有誤");
  try {
    const { supabase, contact } = await ownContact(contactId);
    if (!contact.teacher_user_id) return fail("這位老師還沒有帳號");
    const admin = createAdminClient();
    const { error } = await admin.auth.admin.updateUserById(contact.teacher_user_id, {
      ban_duration: "876000h",
    });
    if (error) return fail(error.message);
    const { error: upErr } = await supabase
      .from("contacts")
      .update({ teacher_user_id: null })
      .eq("id", contactId);
    if (upErr) return fail(upErr.message);
    revalidatePath("/settings/contacts");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}

/** 老師帳號的登入 Email（人物管理顯示用） */
export async function teacherAccountEmailAction(
  contactId: string,
): Promise<ActionResult<{ email: string | null }>> {
  if (!z.uuid().safeParse(contactId).success) return fail("參數有誤");
  try {
    const { contact } = await ownContact(contactId);
    if (!contact.teacher_user_id) return { ok: true, data: { email: null } };
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.getUserById(contact.teacher_user_id);
    if (error) return fail(error.message);
    return { ok: true, data: { email: data.user.email ?? null } };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}
