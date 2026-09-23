"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export interface UpcomingReminder {
  id: string;
  title: string;
  starts_at: string;
  reminder_minutes: number | null;
  location: string | null;
}

/** 未來 24 小時內、有設定提醒的行程（供桌面通知輪詢） */
export function useUpcomingReminders(enabled: boolean) {
  return useQuery({
    queryKey: ["reminders-upcoming"],
    enabled,
    refetchInterval: 60_000,
    queryFn: async (): Promise<UpcomingReminder[]> => {
      const supabase = createClient();
      const now = new Date();
      const end = new Date(now.getTime() + 24 * 3600 * 1000);
      const { data, error } = await supabase
        .from("events")
        .select("id, title, starts_at, reminder_minutes, location")
        .not("reminder_minutes", "is", null)
        .gte("starts_at", now.toISOString())
        .lte("starts_at", end.toISOString())
        .order("starts_at", { ascending: true });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}
