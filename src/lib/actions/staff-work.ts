"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthed, fail, type ActionResult } from "./helpers";
import { makePassword, ownNonFamilyContact } from "./account-helpers";
import { WORK_PRESET, hoursBetween } from "@/lib/work-groups";

/**
 * 家庭老師（員工帳號）自己記工作紀錄、寫週報；家長連結員工帳號、套用週報大項。
 * 權限由 0031 RLS 把關：家長全部、員工只動自己人物的。
 * spec：docs/specs/Elsa需求-多人權限與家庭老師報告.md
 */

const MISSING_0031 = "資料庫還沒更新（0031），請先套用 migration";
const missing = (msg: string) => /does not exist|Could not find|schema cache|column/i.test(msg);

/** 這位人物的擁有者（家長自己，或員工透過 my_staff_links） */
async function ownerOf(contactId: string): Promise<{ ownerId: string } | { error: string }> {
  const { supabase, user } = await getAuthed();
  const { data: own } = await supabase
    .from("contacts")
    .select("owner_id")
    .eq("id", contactId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (own) return { ownerId: own.owner_id };
  const { data: links, error } = await supabase.rpc("my_staff_links");
  if (error) return { error: missing(error.message) ? MISSING_0031 : error.message };
  const link = links?.find((l) => l.contact_id === contactId);
  return link ? { ownerId: link.owner_id } : { error: "你沒有權限記這位的工作紀錄" };
}

const logSchema = z.object({
  id: z.uuid().optional(),
  contactId: z.uuid(),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
  categoryId: z.uuid().nullable(),
  subLabel: z.string().trim().max(40).optional().default(""),
  content: z.string().trim().min(1, "請寫做了什麼").max(500),
  eventId: z.uuid().nullable().optional(),
});

export async function saveWorkLogAction(input: unknown): Promise<ActionResult> {
  const p = logSchema.safeParse(input);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "資料有誤");
  const v = p.data;
  if (v.start === v.end) return fail("開始和結束不能一樣");
  try {
    const { supabase, user } = await getAuthed();
    const o = await ownerOf(v.contactId);
    if ("error" in o) return fail(o.error);
    let categoryRaw: string | null = null;
    if (v.categoryId) {
      const { data: cats } = await supabase.rpc("my_work_categories", { p_contact: v.contactId });
      const cat = cats?.find((c) => c.id === v.categoryId);
      if (!cat) return fail("找不到這個類別");
      categoryRaw = cat.name;
    }
    const fields = {
      work_date: v.workDate,
      start_time: v.start,
      end_time: v.end,
      hours: hoursBetween(v.start, v.end),
      content: v.content,
      category_id: v.categoryId,
      category_raw: categoryRaw,
      sub_label: v.subLabel || null,
      event_id: v.eventId ?? null,
      updated_at: new Date().toISOString(),
    };
    const { error } = v.id
      ? await supabase.from("work_logs").update(fields).eq("id", v.id).select("id").single()
      : await supabase
          .from("work_logs")
          .insert({ ...fields, owner_id: o.ownerId, contact_id: v.contactId, author_id: user.id })
          .select("id")
          .single();
    if (error) return fail(missing(error.message) ? MISSING_0031 : error.message);
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}

export async function deleteWorkLogAction(id: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success) return fail("資料有誤");
  try {
    const { supabase } = await getAuthed();
    const { data, error } = await supabase.from("work_logs").delete().eq("id", id).select("id");
    if (error) return fail(error.message);
    if (!data?.length) return fail("找不到這筆，或沒有權限刪除");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}

const reportSchema = z.object({
  contactId: z.uuid(),
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  summaries: z.record(z.string().max(40), z.string().max(2000)),
  review: z.string().max(5000),
  submit: z.boolean().default(false),
});

/** 存週報（草稿或送出）；同一週再存＝更新 */
export async function saveWeeklyReportAction(input: unknown): Promise<ActionResult> {
  const p = reportSchema.safeParse(input);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "資料有誤");
  const v = p.data;
  try {
    const { supabase, user } = await getAuthed();
    const o = await ownerOf(v.contactId);
    if ("error" in o) return fail(o.error);
    const now = new Date().toISOString();
    const { error } = await supabase.from("weekly_reports").upsert(
      {
        owner_id: o.ownerId,
        contact_id: v.contactId,
        week_start: v.weekStart,
        summaries: v.summaries,
        review: v.review,
        author_id: user.id,
        updated_at: now,
        ...(v.submit ? { submitted_at: now } : {}),
      },
      { onConflict: "contact_id,week_start" },
    );
    if (error) return fail(missing(error.message) ? MISSING_0031 : error.message);
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}

/**
 * 家長：把一位人物（家庭老師）連到登入帳號。Email 已有帳號就直接連；
 * 沒有就建一個並回傳密碼（只顯示一次）。建之前先在「分享與權限」邀請這個 Email，就不會多出空白分類。
 */
export async function linkStaffAccountAction(
  contactId: string,
  emailInput: string,
): Promise<ActionResult<{ email: string; password: string | null }>> {
  if (!z.uuid().safeParse(contactId).success) return fail("參數有誤");
  const email = emailInput.trim().toLowerCase();
  if (!z.email().safeParse(email).success) return fail("Email 格式不正確");
  try {
    const { supabase, contact } = await ownNonFamilyContact(contactId, "家人不能設成員工帳號");
    const admin = createAdminClient();
    const { data: list, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
    if (listErr) return fail(listErr.message);
    let userId = list.users.find((u) => u.email?.toLowerCase() === email)?.id ?? null;
    let password: string | null = null;
    if (!userId) {
      password = makePassword();
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: contact.name },
      });
      if (error || !data.user) return fail(error?.message ?? "建立帳號失敗");
      userId = data.user.id;
    }
    const { error } = await supabase.from("contacts").update({ staff_user_id: userId }).eq("id", contactId);
    if (error) {
      if (/duplicate|unique/i.test(error.message)) return fail("這個帳號已經連到另一位人物");
      return fail(missing(error.message) ? MISSING_0031 : error.message);
    }
    revalidatePath("/settings/contacts");
    return { ok: true, data: { email, password } };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}

