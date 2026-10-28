"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { enrichEvents, type CalEvent } from "./events";

/** 新增／修改紀錄的一列：重複行程整個系列算一列 */
export interface RecentItem {
  /** 系列第一筆（依時間） */
  first: CalEvent;
  /** 系列全部行程，依時間排序 */
  all: CalEvent[];
  /** 輸入（新增）或修改的時間 */
  at: string;
  /** 輸入或修改的人 */
  byName: string;
}

export type RecentKind = "added" | "edited";

/** 0019（edited_at）還沒套用 */
export class EditLogUnavailable extends Error {}

/**
 * 依「輸入時間」（created_at）或「修改時間」（edited_at）列出某時間之後的行程，
 * 給第二個人核對有沒有漏、有沒有改錯。
 * spec：docs/specs/新增確認與新增紀錄.md
 */
export function useRecentEvents(sinceIso: string, untilIso: string | null, kind: RecentKind) {
  return useQuery({
    queryKey: ["events", "recent", kind, sinceIso, untilIso],
    retry: false,
    queryFn: async (): Promise<RecentItem[]> => {
      const supabase = createClient();
      const col = kind === "added" ? "created_at" : "edited_at";
      let q = supabase.from("events").select("*").gte(col, sinceIso);
      if (untilIso) q = q.lt(col, untilIso);
      const { data, error } = await q.order(col, { ascending: false }).limit(500);
      if (error) {
        if (kind === "edited" && (error.code === "42703" || error.message.includes("edited_at")))
          throw new EditLogUnavailable("修改紀錄功能還在等系統更新，更新完成後，之後每次「編輯→儲存」都會列在這裡");
        throw new Error(error.message);
      }
      const rows = data ?? [];
      const enriched = await enrichEvents(rows);
      const byId = new Map(enriched.map((e) => [e.id, e]));
      const atOf = (r: (typeof rows)[number]) =>
        (kind === "added" ? r.created_at : r.edited_at) ?? r.created_at;
      const whoOf = (r: (typeof rows)[number]) =>
        (kind === "added" ? r.creator_id : r.edited_by) ?? r.creator_id;

      const personIds = [...new Set(rows.map(whoOf))];
      const { data: profiles } = personIds.length
        ? await supabase.from("profiles").select("id, display_name").in("id", personIds)
        : { data: [] as { id: string; display_name: string }[] };
      const nameOf = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));

      // 同一系列（recurrence_group_id）合成一列；列的順序依最新時間
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
          at: atOf(rs[0]),
          byName: nameOf.get(whoOf(rs[0])) ?? "",
        };
      });
    },
  });
}
