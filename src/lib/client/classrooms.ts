"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/types/database";

/**
 * 教室資料庫（0033）：家長與家庭老師共用；權限由 RLS can_edit_classrooms 把關。
 * spec：docs/specs/Elsa需求-多人權限與家庭老師報告.md
 */
export type Classroom = Tables<"classrooms">;

/** 某位家長的全部教室（0033 前查不到 → null，頁面提示） */
export function useClassrooms(ownerId: string | null) {
  return useQuery({
    queryKey: ["classrooms", ownerId],
    enabled: !!ownerId,
    queryFn: async (): Promise<Classroom[] | null> => {
      const { data, error } = await createClient()
        .from("classrooms")
        .select("*")
        .eq("owner_id", ownerId!)
        .order("name");
      if (error) return null;
      return data ?? [];
    },
  });
}

/** 行程對到哪間教室：標題或地點含教室名稱 */
export function matchClassroom(list: Classroom[] | null | undefined, title: string, location: string | null) {
  const hay = `${title} ${location ?? ""}`;
  return (list ?? []).filter((c) => c.name.trim().length >= 2 && hay.includes(c.name.trim()));
}
