"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export interface ContactLite {
  id: string;
  name: string;
  role_label: string | null;
}

export function useContacts() {
  return useQuery({
    queryKey: ["contacts"],
    queryFn: async (): Promise<ContactLite[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("contacts")
        .select("id, name, role_label")
        .order("name", { ascending: true });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export function useTags() {
  return useQuery({
    queryKey: ["tags"],
    queryFn: async (): Promise<{ id: string; name: string }[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("tags")
        .select("id, name")
        .order("name", { ascending: true });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export interface EventEditData {
  contactIds: string[];
  finance: {
    id: string;
    direction: "expense" | "income";
    amount: number;
    category_label: string | null;
    is_settled: boolean;
  } | null;
}

/** 編輯時載入該行程既有的人物關聯與財務 */
export function useEventEditData(eventId: string | null) {
  return useQuery({
    queryKey: ["event-edit", eventId],
    enabled: !!eventId,
    queryFn: async (): Promise<EventEditData> => {
      const supabase = createClient();
      const [ecRes, finRes] = await Promise.all([
        supabase.from("event_contacts").select("contact_id").eq("event_id", eventId!),
        supabase
          .from("finance_records")
          .select("id, direction, amount, category_label, is_settled")
          .eq("event_id", eventId!)
          .order("created_at", { ascending: true })
          .limit(1),
      ]);
      return {
        contactIds: (ecRes.data ?? []).map((r) => r.contact_id),
        finance: finRes.data && finRes.data.length ? finRes.data[0] : null,
      };
    },
  });
}
