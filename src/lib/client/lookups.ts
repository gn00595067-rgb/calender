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

export interface ContactBilling {
  id: string;
  name: string;
  billing_mode: "fixed" | "hourly" | null;
  default_rate: number | null;
  default_category_id: string | null;
  default_direction: "expense" | "income" | null;
  default_payment_method:
    | "monthly"
    | "per_time"
    | "prepaid_deduct"
    | "prepaid_term"
    | null;
}

/** 含收費預設的人物清單（供新增行程時自動帶入財務） */
export function useContactsBilling() {
  return useQuery({
    queryKey: ["contacts", "billing"],
    queryFn: async (): Promise<ContactBilling[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("contacts")
        .select(
          "id, name, billing_mode, default_rate, default_category_id, default_direction, default_payment_method",
        );
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export interface CategoryLite {
  id: string;
  name: string;
  group_label: string | null;
}

export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: async (): Promise<CategoryLite[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("expense_categories")
        .select("id, name, group_label")
        .eq("is_archived", false)
        .order("position", { ascending: true })
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
    category_id: string | null;
    payment_method:
      | "monthly"
      | "per_time"
      | "prepaid_deduct"
      | "prepaid_term"
      | null;
    prepaid_account_id: string | null;
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
          .select(
            "id, direction, amount, category_label, category_id, payment_method, prepaid_account_id, is_settled",
          )
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
