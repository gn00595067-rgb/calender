"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export interface FinanceRow {
  id: string;
  calendar_id: string | null;
  event_id: string | null;
  direction: "expense" | "income";
  amount: number;
  category_label: string | null;
  contact_id: string | null;
  occurred_on: string;
  is_settled: boolean;
  note: string | null;
}

export interface FinanceSummary {
  expense: number;
  income: number;
  unsettledCount: number;
  unsettledAmount: number;
}

export function summarize(rows: FinanceRow[]): FinanceSummary {
  let expense = 0;
  let income = 0;
  let unsettledCount = 0;
  let unsettledAmount = 0;
  for (const r of rows) {
    if (r.direction === "expense") expense += r.amount;
    else income += r.amount;
    if (!r.is_settled) {
      unsettledCount += 1;
      unsettledAmount += r.amount;
    }
  }
  return { expense, income, unsettledCount, unsettledAmount };
}

/** 讀取台北日期區間 [startDate, endDate] 內的財務紀錄（依 occurred_on，含 calendar 過濾） */
export function useFinanceInRange(
  startDate: string,
  endDate: string,
  calendarIds: string[],
) {
  const ids = [...calendarIds].sort();
  return useQuery({
    queryKey: ["finance-range", startDate, endDate, ids],
    queryFn: async (): Promise<FinanceRow[]> => {
      if (ids.length === 0) return [];
      const supabase = createClient();
      // 只取有掛在「顯示中分類」的財務（standalone 無分類者不納入總覽）
      const { data, error } = await supabase
        .from("finance_records")
        .select(
          "id, calendar_id, event_id, direction, amount, category_label, contact_id, occurred_on, is_settled, note",
        )
        .gte("occurred_on", startDate)
        .lte("occurred_on", endDate)
        .in("calendar_id", ids)
        .order("occurred_on", { ascending: true });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}
