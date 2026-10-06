/**
 * 既有行程批次補名：有主角的行程，標題後加「-主角名」（打球 → 打球-豪哥）。
 * 執行：npm run backfill:titles           （預覽，不寫入）
 *       npm run backfill:titles -- --apply（實際寫入）
 *
 * 規則同 src/lib/subject-title.ts；沒有主角（本人）的行程不動。
 * 特性：具冪等性（已含主角名的標題不重複加），可重跑。
 * spec：docs/specs/語音新增-標題加主角名.md
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { applySubjectTitle } from "../src/lib/subject-title";

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
const APPLY = process.argv.includes("--apply");
const PAGE = 1000;

/** 分頁讀完整張表（supabase 單次上限 1000 筆） */
async function readAll<T>(table: string, columns: string, eq: [string, unknown]): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from(table)
      .select(columns)
      .eq(eq[0], eq[1])
      .range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return out;
  }
}

async function main() {
  const family = await readAll<{ id: string; name: string; owner_id: string; is_self: boolean }>(
    "contacts",
    "id, name, owner_id, is_self",
    ["is_family", true],
  );
  const familyById = new Map(family.map((c) => [c.id, c]));
  const familyNamesByOwner = new Map<string, string[]>();
  for (const c of family) {
    familyNamesByOwner.set(c.owner_id, [...(familyNamesByOwner.get(c.owner_id) ?? []), c.name]);
  }

  const links = await readAll<{ event_id: string; contact_id: string }>(
    "event_contacts",
    "event_id, contact_id",
    ["role", "subject"],
  );
  const subjectIdsOf = new Map<string, string[]>();
  for (const l of links) {
    if (!familyById.has(l.contact_id)) continue;
    subjectIdsOf.set(l.event_id, [...(subjectIdsOf.get(l.event_id) ?? []), l.contact_id]);
  }
  console.log(`→ 有主角的行程：${subjectIdsOf.size} 筆`);

  const ids = [...subjectIdsOf.keys()];
  const events: { id: string; title: string }[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db.from("events").select("id, title").in("id", ids.slice(i, i + 200));
    if (error) throw error;
    events.push(...(data ?? []));
  }

  const changes = events
    .map((e) => {
      const subjects = subjectIdsOf.get(e.id)!.map((id) => familyById.get(id)!);
      // 本人（is_self）不加名字
      const names = subjects.filter((c) => !c.is_self).map((c) => c.name).sort();
      const owner = subjects[0].owner_id;
      const next = applySubjectTitle(e.title, names, familyNamesByOwner.get(owner) ?? []);
      return { id: e.id, from: e.title, to: next };
    })
    .filter((c) => c.to !== c.from);

  // 預覽：同樣的改法只列一次
  const samples = new Map<string, number>();
  for (const c of changes) {
    const k = `${c.from} → ${c.to}`;
    samples.set(k, (samples.get(k) ?? 0) + 1);
  }
  for (const [k, n] of [...samples].sort((a, b) => b[1] - a[1])) console.log(`  ${k}（${n} 筆）`);
  console.log(`→ 需要改標題：${changes.length} 筆`);

  if (!APPLY) {
    console.log("\n（預覽模式，未寫入；確認後加 -- --apply 實際執行）");
    return;
  }
  let done = 0;
  for (const c of changes) {
    const { error } = await db.from("events").update({ title: c.to }).eq("id", c.id);
    if (error) throw error;
    done++;
  }
  console.log(`✓ 已更新 ${done} 筆`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
