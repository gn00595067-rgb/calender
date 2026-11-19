"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { driverFromRow, type DriverInfo } from "@/lib/driver";

/**
 * 只看空檔＋提議行程的資料存取（權限由 RLS／busy_blocks 把關）。
 * spec：docs/specs/只看空檔與提議行程審核.md
 */

export interface ProposalRow {
  id: string;
  owner_id: string;
  calendar_id: string;
  proposer_id: string;
  proposer_name: string | null;
  title: string;
  starts_at: string;
  ends_at: string;
  location: string | null;
  note: string | null;
  status: "pending" | "approved" | "rejected";
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
}

/** 分享給我「只看空檔」的分類 */
export interface FreebusyCalendar {
  id: string;
  name: string;
  color: string;
  ownerId: string;
  ownerName: string;
}

export interface BusyBlock {
  calendar_id: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  driver: DriverInfo | null;
}

export function useFreebusyCalendars(meId: string) {
  return useQuery({
    queryKey: ["freebusy-calendars", meId],
    queryFn: async (): Promise<FreebusyCalendar[]> => {
      const supabase = createClient();
      const { data: shares, error } = await supabase
        .from("calendar_shares")
        .select("calendar_id")
        .eq("member_id", meId)
        .eq("role", "freebusy");
      if (error) throw new Error(error.message);
      const ids = (shares ?? []).map((s) => s.calendar_id);
      if (ids.length === 0) return [];
      const { data: cals, error: calErr } = await supabase
        .from("calendars")
        .select("id, name, color, owner_id, position")
        .in("id", ids)
        .order("position", { ascending: true });
      if (calErr) throw new Error(calErr.message);
      const owners = [...new Set((cals ?? []).map((c) => c.owner_id))];
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, display_name, email")
        .in("id", owners);
      const nameOf = new Map(
        (profs ?? []).map((p) => [p.id, p.display_name || p.email.split("@")[0]]),
      );
      return (cals ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        ownerId: c.owner_id,
        ownerName: nameOf.get(c.owner_id) ?? "",
      }));
    },
  });
}

export function useBusyBlocks(fromIso: string, toIso: string, enabled: boolean) {
  return useQuery({
    queryKey: ["busy-blocks", fromIso, toIso],
    enabled,
    queryFn: async (): Promise<BusyBlock[]> => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("busy_blocks", { p_from: fromIso, p_to: toIso });
      if (error) throw new Error(error.message);
      return (data ?? []).map((b) => ({
        calendar_id: b.calendar_id,
        starts_at: b.starts_at,
        ends_at: b.ends_at,
        all_day: b.all_day,
        driver: driverFromRow(b),
      }));
    },
  });
}

/** 我提議的（最近 50 筆） */
export function useMyProposals(meId: string) {
  return useQuery({
    queryKey: ["proposals", "mine", meId],
    queryFn: async (): Promise<ProposalRow[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("event_proposals")
        .select("*")
        .eq("proposer_id", meId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

/** 別人提議給我（擁有者）的：待審核全部＋已處理最近 30 筆。0030 前查不到 → 空 */
export function useIncomingProposals(meId: string) {
  return useQuery({
    queryKey: ["proposals", "incoming", meId],
    enabled: !!meId,
    queryFn: async (): Promise<{ pending: ProposalRow[]; done: ProposalRow[] }> => {
      const supabase = createClient();
      const [pending, done] = await Promise.all([
        supabase
          .from("event_proposals")
          .select("*")
          .eq("owner_id", meId)
          .eq("status", "pending")
          .order("starts_at", { ascending: true }),
        supabase
          .from("event_proposals")
          .select("*")
          .eq("owner_id", meId)
          .neq("status", "pending")
          .order("reviewed_at", { ascending: false })
          .limit(30),
      ]);
      if (pending.error) return { pending: [], done: [] };
      return { pending: pending.data ?? [], done: done.data ?? [] };
    },
    refetchInterval: 60_000,
  });
}

/** 月曆虛線用：某區間內待審核的提議（只有擁有者查得到） */
export function usePendingProposalsInRange(meId: string, fromIso: string, toIso: string) {
  return useQuery({
    queryKey: ["proposals", "range", meId, fromIso, toIso],
    enabled: !!meId,
    queryFn: async (): Promise<ProposalRow[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("event_proposals")
        .select("*")
        .eq("owner_id", meId)
        .eq("status", "pending")
        .lt("starts_at", toIso)
        .gt("ends_at", fromIso);
      if (error) return [];
      return data ?? [];
    },
  });
}
