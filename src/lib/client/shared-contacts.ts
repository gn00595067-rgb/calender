"use client";

import { createClient } from "@/lib/supabase/client";

/**
 * 不含錢的人物資料（名字、稱謂、別名、規則、作息）。家庭老師等看不到費用的人讀不到人物表整列（0034），
 * 一律走 shared_contacts()；0034 前沒有這個函式就退回直接查表。
 */
export type SafeContact = {
  id: string;
  owner_id: string;
  name: string;
  role_label: string | null;
  is_family: boolean;
  is_self: boolean;
  aliases: string[];
  rules: string | null;
  routine: unknown;
  gap_mode: string;
};

export async function fetchSafeContacts(ids: string[] | null): Promise<SafeContact[]> {
  if (ids && ids.length === 0) return [];
  const supabase = createClient();
  const out: SafeContact[] = [];
  const chunks = ids ? Array.from({ length: Math.ceil(ids.length / 200) }, (_, i) => ids.slice(i * 200, i * 200 + 200)) : [null];
  for (const c of chunks) {
    const { data, error } = await supabase.rpc("shared_contacts", { p_ids: c });
    if (error) {
      // 0034 前：照舊查表
      const q = supabase.from("contacts").select("*");
      const { data: rows } = c ? await q.in("id", c) : await q;
      return (rows ?? []).map((r) => ({
        id: r.id,
        owner_id: r.owner_id,
        name: r.name,
        role_label: r.role_label,
        is_family: r.is_family,
        is_self: r.is_self ?? false,
        aliases: r.aliases ?? [],
        rules: r.rules ?? null,
        routine: r.routine,
        gap_mode: r.gap_mode ?? "off",
      }));
    }
    out.push(...(data ?? []));
  }
  return out;
}
