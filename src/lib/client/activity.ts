"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

/**
 * 未讀更新（像 LINE 的紅點數字，Peggy 11/24）：上次看「新增紀錄」之後，
 * 別人新增、修改的行程，以及別人寫的學習回饋。上次查看時間存在 profiles.activity_seen_at（0036，跨裝置）。
 */

export type ActivityKind = "added" | "edited" | "note";

export interface ActivityItem {
  kind: ActivityKind;
  at: string;
  byId: string;
  byName: string;
  eventId: string;
  title: string;
  startsAt: string;
  /** 回饋內容（kind=note） */
  text?: string;
}

/** 還沒看過的預設起點：一天前（剛上線時不要一次跳出一大堆） */
const defaultSince = () => new Date(Date.now() - 864e5).toISOString();

export async function fetchSeenAt(meId: string): Promise<string | null> {
  const { data, error } = await createClient().from("profiles").select("activity_seen_at").eq("id", meId).single();
  if (error) return null; // 0036 前沒有這欄
  return data?.activity_seen_at ?? defaultSince();
}

export async function markActivitySeen(meId: string): Promise<void> {
  await createClient().from("profiles").update({ activity_seen_at: new Date().toISOString() }).eq("id", meId);
}

/** since 之後別人的更新（新到舊，最多各 200 筆） */
export async function fetchActivity(meId: string, since: string): Promise<ActivityItem[]> {
  const supabase = createClient();
  const [added, edited, notes] = await Promise.all([
    supabase
      .from("events")
      .select("id, title, starts_at, created_at, creator_id")
      .gt("created_at", since)
      .neq("creator_id", meId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("events")
      .select("*")
      .gt("edited_at", since)
      .neq("edited_by", meId)
      .order("edited_at", { ascending: false })
      .limit(200),
    supabase
      .from("event_notes")
      .select("id, event_id, author_id, content, created_at")
      .gt("created_at", since)
      .neq("author_id", meId)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  const noteEventIds = [...new Set((notes.data ?? []).map((n) => n.event_id))];
  const { data: noteEvents } = noteEventIds.length
    ? await supabase.from("events").select("id, title, starts_at").in("id", noteEventIds)
    : { data: [] as { id: string; title: string; starts_at: string }[] };
  const evOf = new Map((noteEvents ?? []).map((e) => [e.id, e]));

  // 同一個系列一次新增很多筆 → 合成一列（取第一筆，標題後面加「等 N 堂」）
  const addedRows = added.data ?? [];
  const items: ActivityItem[] = [];
  const seenGroup = new Map<string, ActivityItem & { n: number }>();
  for (const r of addedRows) {
    const key = `${r.creator_id}|${r.title}|${r.created_at.slice(0, 16)}`;
    const g = seenGroup.get(key);
    if (g) {
      g.n++;
      if (r.starts_at < g.startsAt) g.startsAt = r.starts_at;
      continue;
    }
    seenGroup.set(key, { kind: "added", at: r.created_at, byId: r.creator_id, byName: "", eventId: r.id, title: r.title, startsAt: r.starts_at, n: 1 });
  }
  for (const g of seenGroup.values()) items.push({ ...g, title: g.n > 1 ? `${g.title}（共 ${g.n} 堂）` : g.title });
  // 剛新增又被同一人改：只算新增
  const addedIds = new Set(addedRows.map((r) => r.id));
  for (const r of edited.data ?? []) {
    if (addedIds.has(r.id) && r.edited_by === r.creator_id) continue;
    items.push({ kind: "edited", at: r.edited_at!, byId: r.edited_by!, byName: "", eventId: r.id, title: r.title, startsAt: r.starts_at });
  }
  for (const n of notes.data ?? []) {
    const ev = evOf.get(n.event_id);
    if (!ev) continue;
    items.push({ kind: "note", at: n.created_at, byId: n.author_id, byName: "", eventId: n.event_id, title: ev.title, startsAt: ev.starts_at, text: n.content });
  }
  const ids = [...new Set(items.map((i) => i.byId))];
  const { data: profs } = ids.length
    ? await supabase.from("profiles").select("id, display_name").in("id", ids)
    : { data: [] as { id: string; display_name: string }[] };
  const nameOf = new Map((profs ?? []).map((p) => [p.id, p.display_name]));
  return items
    .map((i) => ({ ...i, byName: nameOf.get(i.byId) || "有人" }))
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** 側欄紅點數字：每分鐘更新 */
export function useUnseenCount(meId: string) {
  return useQuery({
    queryKey: ["activity", "count", meId],
    refetchInterval: 60_000,
    queryFn: async () => {
      const since = await fetchSeenAt(meId);
      if (!since) return 0;
      return (await fetchActivity(meId, since)).length;
    },
  });
}
