"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

/** 工作分類（大項／小項／時薪） */
export interface WorkCategory {
  id: string;
  name: string;
  sub_label: string | null;
  hourly_rate: number;
  aliases: string[];
  position: number;
}

export interface WorkLog {
  id: string;
  work_date: string;
  start_time: string | null;
  end_time: string | null;
  hours: number;
  content: string | null;
  category_raw: string | null;
  category_id: string | null;
}

/** 有設定工作分類或月薪的人（可看工作效益的對象） */
export function useWorkPeople() {
  return useQuery({
    queryKey: ["work", "people"],
    queryFn: async () => {
      const supabase = createClient();
      const [{ data: cats, error }, { data: paid }] = await Promise.all([
        supabase.from("work_categories").select("contact_id"),
        supabase.from("contacts").select("id").not("monthly_salary", "is", null),
      ]);
      // 0018 未套用時查詢會失敗：回 null 讓頁面提示
      if (error) return null;
      return [...new Set([...(cats ?? []).map((c) => c.contact_id), ...(paid ?? []).map((c) => c.id)])];
    },
  });
}

/** 某人的月薪與工作分類 */
export function useWorkSetup(contactId: string | null) {
  return useQuery({
    queryKey: ["work", "setup", contactId],
    enabled: !!contactId,
    queryFn: async () => {
      const supabase = createClient();
      const [{ data: cats, error }, { data: contact }] = await Promise.all([
        supabase
          .from("work_categories")
          .select("id, name, sub_label, hourly_rate, aliases, position")
          .eq("contact_id", contactId!)
          .order("position"),
        supabase.from("contacts").select("monthly_salary").eq("id", contactId!).single(),
      ]);
      if (error) throw new Error(error.message);
      return {
        categories: (cats ?? []) as WorkCategory[],
        monthlySalary: (contact?.monthly_salary as number | null | undefined) ?? null,
      };
    },
  });
}

/** 某人某月（yyyy-MM）的工作紀錄 */
export function useWorkLogs(contactId: string | null, month: string) {
  return useQuery({
    queryKey: ["work", "logs", contactId, month],
    enabled: !!contactId,
    queryFn: async (): Promise<WorkLog[]> => {
      const supabase = createClient();
      const [y, m] = month.split("-").map(Number);
      const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
      const { data, error } = await supabase
        .from("work_logs")
        .select("id, work_date, start_time, end_time, hours, content, category_raw, category_id")
        .eq("contact_id", contactId!)
        .gte("work_date", `${month}-01`)
        .lt("work_date", next)
        .order("work_date")
        .order("start_time");
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => ({ ...r, hours: Number(r.hours) }));
    },
  });
}
