"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { fail, getAuthed, type ActionResult } from "./helpers";
import { makePassword, ownNonFamilyContact } from "./account-helpers";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushToUser } from "@/lib/push";

/**
 * 司機帳號（人物管理建立，同老師帳號做法）＋司機送出加班申請（送出後推播給 Peggy）。
 * spec：docs/specs/司機打卡與加班費.md
 */

const ownContact = (contactId: string) => ownNonFamilyContact(contactId, "家人不能建立司機帳號");
const MISSING_0028 = "司機帳號需先套用資料庫更新（0028）";

export async function createDriverAccountAction(
  contactId: string,
  emailInput: string | null,
): Promise<ActionResult<{ email: string; password: string }>> {
  if (!z.uuid().safeParse(contactId).success) return fail("參數有誤");
  const email = emailInput?.trim().toLowerCase() || `d-${randomBytes(3).toString("hex")}@execcal.test`;
  if (!z.email().safeParse(email).success) return fail("Email 格式不正確");
  try {
    const { supabase, contact } = await ownContact(contactId);
    if (!("driver_user_id" in contact)) return fail(MISSING_0028);
    if (contact.driver_user_id) return fail("這位司機已經有帳號了，要換密碼請按「重設密碼」");
    if (contact.teacher_user_id) return fail("這位人物已經是老師帳號，司機請另建一位人物");

    const admin = createAdminClient();
    const password = makePassword();
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: contact.name, role: "driver" },
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
      .update({ driver_user_id: data.user.id })
      .eq("id", contactId);
    if (linkErr) {
      // 連不上就把剛建的帳號刪掉，避免留下沒人管的帳號
      await admin.auth.admin.deleteUser(data.user.id);
      return fail(/driver_user_id/.test(linkErr.message) ? MISSING_0028 : linkErr.message);
    }
    revalidatePath("/settings/contacts");
    return { ok: true, data: { email, password } };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}

export async function resetDriverPasswordAction(
  contactId: string,
): Promise<ActionResult<{ email: string; password: string }>> {
  if (!z.uuid().safeParse(contactId).success) return fail("參數有誤");
  try {
    const { contact } = await ownContact(contactId);
    if (!contact.driver_user_id) return fail("這位司機還沒有帳號");
    const admin = createAdminClient();
    const password = makePassword();
    const { data, error } = await admin.auth.admin.updateUserById(contact.driver_user_id, {
      password,
      ban_duration: "none",
    });
    if (error) return fail(error.message);
    return { ok: true, data: { email: data.user.email ?? "", password } };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}

/** 停用：帳號鎖住不能登入、解除連結；加班紀錄保留 */
export async function disableDriverAccountAction(contactId: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(contactId).success) return fail("參數有誤");
  try {
    const { supabase, contact } = await ownContact(contactId);
    if (!contact.driver_user_id) return fail("這位司機還沒有帳號");
    const admin = createAdminClient();
    const { error } = await admin.auth.admin.updateUserById(contact.driver_user_id, {
      ban_duration: "876000h",
    });
    if (error) return fail(error.message);
    const { error: upErr } = await supabase
      .from("contacts")
      .update({ driver_user_id: null })
      .eq("id", contactId);
    if (upErr) return fail(upErr.message);
    revalidatePath("/settings/contacts");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}

export async function driverAccountEmailAction(
  contactId: string,
): Promise<ActionResult<{ email: string | null }>> {
  if (!z.uuid().safeParse(contactId).success) return fail("參數有誤");
  try {
    const { contact } = await ownContact(contactId);
    if (!contact.driver_user_id) return { ok: true, data: { email: null } };
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.getUserById(contact.driver_user_id);
    if (error) return fail(error.message);
    return { ok: true, data: { email: data.user.email ?? null } };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}

const OvertimeInput = z.object({
  id: z.uuid().nullable(),
  contactId: z.uuid(),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
  reason: z.string().trim().min(1, "請填事由（例：接送小孩上體操）").max(300),
  eventId: z.uuid().nullable(),
});

/**
 * 司機送出／修改加班申請（狀態一律回到「待核准」），然後推播給 Peggy。
 * 寫入走司機自己的 client（RLS 擋住已核准的），推播才用管理金鑰讀 Peggy 的裝置。
 */
export async function submitOvertimeAction(
  input: z.input<typeof OvertimeInput>,
): Promise<ActionResult<{ notified: boolean }>> {
  const p = OvertimeInput.safeParse(input);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "資料有誤");
  const v = p.data;
  if (v.end <= v.start) return fail("結束時間要晚於開始時間");
  try {
    const { supabase, user } = await getAuthed();
    const { data: links, error: linkErr } = await supabase.rpc("my_driver_links");
    if (linkErr) return fail(/does not exist|Could not find/i.test(linkErr.message) ? MISSING_0028 : linkErr.message);
    const link = links?.find((l) => l.contact_id === v.contactId);
    if (!link) return fail("這個帳號不是司機帳號");

    const fields = {
      work_date: v.workDate,
      start_time: v.start,
      end_time: v.end,
      reason: v.reason,
      event_id: v.eventId,
      status: "pending" as const,
      review_note: null,
      reviewed_at: null,
    };
    const { error } = v.id
      ? await supabase.from("driver_overtime").update(fields).eq("id", v.id).select("id").single()
      : await supabase
          .from("driver_overtime")
          .insert({ ...fields, owner_id: link.owner_id, contact_id: v.contactId, author_id: user.id })
          .select("id")
          .single();
    if (error) {
      if (/0 rows|PGRST116/i.test(error.message + (error.code ?? ""))) return fail("已核准的加班不能再改，請找 Peggy");
      return fail(error.message);
    }

    // 推播失敗不影響送出（Peggy 打開「司機加班」頁一樣看得到）
    let notified = false;
    try {
      const md = `${Number(v.workDate.slice(5, 7))}/${Number(v.workDate.slice(8, 10))}`;
      notified =
        (await sendPushToUser(createAdminClient(), link.owner_id, {
          title: `${link.contact_name}${v.id ? "修改了" : "申請"}加班`,
          body: `${md} ${v.start}–${v.end}｜${v.reason}`,
          tag: `overtime-${v.workDate}`,
          url: "/overtime",
        })) > 0;
    } catch (e) {
      console.error("[overtime push]", e);
    }
    return { ok: true, data: { notified } };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}
