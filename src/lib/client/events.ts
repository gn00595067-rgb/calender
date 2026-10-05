"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useAppData } from "@/components/app/app-data";
import { driverFromRow, type DriverInfo, type DriverTrip } from "@/lib/driver";

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
  reminder_minutes: number | null;
  /** 全部相關者（主角＋相關人物），供顯示與搜尋相容 */
  contactNames: string[];
  /** 主角（誰的行程） */
  subjectNames: string[];
  /** 相關人物（拜訪／參與／對象） */
  participantNames: string[];
  tagNames: string[];
  finance: {
    direction: "expense" | "income";
    amount: number;
    is_settled: boolean;
    /** 上課形式快照（1對1／1對2…）；未用收費方案為 null */
    lesson_label: string | null;
    /** 這堂含的加收（如交通費）；無則 null */
    extra_fee: number | null;
    extra_label: string | null;
  }[];
  noteCount: number;
  noteAuthorIds: string[];
  /** 司機接送設定；不需要司機為 null */
  driver: DriverInfo | null;
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
  reminder_minutes: number | null;
  // 0009 司機接送（套 migration 前查不到）
  needs_driver?: boolean;
  driver_trip?: DriverTrip | null;
  driver_pickup_minutes?: number | null;
  driver_pickup_location?: string | null;
  driver_note?: string | null;
};

/** 將行程原始列補上人物／標籤／財務／回饋數等關聯 */
export async function enrichEvents(rows: EventRowLite[]): Promise<CalEvent[]> {
  if (rows.length === 0) return [];
  const supabase = createClient();
  const ids = rows.map((e) => e.id);

  const [ecRes, etRes, finRes, noteRes] = await Promise.all([
    supabase
      .from("event_contacts")
      .select("event_id, contact_id, role")
      .in("event_id", ids),
    supabase.from("event_tags").select("event_id, tag_id").in("event_id", ids),
    supabase
      .from("finance_records")
      // 用 * 而非列欄位：0008 前的庫沒有 lesson_label，列出會查詢失敗
      .select("*")
      .in("event_id", ids),
    supabase.from("event_notes").select("event_id, author_id").in("event_id", ids),
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

  const subjectsByEvent = new Map<string, string[]>();
  const participantsByEvent = new Map<string, string[]>();
  for (const r of ecRes.data ?? []) {
    const n = contactName.get(r.contact_id);
    if (!n) continue;
    if (r.role === "subject") pushInto(subjectsByEvent, r.event_id, n);
    else pushInto(participantsByEvent, r.event_id, n);
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
      lesson_label: r.lesson_label ?? null,
      extra_fee: r.extra_fee ?? null,
      extra_label: r.extra_label ?? null,
    });
  }
  const noteCount = new Map<string, number>();
  const noteAuthors = new Map<string, Set<string>>();
  for (const r of noteRes.data ?? []) {
    noteCount.set(r.event_id, (noteCount.get(r.event_id) ?? 0) + 1);
    const set = noteAuthors.get(r.event_id) ?? new Set<string>();
    set.add(r.author_id);
    noteAuthors.set(r.event_id, set);
  }

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
    reminder_minutes: e.reminder_minutes,
    subjectNames: subjectsByEvent.get(e.id) ?? [],
    participantNames: participantsByEvent.get(e.id) ?? [],
    contactNames: [
      ...(subjectsByEvent.get(e.id) ?? []),
      ...(participantsByEvent.get(e.id) ?? []),
    ],
    tagNames: tagsByEvent.get(e.id) ?? [],
    finance: finByEvent.get(e.id) ?? [],
    noteCount: noteCount.get(e.id) ?? 0,
    noteAuthorIds: [...(noteAuthors.get(e.id) ?? [])],
    driver: driverFromRow(e),
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
