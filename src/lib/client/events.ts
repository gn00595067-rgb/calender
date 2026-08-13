"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useAppData } from "@/components/app/app-data";

/** 視圖用行程（含精簡關聯） */
export interface CalEvent {
  id: string;
  calendar_id: string;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  is_important: boolean;
  recurrence_rule: string | null;
  recurrence_group_id: string | null;
  contactNames: string[];
  tagNames: string[];
  finance: { direction: "expense" | "income"; amount: number; is_settled: boolean }[];
  noteCount: number;
}

/** 行程原始列（events 表 Row） */
type EventRowLite = {
  id: string;
  calendar_id: string;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  is_important: boolean;
  recurrence_rule: string | null;
  recurrence_group_id: string | null;
};

/** 將行程原始列補上人物／標籤／財務／回饋數等關聯 */
export async function enrichEvents(rows: EventRowLite[]): Promise<CalEvent[]> {
  if (rows.length === 0) return [];
  const supabase = createClient();
  const ids = rows.map((e) => e.id);

  const [ecRes, etRes, finRes, noteRes] = await Promise.all([
    supabase.from("event_contacts").select("event_id, contact_id").in("event_id", ids),
    supabase.from("event_tags").select("event_id, tag_id").in("event_id", ids),
    supabase
      .from("finance_records")
      .select("event_id, direction, amount, is_settled")
      .in("event_id", ids),
    supabase.from("event_notes").select("event_id").in("event_id", ids),
  ]);

  const contactIds = [...new Set((ecRes.data ?? []).map((r) => r.contact_id))];
  const tagIds = [...new Set((etRes.data ?? []).map((r) => r.tag_id))];

  const [contactsRes, tagsRes] = await Promise.all([
    contactIds.length
      ? supabase.from("contacts").select("id, name").in("id", contactIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    tagIds.length
      ? supabase.from("tags").select("id, name").in("id", tagIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);

  const contactName = new Map((contactsRes.data ?? []).map((c) => [c.id, c.name]));
  const tagName = new Map((tagsRes.data ?? []).map((t) => [t.id, t.name]));

  function pushInto<V>(map: Map<string, V[]>, key: string, val: V) {
    const arr = map.get(key);
    if (arr) arr.push(val);
    else map.set(key, [val]);
  }

  const contactsByEvent = new Map<string, string[]>();
  for (const r of ecRes.data ?? []) {
    const n = contactName.get(r.contact_id);
    if (n) pushInto(contactsByEvent, r.event_id, n);
  }
  const tagsByEvent = new Map<string, string[]>();
  for (const r of etRes.data ?? []) {
    const n = tagName.get(r.tag_id);
    if (n) pushInto(tagsByEvent, r.event_id, n);
  }
  const finByEvent = new Map<string, CalEvent["finance"]>();
  for (const r of finRes.data ?? []) {
    if (!r.event_id) continue;
    pushInto(finByEvent, r.event_id, {
      direction: r.direction,
      amount: r.amount,
      is_settled: r.is_settled,
    });
  }
  const noteCount = new Map<string, number>();
  for (const r of noteRes.data ?? [])
    noteCount.set(r.event_id, (noteCount.get(r.event_id) ?? 0) + 1);

  return rows.map((e) => ({
    id: e.id,
    calendar_id: e.calendar_id,
    title: e.title,
    description: e.description,
    location: e.location,
    starts_at: e.starts_at,
    ends_at: e.ends_at,
    all_day: e.all_day,
    is_important: e.is_important,
    recurrence_rule: e.recurrence_rule,
    recurrence_group_id: e.recurrence_group_id,
    contactNames: contactsByEvent.get(e.id) ?? [],
    tagNames: tagsByEvent.get(e.id) ?? [],
    finance: finByEvent.get(e.id) ?? [],
    noteCount: noteCount.get(e.id) ?? 0,
  }));
}

export async function fetchEventsInRange(
  startIso: string,
  endIso: string,
  calendarIds: string[],
): Promise<CalEvent[]> {
  if (calendarIds.length === 0) return [];
  const supabase = createClient();

  const { data: events, error } = await supabase
    .from("events")
    .select("*")
    .in("calendar_id", calendarIds)
    .lt("starts_at", endIso)
    .gt("ends_at", startIso)
    .order("starts_at", { ascending: true });
  if (error) throw new Error(error.message);
  return enrichEvents(events ?? []);
}

/** 讀取指定 UTC 區間內、目前顯示中分類的行程 */
export function useCalendarEvents(startIso: string, endIso: string) {
  const { visibleIds } = useAppData();
  const ids = [...visibleIds].sort();
  return useQuery({
    queryKey: ["events", startIso, endIso, ids],
    queryFn: () => fetchEventsInRange(startIso, endIso, ids),
  });
}
