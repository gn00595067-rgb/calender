"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthed, fail, type ActionResult } from "./helpers";
import { parseIcs, type NormalizedEvent } from "@/lib/ics/parse";
import { taipeiDateStartUtcISO, taipeiDateEndExclusiveUtcISO } from "@/lib/date";

/** 關鍵字 → 主題標籤 對應（協助把「事物」轉成 tag） */
const KEYWORD_TAGS: [RegExp, string][] = [
  [/健檢|回診|看診|門診|健康|體檢|牙醫|醫院|復健/, "健康"],
  [/家教|上課|補習|課程|家長會|段考|考試|鋼琴|才藝|學校/, "教育"],
  [/董事會|法說|投資|股東|財報|併購|策略|營運|簡報/, "投資"],
  [/餐敘|聚餐|晚宴|飯局|咖啡|生日|紀念日|婚禮/, "社交"],
  [/出差|出國|飛|機場|差旅|考察/, "出差"],
  [/律師|法務|合約|訴訟|簽約/, "法務"],
  [/高爾夫|健身|運動|球敘|旅遊/, "休閒"],
];

function autoTagsFor(title: string, description: string | null): string[] {
  const text = `${title} ${description ?? ""}`;
  const out = new Set<string>();
  for (const [re, tag] of KEYWORD_TAGS) if (re.test(text)) out.add(tag);
  return [...out];
}

const rangeSchema = z.object({
  icsText: z.string().optional(),
  icsUrl: z.string().url().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

async function loadIcsText(icsText?: string, icsUrl?: string): Promise<string> {
  if (icsText && icsText.trim()) return icsText;
  if (icsUrl) {
    const url = icsUrl.replace(/^webcal:/i, "https:");
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`無法取得網址內容（HTTP ${res.status}）`);
    const text = await res.text();
    if (text.length > 8_000_000) throw new Error("檔案過大");
    return text;
  }
  throw new Error("請提供 .ics 檔內容或私人網址");
}

export interface ImportPreview {
  events: NormalizedEvent[];
  truncated: boolean;
  total: number;
  recurringCount: number;
  attendees: { name: string | null; email: string | null; isNew: boolean }[];
  categoryTags: string[];
}

export async function previewIcsImportAction(
  input: unknown,
): Promise<ActionResult<ImportPreview>> {
  const parsed = rangeSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "輸入有誤");
  if (parsed.data.startDate > parsed.data.endDate) return fail("起始日不可晚於結束日");

  try {
    const { supabase, user } = await getAuthed();
    const text = await loadIcsText(parsed.data.icsText, parsed.data.icsUrl);
    const startIso = taipeiDateStartUtcISO(parsed.data.startDate);
    const endIso = taipeiDateEndExclusiveUtcISO(parsed.data.endDate);

    const { events, truncated } = parseIcs(text, startIso, endIso);
    if (events.length === 0)
      return fail("這個區間內沒有找到任何行程（請確認檔案內容與日期）");

    // 既有人物（以 email / 姓名比對是否為新）
    const { data: existing } = await supabase
      .from("contacts")
      .select("name, email")
      .eq("owner_id", user.id);
    const existEmails = new Set(
      (existing ?? []).map((c) => (c.email ?? "").toLowerCase()).filter(Boolean),
    );
    const existNames = new Set((existing ?? []).map((c) => c.name));

    const attMap = new Map<string, { name: string | null; email: string | null }>();
    for (const e of events)
      for (const a of e.attendees) {
        const key = (a.email ?? a.name ?? "").toLowerCase();
        if (key && !attMap.has(key)) attMap.set(key, a);
      }
    const attendees = [...attMap.values()].map((a) => ({
      ...a,
      isNew: a.email
        ? !existEmails.has(a.email.toLowerCase())
        : a.name
          ? !existNames.has(a.name)
          : true,
    }));

    const categoryTags = [...new Set(events.flatMap((e) => e.categories))];

    return {
      ok: true,
      data: {
        events,
        truncated,
        total: events.length,
        recurringCount: events.filter((e) => e.recurring).length,
        attendees,
        categoryTags,
      },
    };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "解析失敗");
  }
}

const normalizedSchema = z.object({
  uid: z.string(),
  title: z.string().min(1),
  startIso: z.string(),
  endIso: z.string(),
  allDay: z.boolean(),
  location: z.string().nullable(),
  description: z.string().nullable(),
  attendees: z.array(z.object({ name: z.string().nullable(), email: z.string().nullable() })),
  categories: z.array(z.string()),
  recurring: z.boolean(),
  recurrenceRule: z.enum(["daily", "weekly", "biweekly", "monthly"]).nullable(),
});

const commitSchema = z.object({
  calendarId: z.uuid(),
  createContacts: z.boolean(),
  autoTags: z.boolean(),
  events: z.array(normalizedSchema).min(1).max(1500),
});

export interface ImportResult {
  inserted: number;
  skipped: number;
  contactsCreated: number;
  tagsUsed: number;
}

