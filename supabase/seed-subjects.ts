/**
 * 依「人物分類」補模擬主角資料，讓月曆家庭視角有東西可看。
 * 執行：npm run seed:subjects
 *
 * 規則：分類名稱像某個人 → 該分類底下的行程主角補成那個人。
 *   哥哥／妹妹／豪哥／小明（兒子）／小美（女兒）→ 對應主角
 *   哥哥+妹妹 → 兩位都當主角（共同活動）
 * 其他分類（本人／公事／私事／外佣…）不動 → 維持「本人」。
 *
 * 特性：非破壞性、具幂等性（已補過的主角不重複插）。
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SERVICE_KEY) {
  console.error("\n✗ 缺少環境變數。\n");
  process.exit(1);
}
const db: SupabaseClient = createClient(URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** 分類名稱 → 主角名字陣列（null＝非人物分類，不補主角） */
function subjectsForCalendar(name: string): string[] | null {
  const n = name.trim();
  if (n === "哥哥") return ["哥哥"];
  if (n === "妹妹") return ["妹妹"];
  if (n === "豪哥") return ["豪哥"];
  if (n === "哥哥+妹妹" || n === "哥哥＋妹妹") return ["哥哥", "妹妹"];
  if (n === "小明（兒子）" || n === "小明") return ["小明"];
  if (n === "小美（女兒）" || n === "小美") return ["小美"];
  return null;
}

async function main() {
  console.log("→ 讀取分類…");
  const { data: cals, error: calErr } = await db
    .from("calendars")
    .select("id, owner_id, name");
  if (calErr) throw calErr;

  // 需要補主角的分類：calId → { ownerId, subjects[] }
  const targetCals = (cals ?? [])
    .map((c) => ({ ...c, subjects: subjectsForCalendar(c.name) }))
    .filter((c): c is typeof c & { subjects: string[] } => c.subjects != null);

  if (targetCals.length === 0) {
    console.log("（找不到任何人物分類，無事可做）");
    return;
  }

  // 各擁有者需要哪些家人主角
  const neededByOwner = new Map<string, Set<string>>();
  for (const c of targetCals) {
    if (!neededByOwner.has(c.owner_id)) neededByOwner.set(c.owner_id, new Set());
    for (const s of c.subjects) neededByOwner.get(c.owner_id)!.add(s);
  }

  // 確保家人 contacts 存在（is_family=true），建 owner+name → id
  console.log("→ 確認/補建家人（可當主角）…");
  const contactIdByOwnerName = new Map<string, string>(); // key: owner|name
  let famCreated = 0;
  for (const [ownerId, names] of neededByOwner) {
    const { data: existing } = await db
      .from("contacts")
      .select("id, name, is_family")
      .eq("owner_id", ownerId)
      .in("name", [...names]);
    const byName = new Map((existing ?? []).map((c) => [c.name, c]));
    for (const name of names) {
      const found = byName.get(name);
      if (found) {
        if (!found.is_family)
          await db.from("contacts").update({ is_family: true }).eq("id", found.id);
        contactIdByOwnerName.set(`${ownerId}|${name}`, found.id);
      } else {
        const { data: ins, error: insErr } = await db
          .from("contacts")
          .insert({ owner_id: ownerId, name, role_label: "家人", is_family: true })
          .select("id")
          .single();
        if (insErr) throw insErr;
        contactIdByOwnerName.set(`${ownerId}|${name}`, ins!.id);
        famCreated++;
      }
    }
  }

  // 逐分類：抓其行程，為每筆補主角關聯（避免重複）
  console.log("→ 補主角關聯…");
  let linked = 0;
  const perSubject: Record<string, number> = {};
  for (const c of targetCals) {
    const { data: evs } = await db.from("events").select("id").eq("calendar_id", c.id);
    const eventIds = (evs ?? []).map((e) => e.id);
    if (eventIds.length === 0) continue;

    // 既有的 subject 關聯（避免重插）
    const { data: existingLinks } = await db
      .from("event_contacts")
      .select("event_id, contact_id, role")
      .in("event_id", eventIds)
      .eq("role", "subject");
    const has = new Set((existingLinks ?? []).map((r) => `${r.event_id}|${r.contact_id}`));

    const rows: { event_id: string; contact_id: string; role: "subject" }[] = [];
    for (const s of c.subjects) {
      const cid = contactIdByOwnerName.get(`${c.owner_id}|${s}`);
      if (!cid) continue;
      for (const eid of eventIds) {
        if (has.has(`${eid}|${cid}`)) continue;
        rows.push({ event_id: eid, contact_id: cid, role: "subject" });
        perSubject[s] = (perSubject[s] ?? 0) + 1;
      }
    }
    if (rows.length) {
      const { error: insErr } = await db.from("event_contacts").insert(rows);
      if (insErr) throw insErr;
      linked += rows.length;
    }
  }

  console.log("\n✓ 完成");
  console.log(`  新建家人：${famCreated} 位`);
  console.log(`  補主角關聯：${linked} 筆`);
  for (const [s, n] of Object.entries(perSubject).sort((a, b) => b[1] - a[1]))
    console.log(`   ${s}：${n} 筆行程`);
  console.log("  月曆右上「空檔對象」選「本人＋家人（家庭視角）」即可看到小孩空檔。\n");
}

main().catch((e) => {
  console.error("\n✗ 失敗：", e);
  process.exit(1);
});
