"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { taipeiDateStartUtcISO, taipeiDateEndExclusiveUtcISO } from "@/lib/date";

/** month = 'yyyy-MM' → 該月起訖日期字串（含） */
export function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const start = `${month}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${month}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

export interface FinanceItem {
  id: string;
  occurred_on: string;
  direction: "expense" | "income";
  amount: number;
  category_label: string | null;
  category_id: string | null;
  category_name: string | null;
  category_group: string | null;
  payment_method:
    | "monthly"
    | "per_time"
    | "prepaid_deduct"
    | "prepaid_term"
    | null;
  is_prepaid_topup: boolean;
  covered_by_prepaid: boolean;
  is_settled: boolean;
  calendar_id: string | null;
  event_id: string | null;
  event_title: string | null;
  contact_id: string | null;
  contact_name: string | null;
  note: string | null;
}

/**
 * 任意日期區間（含端點）的財務明細。含類別名稱/分群、付款方式、預繳旗標，
 * 供報表依 老師／類別／付款方式 統計。
 */
export function useFinanceRange(
  start: string,
  end: string,
  calendarIds: string[],
) {
  const ids = [...calendarIds].sort();
  return useQuery({
    queryKey: ["report-finance", start, end, ids],
    enabled: ids.length > 0 && !!start && !!end,
    queryFn: async (): Promise<FinanceItem[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("finance_records")
        .select(
          "id, occurred_on, direction, amount, category_label, category_id, payment_method, is_prepaid_topup, covered_by_prepaid, is_settled, calendar_id, event_id, contact_id, note",
        )
        .gte("occurred_on", start)
        .lte("occurred_on", end)
        .in("calendar_id", ids)
        .order("occurred_on", { ascending: true });
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      if (rows.length === 0) return [];

      const eventIds = [
        ...new Set(rows.map((r) => r.event_id).filter(Boolean)),
      ] as string[];
      const contactIds = [
        ...new Set(rows.map((r) => r.contact_id).filter(Boolean)),
      ] as string[];
      const categoryIds = [
        ...new Set(rows.map((r) => r.category_id).filter(Boolean)),
      ] as string[];

      const [evRes, ctRes, catRes] = await Promise.all([
        eventIds.length
          ? supabase.from("events").select("id, title").in("id", eventIds)
          : Promise.resolve({ data: [] as { id: string; title: string }[] }),
        contactIds.length
          ? supabase.from("contacts").select("id, name").in("id", contactIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
        categoryIds.length
          ? supabase
              .from("expense_categories")
              .select("id, name, group_label")
              .in("id", categoryIds)
          : Promise.resolve({
              data: [] as { id: string; name: string; group_label: string | null }[],
            }),
      ]);
      const evTitle = new Map((evRes.data ?? []).map((e) => [e.id, e.title]));
      const ctName = new Map((ctRes.data ?? []).map((c) => [c.id, c.name]));
      const catById = new Map((catRes.data ?? []).map((c) => [c.id, c]));

      return rows.map((r) => {
        const cat = r.category_id ? catById.get(r.category_id) : null;
        return {
          ...r,
          category_name: cat?.name ?? r.category_label ?? null,
          category_group: cat?.group_label ?? null,
          event_title: r.event_id ? (evTitle.get(r.event_id) ?? null) : null,
          contact_name: r.contact_id ? (ctName.get(r.contact_id) ?? null) : null,
        };
      });
    },
  });
}

export interface TagStat {
  name: string;
  count: number; // 出現次數（標到此標籤的行程數）
  amount: number; // 這些行程的支出合計
}

/**
 * 區間內「依標籤」的次數與金額統計。
 * 例：這個月「游泳」幾次、花了多少。一筆行程有多個標籤時，各標籤都會計入。
 */
export function useTagStatsRange(
  start: string,
  end: string,
  calendarIds: string[],
) {
  const ids = [...calendarIds].sort();
  return useQuery({
    queryKey: ["report-tags", start, end, ids],
    enabled: ids.length > 0 && !!start && !!end,
    queryFn: async (): Promise<TagStat[]> => {
      const supabase = createClient();
      // 區間內的行程（依台北曆日）
      const { data: events, error } = await supabase
        .from("events")
        .select("id")
        .in("calendar_id", ids)
        .gte("starts_at", taipeiDateStartUtcISO(start))
        .lt("starts_at", taipeiDateEndExclusiveUtcISO(end));
      if (error) throw new Error(error.message);
      const eventIds = (events ?? []).map((e) => e.id);
      if (eventIds.length === 0) return [];

      const [etRes, finRes] = await Promise.all([
        supabase
          .from("event_tags")
          .select("event_id, tag_id")
          .in("event_id", eventIds),
        supabase
          .from("finance_records")
          .select("event_id, amount, direction, covered_by_prepaid")
          .in("event_id", eventIds),
      ]);
      const eventTags = etRes.data ?? [];
      if (eventTags.length === 0) return [];

      const tagIds = [...new Set(eventTags.map((r) => r.tag_id))];
      const { data: tags } = await supabase
        .from("tags")
        .select("id, name")
        .in("id", tagIds);
      const tagName = new Map((tags ?? []).map((t) => [t.id, t.name]));

      // 每筆行程的支出（排除預繳扣抵）
      const spendByEvent = new Map<string, number>();
      for (const f of finRes.data ?? []) {
        if (f.direction !== "expense" || f.covered_by_prepaid) continue;
        spendByEvent.set(
          f.event_id as string,
          (spendByEvent.get(f.event_id as string) ?? 0) + f.amount,
        );
      }

      const stats = new Map<string, TagStat>();
      for (const et of eventTags) {
        const name = tagName.get(et.tag_id);
        if (!name) continue;
        let s = stats.get(name);
        if (!s) {
          s = { name, count: 0, amount: 0 };
          stats.set(name, s);
        }
        s.count += 1;
        s.amount += spendByEvent.get(et.event_id) ?? 0;
      }
      return [...stats.values()].sort((a, b) => b.count - a.count);
    },
  });
}

export interface NoteReportItem {
  id: string;
  content: string;
  progress_label: string | null;
  created_at: string;
  authorName: string;
  event_title: string;
  event_start: string;
  calendar_id: string;
}

export function useNotesRange(
  start: string,
  end: string,
  calendarIds: string[],
) {
  const ids = [...calendarIds].sort();
  return useQuery({
    queryKey: ["report-notes", start, end, ids],
    enabled: ids.length > 0 && !!start && !!end,
    queryFn: async (): Promise<NoteReportItem[]> => {
      const supabase = createClient();
      // 該區間的行程
      const { data: events, error } = await supabase
        .from("events")
        .select("id, title, starts_at, calendar_id")
        .in("calendar_id", ids)
        .gte("starts_at", taipeiDateStartUtcISO(start))
        .lt("starts_at", taipeiDateEndExclusiveUtcISO(end));
      if (error) throw new Error(error.message);
      const evs = events ?? [];
      if (evs.length === 0) return [];
      const evById = new Map(evs.map((e) => [e.id, e]));

      const { data: notes } = await supabase
        .from("event_notes")
        .select("id, content, progress_label, created_at, author_id, event_id")
        .in("event_id", evs.map((e) => e.id))
        .order("created_at", { ascending: true });
      const noteRows = notes ?? [];
      if (noteRows.length === 0) return [];

      const authorIds = [...new Set(noteRows.map((n) => n.author_id))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", authorIds);
      const nameById = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));

      return noteRows.map((n) => {
        const ev = evById.get(n.event_id)!;
        return {
          id: n.id,
          content: n.content,
          progress_label: n.progress_label,
          created_at: n.created_at,
          authorName: nameById.get(n.author_id) ?? "使用者",
          event_title: ev.title,
          event_start: ev.starts_at,
          calendar_id: ev.calendar_id,
        };
      });
    },
  });
}
