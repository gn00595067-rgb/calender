"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { driverFromRow, type DriverEventLike, type DriverTrip } from "@/lib/driver";

/**
 * 司機加班與接送行程的資料存取（司機端、Peggy 端共用；權限由 RLS 把關）。
 * spec：docs/specs/司機打卡與加班費.md
 */

export interface OvertimeRow {
  id: string;
  owner_id: string;
  contact_id: string;
  author_id: string | null;
  work_date: string;
  start_time: string;
  end_time: string;
  reason: string;
  event_id: string | null;
  status: "pending" | "approved" | "rejected";
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DriverLink {
  contactId: string;
  name: string;
  ownerId: string;
  ownerName: string;
  salary: number | null;
}

const MISSING = "司機加班需先套用資料庫更新（0028）";

export function friendlyOvertimeError(msg: string): string {
  if (/does not exist|schema cache|Could not find/i.test(msg)) return MISSING;
  if (/row-level security/i.test(msg)) return "沒有權限（可能已核准不能再改），請找 Peggy";
  if (/driver_overtime_time_order/.test(msg)) return "結束時間要晚於開始時間";
  return msg;
}

/** 我是哪位司機（司機帳號登入後用） */
export function useDriverLink() {
  return useQuery({
    queryKey: ["overtime", "link"],
    queryFn: async (): Promise<DriverLink | null> => {
      const { data, error } = await createClient().rpc("my_driver_links");
      if (error) throw new Error(friendlyOvertimeError(error.message));
      const r = data?.[0];
      return r
        ? {
            contactId: r.contact_id,
            name: r.contact_name,
            ownerId: r.owner_id,
            ownerName: r.owner_name,
            salary: r.monthly_salary,
          }
        : null;
    },
  });
}

/** 加班申請：司機端用 contactId、Peggy 端用 ownerId */
export function useOvertime(
  scope: { contactId: string | null } | { ownerId: string },
  range: { from: string; to: string },
) {
  const key = "contactId" in scope ? scope.contactId : scope.ownerId;
  return useQuery({
    queryKey: ["overtime", "rows", scope, range],
    enabled: !!key,
    queryFn: async (): Promise<OvertimeRow[]> => {
      let q = createClient().from("driver_overtime").select("*");
      q = "contactId" in scope ? q.eq("contact_id", scope.contactId!) : q.eq("owner_id", scope.ownerId);
      const { data, error } = await q
        .gte("work_date", range.from)
        .lte("work_date", range.to)
        .order("work_date", { ascending: false })
        .order("start_time", { ascending: false });
      if (error) throw new Error(friendlyOvertimeError(error.message));
      return (data ?? []) as OvertimeRow[];
    },
  });
}

/** Peggy 的司機人物（有建司機帳號的） */
export function useMyDrivers(ownerId: string) {
  return useQuery({
    queryKey: ["overtime", "drivers", ownerId],
    queryFn: async () => {
      const { data, error } = await createClient()
        .from("contacts")
        .select("id, name, monthly_salary, driver_user_id")
        .eq("owner_id", ownerId)
        .not("driver_user_id", "is", null)
        .order("name");
      if (error) throw new Error(friendlyOvertimeError(error.message));
      return (data ?? []).map((c) => ({ id: c.id, name: c.name, salary: c.monthly_salary ?? null }));
    },
  });
}

/** 司機看得到的接送行程（主人「需要司機」的行程，不含費用） */
export function useDriverTrips(fromIso: string, toIso: string, enabled = true) {
  return useQuery({
    queryKey: ["overtime", "trips", fromIso, toIso],
    enabled,
    queryFn: async (): Promise<DriverEventLike[]> => {
      const { data, error } = await createClient().rpc("driver_trips", { p_from: fromIso, p_to: toIso });
      if (error) throw new Error(friendlyOvertimeError(error.message));
      return (data ?? []).map((r) => ({
        id: r.event_id,
        title: r.title,
        location: r.location,
        starts_at: r.starts_at,
        ends_at: r.ends_at,
        all_day: r.all_day,
        subjectNames: r.subject_names ?? [],
        driver: driverFromRow({
          needs_driver: true,
          driver_trip: r.driver_trip as DriverTrip | null,
          driver_pickup_minutes: r.driver_pickup_minutes,
          driver_pickup_location: r.driver_pickup_location,
          driver_dropoff_location: r.driver_dropoff_location,
          driver_note: r.driver_note,
        }),
      }));
    },
  });
}

/**
 * 國定假日：政府行政機關辦公日曆（社群整理的 JSON，jsDelivr CDN）。
 * 只取有名稱的放假日（週末本身沒有名稱，不算）。讀不到就回空表並在畫面提醒。
 */
export function useTaiwanHolidays(years: number[]) {
  const ys = [...new Set(years)].sort();
  return useQuery({
    queryKey: ["tw-holidays", ys],
    staleTime: 24 * 60 * 60 * 1000,
    queryFn: async (): Promise<Map<string, string>> => {
      const m = new Map<string, string>();
      await Promise.all(
        ys.map(async (y) => {
          const res = await fetch(`https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/${y}.json`);
          if (!res.ok) throw new Error(`讀不到 ${y} 年政府行事曆`);
          const days = (await res.json()) as { date: string; isHoliday: boolean; description: string }[];
          for (const d of days) {
            if (d.isHoliday && d.description) {
              m.set(`${d.date.slice(0, 4)}-${d.date.slice(4, 6)}-${d.date.slice(6, 8)}`, d.description);
            }
          }
        }),
      );
      return m;
    },
  });
}

/** Peggy 核准／退回（RLS：只有主人能改狀態） */
export async function reviewOvertime(
  id: string,
  status: "approved" | "rejected" | "pending",
  note: string | null,
): Promise<string | null> {
  const { error } = await createClient()
    .from("driver_overtime")
    .update({
      status,
      review_note: note?.trim() || null,
      reviewed_at: status === "pending" ? null : new Date().toISOString(),
    })
    .eq("id", id);
  return error ? friendlyOvertimeError(error.message) : null;
}

export async function deleteOvertime(id: string): Promise<string | null> {
  const { error } = await createClient().from("driver_overtime").delete().eq("id", id);
  return error ? friendlyOvertimeError(error.message) : null;
}
