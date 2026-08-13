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
  is_settled: boolean;
  calendar_id: string | null;
  event_id: string | null;
  event_title: string | null;
  contact_id: string | null;
  contact_name: string | null;
  note: string | null;
}

export function useMonthlyFinance(month: string, calendarIds: string[]) {
  const ids = [...calendarIds].sort();
  return useQuery({
    queryKey: ["report-finance", month, ids],
    enabled: ids.length > 0,
    queryFn: async (): Promise<FinanceItem[]> => {
      const supabase = createClient();
      const { start, end } = monthBounds(month);
      const { data, error } = await supabase
        .from("finance_records")
        .select(
          "id, occurred_on, direction, amount, category_label, is_settled, calendar_id, event_id, contact_id, note",
        )
        .gte("occurred_on", start)
        .lte("occurred_on", end)
        .in("calendar_id", ids)
        .order("occurred_on", { ascending: true });
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      if (rows.length === 0) return [];

      const eventIds = [...new Set(rows.map((r) => r.event_id).filter(Boolean))] as string[];
      const contactIds = [...new Set(rows.map((r) => r.contact_id).filter(Boolean))] as string[];

      const [evRes, ctRes] = await Promise.all([
        eventIds.length
          ? supabase.from("events").select("id, title").in("id", eventIds)
          : Promise.resolve({ data: [] as { id: string; title: string }[] }),
        contactIds.length
          ? supabase.from("contacts").select("id, name").in("id", contactIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      ]);
      const evTitle = new Map((evRes.data ?? []).map((e) => [e.id, e.title]));
      const ctName = new Map((ctRes.data ?? []).map((c) => [c.id, c.name]));

      return rows.map((r) => ({
        ...r,
        event_title: r.event_id ? (evTitle.get(r.event_id) ?? null) : null,
        contact_name: r.contact_id ? (ctName.get(r.contact_id) ?? null) : null,
      }));
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

export function useMonthlyNotes(month: string, calendarIds: string[]) {
  const ids = [...calendarIds].sort();
  return useQuery({
    queryKey: ["report-notes", month, ids],
    enabled: ids.length > 0,
    queryFn: async (): Promise<NoteReportItem[]> => {
      const supabase = createClient();
      const { start, end } = monthBounds(month);
      // 該月的行程
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
