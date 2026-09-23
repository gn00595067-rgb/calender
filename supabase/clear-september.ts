/**
 * 一次性維護腳本：清除 2026 年 9 月（台北曆）的模擬資料。
 * 執行：npx tsx supabase/clear-september.ts
 *
 * 只刪除 9 月：8 月資料完全保留。
 * 因 finance_records.event_id 為 ON DELETE SET NULL（不會級聯刪除），
 * 故先刪 9 月行程的財務紀錄，再刪行程本身
 * （event_contacts / event_tags / event_notes 會隨行程級聯刪除）。
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SERVICE_KEY) {
  console.error("\n✗ 缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY。\n");
  process.exit(1);
}

const db: SupabaseClient = createClient(URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// 2026 年 9 月（Asia/Taipei，UTC+8）對應的 UTC 區間
const SEP_START = "2026-08-31T16:00:00Z"; // 2026-09-01 00:00 +08:00
const SEP_END = "2026-09-30T16:00:00Z"; // 2026-10-01 00:00 +08:00（不含）
const BOSS_EMAIL = "boss@example.com";

async function main() {
  const { data: boss, error: bErr } = await db
    .from("profiles")
    .select("id")
    .eq("email", BOSS_EMAIL)
    .single();
  if (bErr || !boss) throw bErr ?? new Error("找不到 boss profile");
  const bossId = boss.id;

  const { data: cals, error: cErr } = await db
    .from("calendars")
    .select("id")
    .eq("owner_id", bossId);
  if (cErr) throw cErr;
  const calIds = (cals ?? []).map((c) => c.id);
  if (calIds.length === 0) {
    console.log("boss 沒有任何分類，無事可做。");
    return;
  }

  // 找出 9 月的行程
  const { data: sepEvents, error: eErr } = await db
    .from("events")
    .select("id, title, starts_at")
    .in("calendar_id", calIds)
    .gte("starts_at", SEP_START)
    .lt("starts_at", SEP_END);
  if (eErr) throw eErr;
  const eventIds = (sepEvents ?? []).map((e) => e.id);

  console.log(`\n→ 找到 9 月行程 ${eventIds.length} 筆。`);
  for (const e of sepEvents ?? []) {
    console.log(`   ${e.starts_at}  ${e.title}`);
  }

  if (eventIds.length === 0) {
    console.log("\n沒有 9 月資料可刪。");
    return;
  }

  // 先刪這些行程的財務紀錄（否則只會被 SET NULL 成孤兒）
  const { data: delFin, error: fErr } = await db
    .from("finance_records")
    .delete()
    .in("event_id", eventIds)
    .select("id");
  if (fErr) throw fErr;
  console.log(`\n→ 刪除財務紀錄 ${delFin?.length ?? 0} 筆。`);

  // 再刪行程本身（event_contacts / event_tags / event_notes 級聯刪除）
  const { data: delEv, error: dErr } = await db
    .from("events")
    .delete()
    .in("id", eventIds)
    .select("id");
  if (dErr) throw dErr;
  console.log(`→ 刪除行程 ${delEv?.length ?? 0} 筆。`);

  // 驗證：確認 9 月已清空、8 月仍在
  const { count: sepLeft } = await db
    .from("events")
    .select("id", { count: "exact", head: true })
    .in("calendar_id", calIds)
    .gte("starts_at", SEP_START)
    .lt("starts_at", SEP_END);
  const { count: augLeft } = await db
    .from("events")
    .select("id", { count: "exact", head: true })
    .in("calendar_id", calIds)
    .gte("starts_at", "2026-07-31T16:00:00Z")
    .lt("starts_at", SEP_START);

  console.log(`\n✓ 完成。9 月剩餘行程：${sepLeft ?? 0} 筆；8 月仍保留：${augLeft ?? 0} 筆。\n`);
}

main().catch((e) => {
  console.error("\n✗ 失敗：", e);
  process.exit(1);
});
