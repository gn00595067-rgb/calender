"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export interface PrepaidAccountView {
  id: string;
  label: string;
  contact_id: string | null;
  contact_name: string | null;
  calendar_id: string | null;
  kind: "deduct" | "term";
  total_amount: number;
  total_sessions: number | null;
  note: string | null;
  is_active: boolean;
  /** 已扣抵金額（Σ covered_by_prepaid 每堂） */
  usedAmount: number;
  /** 已扣抵堂數 */
  usedSessions: number;
  /** 剩餘餘額 */
  balance: number;
  /** 剩餘堂數（學期制才有意義） */
  remainingSessions: number | null;
}

/**
 * 預繳/預付帳戶（含即時餘額）。
 * 餘額＝total_amount − Σ(covered_by_prepaid 每堂金額)。
 */
export function usePrepaidAccounts(opts?: {
  activeOnly?: boolean;
  contactId?: string | null;
}) {
  const activeOnly = opts?.activeOnly ?? false;
  const contactId = opts?.contactId ?? null;
  return useQuery({
    queryKey: ["prepaid-accounts", activeOnly, contactId],
    queryFn: async (): Promise<PrepaidAccountView[]> => {
      const supabase = createClient();
      let q = supabase
        .from("prepaid_accounts")
        .select(
          "id, label, contact_id, calendar_id, kind, total_amount, total_sessions, note, is_active",
        )
        .order("created_at", { ascending: false });
      if (activeOnly) q = q.eq("is_active", true);
      if (contactId) q = q.eq("contact_id", contactId);
      const { data: accounts, error } = await q;
      if (error) throw new Error(error.message);
      const accs = accounts ?? [];
      if (accs.length === 0) return [];

      const ids = accs.map((a) => a.id);
      // 扣抵明細（不含儲值本身）
      const { data: draws } = await supabase
        .from("finance_records")
        .select("prepaid_account_id, amount")
        .in("prepaid_account_id", ids)
        .eq("covered_by_prepaid", true);
      const usedAmt = new Map<string, number>();
      const usedCnt = new Map<string, number>();
      for (const r of draws ?? []) {
        const k = r.prepaid_account_id as string;
        usedAmt.set(k, (usedAmt.get(k) ?? 0) + r.amount);
        usedCnt.set(k, (usedCnt.get(k) ?? 0) + 1);
      }

      const contactIds = [
        ...new Set(accs.map((a) => a.contact_id).filter(Boolean)),
      ] as string[];
      const { data: contacts } = contactIds.length
        ? await supabase.from("contacts").select("id, name").in("id", contactIds)
        : { data: [] as { id: string; name: string }[] };
      const ctName = new Map((contacts ?? []).map((c) => [c.id, c.name]));

      return accs.map((a) => {
        const usedAmount = usedAmt.get(a.id) ?? 0;
        const usedSessions = usedCnt.get(a.id) ?? 0;
        return {
          ...a,
          contact_name: a.contact_id ? (ctName.get(a.contact_id) ?? null) : null,
          usedAmount,
          usedSessions,
          balance: a.total_amount - usedAmount,
          remainingSessions:
            a.total_sessions != null ? a.total_sessions - usedSessions : null,
        };
      });
    },
  });
}