export async function commitIcsImportAction(
  input: unknown,
): Promise<ActionResult<ImportResult>> {
  const parsed = commitSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "輸入有誤");
  const { calendarId, createContacts, autoTags, events } = parsed.data;

  try {
    const { supabase, user } = await getAuthed();

    // 權限：需可編輯該分類
    const { data: cal } = await supabase
      .from("calendars")
      .select("id, owner_id")
      .eq("id", calendarId)
      .single();
    if (!cal) return fail("找不到分類");

    // 1. 人物 find-or-create
    const contactIdByKey = new Map<string, string>();
    let contactsCreated = 0;
    if (createContacts) {
      const attMap = new Map<string, { name: string | null; email: string | null }>();
      for (const e of events)
        for (const a of e.attendees) {
          const key = (a.email ?? a.name ?? "").toLowerCase();
          if (key && !attMap.has(key)) attMap.set(key, a);
        }
      if (attMap.size > 0) {
        const { data: existing } = await supabase
          .from("contacts")
          .select("id, name, email")
          .eq("owner_id", user.id);
        const byEmail = new Map(
          (existing ?? [])
            .filter((c) => c.email)
            .map((c) => [c.email!.toLowerCase(), c.id]),
        );
        const byName = new Map((existing ?? []).map((c) => [c.name, c.id]));

        const toCreate: { owner_id: string; name: string; email: string | null }[] = [];
        for (const [key, a] of attMap) {
          const existId =
            (a.email && byEmail.get(a.email.toLowerCase())) ||
            (a.name && byName.get(a.name));
          if (existId) {
            contactIdByKey.set(key, existId);
          } else {
            toCreate.push({
              owner_id: user.id,
              name: a.name || a.email || "未命名聯絡人",
              email: a.email,
            });
          }
        }
        if (toCreate.length) {
          const { data: created, error } = await supabase
            .from("contacts")
            .insert(toCreate)
            .select("id, name, email");
          if (error) return fail(error.message);
          contactsCreated = created?.length ?? 0;
          for (const c of created ?? []) {
            const key = (c.email ?? c.name ?? "").toLowerCase();
            if (key) contactIdByKey.set(key, c.id);
          }
        }
      }
    }

    // 2. 標籤 find-or-create（categories + 關鍵字）
    const tagNames = new Set<string>();
    for (const e of events) {
      for (const c of e.categories) tagNames.add(c);
      if (autoTags) for (const t of autoTagsFor(e.title, e.description)) tagNames.add(t);
    }
    const tagIdByName = new Map<string, string>();
    if (tagNames.size > 0) {
      const names = [...tagNames];
      const { data: existingTags } = await supabase
        .from("tags")
        .select("id, name")
        .eq("owner_id", user.id)
        .in("name", names);
      for (const t of existingTags ?? []) tagIdByName.set(t.name, t.id);
      const toCreate = names.filter((n) => !tagIdByName.has(n));
      if (toCreate.length) {
        const { data: created } = await supabase
          .from("tags")
          .insert(toCreate.map((name) => ({ owner_id: user.id, name })))
          .select("id, name");
        for (const t of created ?? []) tagIdByName.set(t.name, t.id);
      }
    }

    // 3. 去重：既有相同 (source_uid, starts_at)
    const uids = [...new Set(events.map((e) => e.uid))];
    const { data: dup } = await supabase
      .from("events")
      .select("source_uid, starts_at")
      .eq("calendar_id", calendarId)
      .in("source_uid", uids);
    const existingKeys = new Set(
      (dup ?? []).map((d) => `${d.source_uid}|${d.starts_at}`),
    );

    // 4. 準備要插入的行程
    const groupIdByUid = new Map<string, string>();
    for (const e of events)
      if (e.recurring && !groupIdByUid.has(e.uid))
        groupIdByUid.set(e.uid, crypto.randomUUID());

    const toInsert = events.filter(
      (e) => !existingKeys.has(`${e.uid}|${new Date(e.startIso).toISOString()}`),
    );
    const skipped = events.length - toInsert.length;
    if (toInsert.length === 0)
      return { ok: true, data: { inserted: 0, skipped, contactsCreated, tagsUsed: tagIdByName.size } };

    const rows = toInsert.map((e) => ({
      calendar_id: calendarId,
      creator_id: user.id,
      title: e.title,
      description: e.description,
      location: e.location,
      starts_at: new Date(e.startIso).toISOString(),
      ends_at: new Date(e.endIso).toISOString(),
      all_day: e.allDay,
      is_important: false,
      recurrence_rule: e.recurrenceRule,
      recurrence_group_id: e.recurring ? (groupIdByUid.get(e.uid) ?? null) : null,
      source_uid: e.uid,
    }));

    const { data: inserted, error: insErr } = await supabase
      .from("events")
      .insert(rows)
      .select("id, source_uid, starts_at");
    if (insErr) return fail(insErr.message);

    // 對應回原事件以建立關聯
    const idByKey = new Map<string, string>();
    for (const r of inserted ?? []) idByKey.set(`${r.source_uid}|${r.starts_at}`, r.id);

    const ecRows: { event_id: string; contact_id: string }[] = [];
    const etRows: { event_id: string; tag_id: string }[] = [];
    for (const e of toInsert) {
      const eid = idByKey.get(`${e.uid}|${new Date(e.startIso).toISOString()}`);
      if (!eid) continue;
      if (createContacts)
        for (const a of e.attendees) {
          const key = (a.email ?? a.name ?? "").toLowerCase();
          const cid = key ? contactIdByKey.get(key) : undefined;
          if (cid) ecRows.push({ event_id: eid, contact_id: cid });
        }
      const evTags = new Set<string>(e.categories);
      if (autoTags) for (const t of autoTagsFor(e.title, e.description)) evTags.add(t);
      for (const name of evTags) {
        const tid = tagIdByName.get(name);
        if (tid) etRows.push({ event_id: eid, tag_id: tid });
      }
    }
    if (ecRows.length) await supabase.from("event_contacts").insert(ecRows);
    if (etRows.length) await supabase.from("event_tags").insert(etRows);

    revalidatePath("/", "layout");
    return {
      ok: true,
      data: {
        inserted: inserted?.length ?? 0,
        skipped,
        contactsCreated,
        tagsUsed: tagIdByName.size,
      },
    };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "匯入失敗");
  }
}
