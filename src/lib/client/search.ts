"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { enrichEvents, type CalEvent } from "./events";
import { taipeiDateStartUtcISO, taipeiDateEndExclusiveUtcISO } from "@/lib/date";

export interface SearchParams {
  q: string;
  calendarIds: string[];
  /** 需同時包含全部所選人物（AND） */
  contactIds?: string[];
  /** 需同時包含全部所選標籤（AND） */
  tagIds?: string[];
  startDate?: string | null;
  endDate?: string | null;
  importantOnly?: boolean;
  hasFinance?: boolean;
  hasNotes?: boolean;
}

/** 清掉會破壞 PostgREST or 過濾字串的字元 */
function sanitize(q: string): string {
  return q.replace(/[,()%*]/g, " ").trim();
}

function hasAnyCriteria(p: SearchParams): boolean {
  return Boolean(
    p.q.trim() ||
      (p.contactIds && p.contactIds.length > 0) ||
      (p.tagIds && p.tagIds.length > 0) ||
      p.startDate ||
      p.endDate ||
      p.importantOnly ||
      p.hasFinance ||
      p.hasNotes,
  );
}

/** 單一關鍵字對到的行程 id（標題／說明／地點／回饋／人物／標籤） */
async function idsMatching(
  supabase: ReturnType<typeof createClient>,
  word: string,
  calendarIds: string[],
): Promise<Set<string>> {
  const like = `%${word}%`;
  const [byText, byNote, byContact, byTag] = await Promise.all([
    supabase
      .from("events")
      .select("id")
      .in("calendar_id", calendarIds)
      .or(`title.ilike.${like},description.ilike.${like},location.ilike.${like}`),
    supabase.from("event_notes").select("event_id").ilike("content", like),
    supabase.from("contacts").select("id").ilike("name", like),
    supabase.from("tags").select("id").ilike("name", like),
  ]);

  const ids = new Set<string>();
  for (const r of byText.data ?? []) ids.add(r.id);
  for (const r of byNote.data ?? []) ids.add(r.event_id);

  const contactIds = (byContact.data ?? []).map((r) => r.id);
  if (contactIds.length) {
    const { data } = await supabase
      .from("event_contacts")
      .select("event_id")
      .in("contact_id", contactIds);
    for (const r of data ?? []) ids.add(r.event_id);
  }
  const tagIds = (byTag.data ?? []).map((r) => r.id);
  if (tagIds.length) {
    const { data } = await supabase.from("event_tags").select("event_id").in("tag_id", tagIds);
    for (const r of data ?? []) ids.add(r.event_id);
  }
  return ids;
}

export async function searchEvents(p: SearchParams): Promise<CalEvent[]> {
  if (p.calendarIds.length === 0 || !hasAnyCriteria(p)) return [];
  const supabase = createClient();

  // 關鍵字 → 候選 event id。空白分開的多個詞要「每個都對到」（各詞可對到不同欄位），
  // 例：「線上會議 總經理」＝標題有線上會議、人物有總經理。
  let keywordIds = null as Set<string> | null;
  const words = sanitize(p.q).split(/\s+/).filter(Boolean);
  for (const w of words) {
    const ids = await idsMatching(supabase, w, p.calendarIds);
    const prev: Set<string> | null = keywordIds;
    keywordIds = prev ? new Set([...prev].filter((id) => ids.has(id))) : ids;
    if (keywordIds.size === 0) return [];
  }

  // 基礎查詢
  let query = supabase.from("events").select("*").in("calendar_id", p.calendarIds);
  if (keywordIds) query = query.in("id", [...keywordIds]);
  if (p.startDate) query = query.gte("starts_at", taipeiDateStartUtcISO(p.startDate));
  if (p.endDate) query = query.lt("starts_at", taipeiDateEndExclusiveUtcISO(p.endDate));
  if (p.importantOnly) query = query.eq("is_important", true);

  const { data: rows, error } = await query.order("starts_at", { ascending: true });
  if (error) throw new Error(error.message);
  let base = rows ?? [];
  if (base.length === 0) return [];

  // 疊加 人物 / 標籤 / 含財務 過濾
  const baseIds = base.map((e) => e.id);
  if (p.contactIds && p.contactIds.length > 0) {
    const { data } = await supabase
      .from("event_contacts")
      .select("event_id, contact_id")
      .in("contact_id", p.contactIds)
      .in("event_id", baseIds);
    // 需同時含全部所選人物（AND）
    const byEvent = new Map<string, Set<string>>();
    for (const r of data ?? []) {
      const set = byEvent.get(r.event_id) ?? new Set<string>();
      set.add(r.contact_id);
      byEvent.set(r.event_id, set);
    }
    const need = p.contactIds.length;
    base = base.filter((e) => (byEvent.get(e.id)?.size ?? 0) === need);
  }
  if (p.tagIds && p.tagIds.length > 0) {
    const { data } = await supabase
      .from("event_tags")
      .select("event_id, tag_id")
      .in("tag_id", p.tagIds)
      .in("event_id", baseIds);
    const byEvent = new Map<string, Set<string>>();
    for (const r of data ?? []) {
      const set = byEvent.get(r.event_id) ?? new Set<string>();
      set.add(r.tag_id);
      byEvent.set(r.event_id, set);
    }
    const need = p.tagIds.length;
    base = base.filter((e) => (byEvent.get(e.id)?.size ?? 0) === need);
  }
  if (p.hasFinance) {
    const { data } = await supabase
      .from("finance_records")
      .select("event_id")
      .in("event_id", baseIds);
    const keep = new Set((data ?? []).map((r) => r.event_id).filter(Boolean));
    base = base.filter((e) => keep.has(e.id));
  }
  if (p.hasNotes) {
    const { data } = await supabase
      .from("event_notes")
      .select("event_id")
      .in("event_id", baseIds);
    const keep = new Set((data ?? []).map((r) => r.event_id));
    base = base.filter((e) => keep.has(e.id));
  }

  return enrichEvents(base);
}

export function useSearch(params: SearchParams) {
  return useQuery({
    queryKey: ["search", params],
    queryFn: () => searchEvents(params),
    enabled: params.calendarIds.length > 0,
  });
}
