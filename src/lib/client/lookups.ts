"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { defaultPlanLabel, type RatePlan } from "@/lib/rate-plans";
import type { RoutineBlock } from "@/lib/availability";

export interface ContactLite {
  id: string;
  name: string;
  role_label: string | null;
  is_family: boolean;
}

export function useContacts() {
  return useQuery({
    queryKey: ["contacts"],
    queryFn: async (): Promise<ContactLite[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("contacts")
        .select("id, name, role_label, is_family")
        .order("name", { ascending: true });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

/**
 * 家人的固定作息（名字 → 作息），供空檔計算排除上學等時段。
 * 0014 migration 前沒有 routine 欄位：用 * 查詢，缺欄位時視為沒有作息。
 */
export function useRoutines() {
  return useQuery({
    queryKey: ["contacts", "routines"],
    queryFn: async (): Promise<Map<string, RoutineBlock[]>> => {
      const supabase = createClient();
      const { data, error } = await supabase.from("contacts").select("*").eq("is_family", true);
      const map = new Map<string, RoutineBlock[]>();
      if (error) return map;
      for (const c of data ?? []) {
        const blocks = Array.isArray(c.routine) ? (c.routine as RoutineBlock[]) : [];
        if (blocks.length) map.set(c.name, blocks);
      }
      return map;
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
    | "per_time_cash"
    | "prepaid_deduct"
    | "prepaid_term"
    | null;
  /** 收費方案（1對1／1對2…），依 position 排序；沒設收費者為空陣列 */
  plans: RatePlan[];
}

type ContactPlanSource = {
  id: string;
  billing_mode: "fixed" | "hourly" | null;
  default_rate: number | null;
};

/**
 * 讀所有人物的收費方案（依 contact_id 分組）。
 * 0008 migration 尚未套用（查無資料表）時，退回用舊的單一費率當作「1對1」方案，
 * 讓線上庫還沒更新時功能照舊可用。
 */
export async function fetchPlansByContact(
  contacts: ContactPlanSource[],
): Promise<Map<string, RatePlan[]>> {
  const supabase = createClient();
  // 用 * 而非列欄位：0011 前的庫沒有 subject_ids，列出會查詢失敗而誤判成沒有方案表
  const { data, error } = await supabase
    .from("contact_rate_plans")
    .select("*")
    .order("position", { ascending: true });
  const map = new Map<string, RatePlan[]>();
  if (error) {
    for (const c of contacts) {
      if (c.default_rate == null) continue;
      map.set(c.id, [
        {
          id: `legacy-${c.id}`,
          contact_id: c.id,
          label: defaultPlanLabel(1),
          headcount: 1,
          billing_mode: c.billing_mode ?? "fixed",
          rate: c.default_rate,
          position: 0,
          subject_ids: [],
          extra_fee: 0,
          extra_label: null,
        },
      ]);
    }
    return map;
  }
  for (const row of data ?? []) {
    const p: RatePlan = {
      id: row.id,
      contact_id: row.contact_id,
      label: row.label,
      headcount: row.headcount,
      billing_mode: row.billing_mode,
      rate: row.rate,
      position: row.position,
      subject_ids: row.subject_ids ?? [],
      extra_fee: row.extra_fee ?? 0,
      extra_label: row.extra_label ?? null,
    };
    const arr = map.get(p.contact_id);
    if (arr) arr.push(p);
    else map.set(p.contact_id, [p]);
  }
  return map;
}

/** 方案 id 是否為「舊費率暫代」（尚未套 0008，不能存進 rate_plan_id） */
export function isLegacyPlanId(id: string | null | undefined): boolean {
  return !!id && id.startsWith("legacy-");
}

/** 含收費預設與方案的人物清單（供新增行程時自動帶入財務） */
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
      const rows = data ?? [];
      const plans = await fetchPlansByContact(rows);
      return rows.map((c) => ({ ...c, plans: plans.get(c.id) ?? [] }));
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
  subjectIds: string[];
  participantIds: string[];
  finance: {
    id: string;
    direction: "expense" | "income";
    amount: number;
    category_label: string | null;
    category_id: string | null;
    payment_method:
      | "monthly"
      | "per_time"
      | "per_time_cash"
      | "prepaid_deduct"
      | "prepaid_term"
      | null;
    prepaid_account_id: string | null;
    is_settled: boolean;
    /** 0008 前的庫沒有此欄位 */
    rate_plan_id?: string | null;
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
        supabase
          .from("event_contacts")
          .select("contact_id, role")
          .eq("event_id", eventId!),
        supabase
          .from("finance_records")
          // 用 * 而非列欄位：0008 前的庫沒有 rate_plan_id，列出會查詢失敗
          .select("*")
          .eq("event_id", eventId!)
          .order("created_at", { ascending: true })
          .limit(1),
      ]);
      const ec = ecRes.data ?? [];
      return {
        subjectIds: ec.filter((r) => r.role === "subject").map((r) => r.contact_id),
        participantIds: ec
          .filter((r) => r.role !== "subject")
          .map((r) => r.contact_id),
        finance: finRes.data && finRes.data.length ? finRes.data[0] : null,
      };
    },
  });
}
