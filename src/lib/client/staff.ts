"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

/**
 * 家庭老師工作紀錄與週報（家長、員工共用；權限由 0031 RLS／函式把關）。
 * spec：docs/specs/Elsa需求-多人權限與家庭老師報告.md
 */

export interface StaffCategory {
  id: string;
  name: string;
  sub_label: string | null;
  group_label: string | null;
  aliases: string[];
  position: number;
}

export interface StaffLog {
  id: string;
  contact_id: string;
  work_date: string;
  start_time: string | null;
  end_time: string | null;
  hours: number;
  content: string | null;
  category_id: string | null;
  category_raw: string | null;
  sub_label: string | null;
  author_id: string | null;
  event_id: string | null;
}

export interface WeeklyReportRow {
  id: string;
  week_start: string;
  summaries: Record<string, string>;
  review: string;
  submitted_at: string | null;
  updated_at: string;
}

/** 我是哪位家長的員工（0031 前查不到 → 空） */
export function useMyStaffLinks(enabled = true) {
  return useQuery({
    queryKey: ["staff", "links"],
    enabled,
    queryFn: async () => {
      const { data, error } = await createClient().rpc("my_staff_links");
      if (error) return [];
      return data ?? [];
    },
  });
}

/** 類別（不含時薪） */
export function useStaffCategories(contactId: string | null) {
  return useQuery({
    queryKey: ["staff", "cats", contactId],
    enabled: !!contactId,
    queryFn: async (): Promise<StaffCategory[]> => {
      const { data, error } = await createClient().rpc("my_work_categories", { p_contact: contactId! });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

/** 某段日期（含頭尾）的工作紀錄 */
export function useStaffLogs(contactId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ["staff", "logs", contactId, from, to],
    enabled: !!contactId,
    queryFn: async (): Promise<StaffLog[]> => {
      const { data, error } = await createClient()
        .from("work_logs")
        .select("*")
        .eq("contact_id", contactId!)
        .gte("work_date", from)
        .lte("work_date", to)
        .order("work_date")
        .order("start_time");
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => ({
        id: r.id,
        contact_id: r.contact_id,
        work_date: r.work_date,
        start_time: r.start_time,
        end_time: r.end_time,
        hours: Number(r.hours),
        content: r.content,
        category_id: r.category_id,
        category_raw: r.category_raw,
        sub_label: r.sub_label ?? null,
        author_id: r.author_id ?? null,
        event_id: r.event_id ?? null,
      }));
    },
  });
}

export function useWeeklyReport(contactId: string | null, weekStart: string) {
  return useQuery({
    queryKey: ["staff", "report", contactId, weekStart],
    enabled: !!contactId,
    queryFn: async (): Promise<WeeklyReportRow | null> => {
      const { data, error } = await createClient()
        .from("weekly_reports")
        .select("*")
        .eq("contact_id", contactId!)
        .eq("week_start", weekStart)
        .maybeSingle();
      if (error) return null;
      return data;
    },
  });
}