export async function unlinkStaffAccountAction(contactId: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(contactId).success) return fail("參數有誤");
  try {
    const { supabase } = await ownNonFamilyContact(contactId, "家人沒有員工帳號");
    const { error } = await supabase.from("contacts").update({ staff_user_id: null }).eq("id", contactId);
    if (error) return fail(error.message);
    revalidatePath("/settings/contacts");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}

/** 員工帳號目前連的 Email（人物管理顯示用） */
export async function staffAccountEmailAction(contactId: string): Promise<ActionResult<{ email: string | null }>> {
  if (!z.uuid().safeParse(contactId).success) return fail("參數有誤");
  try {
    const { contact } = await ownNonFamilyContact(contactId, "家人沒有員工帳號");
    const uid = (contact as { staff_user_id?: string | null }).staff_user_id;
    if (!uid) return { ok: true, data: { email: null } };
    const { data } = await createAdminClient().auth.admin.getUserById(uid);
    return { ok: true, data: { email: data.user?.email ?? null } };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}

/**
 * 家長：幫這位人物加上週報 4 大項的類別（已有同名的只補大項，不刪舊的、不動時薪）。
 */
export async function applyWorkPresetAction(contactId: string): Promise<ActionResult<{ added: number }>> {
  if (!z.uuid().safeParse(contactId).success) return fail("參數有誤");
  try {
    const { supabase, user } = await getAuthed();
    const { data: existing, error } = await supabase
      .from("work_categories")
      .select("id, name, position")
      .eq("contact_id", contactId)
      .eq("owner_id", user.id);
    if (error) return fail(error.message);
    const byName = new Map((existing ?? []).map((c) => [c.name, c]));
    let pos = Math.max(-1, ...(existing ?? []).map((c) => c.position)) + 1;
    let added = 0;
    for (const p of WORK_PRESET) {
      const hit = byName.get(p.name);
      if (hit) {
        const { error: e } = await supabase.from("work_categories").update({ group_label: p.group }).eq("id", hit.id);
        if (e) return fail(missing(e.message) ? MISSING_0031 : e.message);
        continue;
      }
      const { error: e } = await supabase.from("work_categories").insert({
        owner_id: user.id,
        contact_id: contactId,
        name: p.name,
        group_label: p.group,
        aliases: p.aliases,
        hourly_rate: 0,
        position: pos++,
      });
      if (e) return fail(missing(e.message) ? MISSING_0031 : e.message);
      added++;
    }
    return { ok: true, data: { added } };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}
