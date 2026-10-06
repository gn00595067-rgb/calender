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
  /** 本人（老闆）；0015 前的庫沒有此欄 */
  is_self?: boolean;
}

export function useContacts() {
  return useQuery({
    queryKey: ["contacts"],
    queryFn: async (): Promise<ContactLite[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("contacts")
        .select("id, name, role_label, is_family, is_self")
        .order("name", { ascending: true });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

/** 月曆空檔顯示方式：不顯示／每天／只在沒有固定作息的日子（如小孩假日） */
export type GapMode = "off" | "always" | "free_days";

/** 空檔相關的人物設定（以名字對應，因月曆的空檔群組以名字標示） */
export interface GapProfiles {
  routines: Map<string, RoutineBlock[]>;
  /** 0015 migration 前沒有此欄位 → 空 Map，月曆沿用舊行為（有行程就列） */
  gapMode: Map<string, GapMode>;
  /** 標記為本人（老闆）的人物名字；其行程併入「本人」空檔 */
  selfName: string | null;
  /** 是否已套用 0015（決定未設定者要不要列） */
  hasGapMode: boolean;
}

/**
 * 家人的空檔設定：固定作息（上學等）、空檔顯示方式、誰是本人。
 * 用 * 查詢：0014／0015 前缺欄位時視為沒有設定，不影響月曆。
 */
export function useGapProfiles() {
  return useQuery({
    queryKey: ["contacts", "gap-profiles"],
    queryFn: async (): Promise<GapProfiles> => {
      const supabase = createClient();
      const { data, error } = await supabase.from("contacts").select("*").eq("is_family", true);
      const out: GapProfiles = {
        routines: new Map(),
        gapMode: new Map(),
        selfName: null,
        hasGapMode: false,
      };
      if (error) return out;
      for (const c of data ?? []) {
        const blocks = Array.isArray(c.routine) ? (c.routine as RoutineBlock[]) : [];
        if (blocks.length) out.routines.set(c.name, blocks);
        if (c.gap_mode) {
          out.hasGapMode = true;
          out.gapMode.set(c.name, c.gap_mode as GapMode);
        }
        if (c.is_self) out.selfName = c.name;
      }
      return out;
    },
  });
}

/**
 * 每位人物以某角色（主角／相關人物）出現在行程的次數，供選單「常用的排前面」。
 * 逐人用 count 查詢（人物數少），避免一次撈關聯列被 1000 筆上限截斷。
 */
export function useContactUsage(role: "subject" | "participant", contactIds: string[]) {
  const ids = [...contactIds].sort();
  return useQuery({
    queryKey: ["contacts", "usage", role, ids],
    enabled: ids.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<Map<string, number>> => {
      const supabase = createClient();
      const counts = await Promise.all(
        ids.map(async (id) => {
          const { count } = await supabase
            .from("event_contacts")
            .select("event_id", { count: "exact", head: true })
            .eq("contact_id", id)
            .eq("role", role);
          return [id, count ?? 0] as const;
        }),
      );
      return new Map(counts);
    },
  });
}

/**
 * 「誰常跟誰一起」：相關人物依目前主角排序用。
 * 撈全部人物關聯＋行程的系列編號，前端依情境（主角）計算；重複行程整個系列只算 1 次，
 * 避免每週上課的老師永遠排最前面。spec：docs/specs/相關人物依主角排序.md
 */
export interface CooccurrenceData {
  /** 行程 → 主角 id／相關人物 id／系列 key（無系列＝行程 id） */
  events: Map<string, { subjects: string[]; participants: string[]; series: string }>;
  /** 標記為本人（is_self）的人物 */
  selfIds: Set<string>;
}

const PAGE = 1000;
async function readAllPages<T>(
  run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await run(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

export function useContactCooccurrence(enabled: boolean) {
  return useQuery({
    queryKey: ["contacts", "cooccurrence"],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<CooccurrenceData> => {
      const supabase = createClient();
      const [links, evs, selfRes] = await Promise.all([
        readAllPages<{ event_id: string; contact_id: string; role: string }>((a, b) =>
          supabase.from("event_contacts").select("event_id, contact_id, role").range(a, b),
        ),
        readAllPages<{ id: string; recurrence_group_id: string | null }>((a, b) =>
          supabase.from("events").select("id, recurrence_group_id").range(a, b),
        ),
        supabase.from("contacts").select("id").eq("is_self", true),
      ]);
      const seriesOf = new Map(evs.map((e) => [e.id, e.recurrence_group_id ?? e.id]));
      const events: CooccurrenceData["events"] = new Map();
      for (const l of links) {
        const series = seriesOf.get(l.event_id);
        if (!series) continue;
        let e = events.get(l.event_id);
        if (!e) {
          e = { subjects: [], participants: [], series };
          events.set(l.event_id, e);
        }
        (l.role === "subject" ? e.subjects : e.participants).push(l.contact_id);
      }
      return {
        events,
        // 0015 未套用時 is_self 不存在 → 視為沒有本人人物
        selfIds: new Set((selfRes.data ?? []).map((c) => c.id)),
      };
    },
  });
}

/**
 * 依主角算出「常一起的相關人物」：主角是本人（或沒選）→ 本人行程裡的人；
 * 主角是小孩 → 該小孩行程裡的人（老師、教練）。回傳 人物 id → {系列數, 次數}。
 */
export function participantAffinity(
  data: CooccurrenceData,
  subjectIds: string[],
): Map<string, { series: number; count: number }> {
  const others = subjectIds.filter((id) => !data.selfIds.has(id));
  const selfMode = others.length === 0;
  const target = new Set(others);
  const seriesSets = new Map<string, Set<string>>();
  const counts = new Map<string, number>();
  for (const e of data.events.values()) {
    if (e.participants.length === 0) continue;
    const inContext = selfMode
      ? e.subjects.length === 0 || e.subjects.some((s) => data.selfIds.has(s))
      : e.subjects.some((s) => target.has(s));
    if (!inContext) continue;
    for (const p of e.participants) {
      if (!seriesSets.has(p)) seriesSets.set(p, new Set());
      seriesSets.get(p)!.add(e.series);
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
  }
  return new Map(
    [...seriesSets].map(([id, set]) => [id, { series: set.size, count: counts.get(id) ?? 0 }]),
  );
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
