"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { enrichEvents, type CalEvent } from "./events";

/** 新增紀錄的一列：重複行程整個系列算一列 */
export interface RecentItem {
  /** 系列第一筆（依時間） */
  first: CalEvent;
  /** 系列全部行程，依時間排序 */
  all: CalEvent[];
  createdAt: string;
  creatorName: string;
}

/**
 * 依「輸入時間」（created_at）列出某時間之後新增的行程，給第二個人核對有沒有漏。
 * spec：docs/specs/新增確認與新增紀錄.md
 */
export function useRecentlyAdded(sinceIso: string) {
  return useQuery({
    queryKey: ["events", "recent", sinceIso],
    queryFn: async (): Promise<RecentItem[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("events")
        .select("*")
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      const enriched = await enrichEvents(rows);
      const byId = new Map(enriched.map((e) => [e.id, e]));

      const creatorIds = [...new Set(rows.map((r) => r.creator_id))];
      const { data: profiles } = creatorIds.length
        ? await supabase.from("profiles").select("id, display_name").in("id", creatorIds)
        : { data: [] as { id: string; display_name: string }[] };
      const nameOf = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));

      // 同一系列（recurrence_group_id）合成一列；列的順序依最新輸入時間
      const groups = new Map<string, { rows: typeof rows }>();
      for (const r of rows) {
        const key = r.recurrence_group_id ?? r.id;
        const g = groups.get(key);
        if (g) g.rows.push(r);
        else groups.set(key, { rows: [r] });
      }
      return [...groups.values()].map(({ rows: rs }) => {
        const all = rs
          .map((r) => byId.get(r.id)!)
          .filter(Boolean)
          .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
        return {
          first: all[0],
          all,
          createdAt: rs[0].created_at,
          creatorName: nameOf.get(rs[0].creator_id) ?? "",
        };
      });
    },
  });
}
