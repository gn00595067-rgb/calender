import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { AccessibleCalendar } from "@/types/domain";
import type { ShareRole } from "@/lib/constants";

/**
 * 取得目前使用者可存取的所有行事曆（自己擁有 + 被分享），並標註有效角色。
 * 依賴 RLS：使用者只會看到自己有權存取的列。
 * 以兩段查詢取代 join 內嵌，避免手寫型別未含 Relationships 造成的型別問題。
 */
export async function getAccessibleCalendars(
  userId: string,
): Promise<AccessibleCalendar[]> {
  const supabase = await createClient();

  const [ownedRes, sharesRes] = await Promise.all([
    supabase
      .from("calendars")
      .select("*")
      .eq("owner_id", userId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("calendar_shares")
      .select("calendar_id, role")
      .eq("member_id", userId),
  ]);

  const owned: AccessibleCalendar[] = (ownedRes.data ?? []).map((c) => ({
    ...c,
    effectiveRole: "owner",
    isOwned: true,
  }));
  const ownedIds = new Set(owned.map((c) => c.id));

  const shares = (sharesRes.data ?? []).filter(
    (s) => !ownedIds.has(s.calendar_id),
  );

  let shared: AccessibleCalendar[] = [];
  if (shares.length > 0) {
    const roleById = new Map<string, ShareRole>(
      shares.map((s) => [s.calendar_id, s.role as ShareRole]),
    );
    const { data: sharedCals } = await supabase
      .from("calendars")
      .select("*")
      .in("id", [...roleById.keys()]);

    shared = (sharedCals ?? []).map((c) => ({
      ...c,
      effectiveRole: roleById.get(c.id) ?? "viewer",
      isOwned: false,
    }));
  }

  return [...owned, ...shared];
}
