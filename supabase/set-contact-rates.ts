/**
 * 補上「模擬老師預設收費」— 讓「選到老師 → 財務自動帶入」可實測。
 * 執行：npm run seed:rates
 *
 * 需要 .env.local 內：NEXT_PUBLIC_SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY
 * 以 service_role 連線（繞過 RLS）。
 *
 * 特性：
 *   - 非破壞性：只補「default_rate 尚未設定」的老師；已設過的完全不動。
 *   - 具幂等性：可重複執行，結果一致。
 *   - 依 role_label／name 關鍵字挑金額與付款方式，四種付款方式都各有代表。
 *   - 預設類別（default_category_id）：若該擁有者的 expense_categories 有同名類別
 *     才連動；沒有就留空（不會亂建類別汙染清單）。金額/付款方式照樣帶入。
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SERVICE_KEY) {
  console.error("\n✗ 缺少環境變數（NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY）。\n");
  process.exit(1);
}

const db: SupabaseClient = createClient(URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type PaymentMethod = "monthly" | "per_time" | "prepaid_deduct" | "prepaid_term";
type Preset = {
  billing_mode: "fixed" | "hourly";
  default_rate: number;
  default_direction: "expense" | "income";
  default_payment_method: PaymentMethod;
  /** 想連動的費用類別名稱（若擁有者有同名 expense_categories 才會帶入） */
  categoryName: string | null;
};

/**
 * 依「角色稱謂／姓名」關鍵字決定收費預設。
 * 刻意讓四種付款方式都出現，方便逐一驗證帶入行為。
 * 回傳 null＝這位不是收費對象（如客戶、律師、醫師），不補。
 */
function presetFor(roleLabel: string, name: string): Preset | null {
  const s = `${roleLabel} ${name}`;

  // 數學家教 → 每堂固定、月結
  if (/數學/.test(s) && /家教|老師/.test(s))
    return { billing_mode: "fixed", default_rate: 1600, default_direction: "expense", default_payment_method: "monthly", categoryName: "家教費" };
  // 英文家教 → 每堂固定、月結
  if (/英文/.test(s) && /家教|老師/.test(s))
    return { billing_mode: "fixed", default_rate: 1400, default_direction: "expense", default_payment_method: "monthly", categoryName: "家教費" };
  // 鋼琴 → 每次 LINE Pay
  if (/鋼琴|音樂/.test(s))
    return { billing_mode: "fixed", default_rate: 1000, default_direction: "expense", default_payment_method: "per_time", categoryName: "才藝費" };
  // 芭蕾／舞蹈 → 預繳累扣
  if (/芭蕾|舞蹈/.test(s))
    return { billing_mode: "fixed", default_rate: 900, default_direction: "expense", default_payment_method: "prepaid_deduct", categoryName: "才藝費" };
  // 健身教練 → 預付一學期（示範學期預付）
  if (/健身|教練/.test(s))
    return { billing_mode: "fixed", default_rate: 1200, default_direction: "expense", default_payment_method: "prepaid_term", categoryName: "健身課" };
  // 瑜珈 → 每次 LINE Pay
  if (/瑜珈|瑜伽/.test(s))
    return { billing_mode: "fixed", default_rate: 800, default_direction: "expense", default_payment_method: "per_time", categoryName: "健身課" };
  // 時薪型示範：家教（未指明科目）→ 時薪 × 時數、月結
  if (/家教/.test(s))
    return { billing_mode: "hourly", default_rate: 700, default_direction: "expense", default_payment_method: "monthly", categoryName: "家教費" };
  // 泛用老師（例如你手動建的「小杜」）→ 每堂固定、月結
  if (/老師/.test(s))
    return { billing_mode: "fixed", default_rate: 1000, default_direction: "expense", default_payment_method: "monthly", categoryName: "家教費" };

  return null; // 客戶／律師／會計師／醫師／特助…不是收費對象
}

const PM_LABEL: Record<PaymentMethod, string> = {
  monthly: "月結",
  per_time: "每次(LINE Pay)",
  prepaid_deduct: "預繳累扣",
  prepaid_term: "預付一學期",
};

/** 類別名稱 → 分群值（對應 lib/constants 的 CATEGORY_GROUPS：child/adult/common） */
const CATEGORY_GROUP: Record<string, string> = {
  家教費: "child",
  才藝費: "child",
  健身課: "adult",
};

async function main() {
  console.log("→ 讀取現有人物…");
  const { data: contacts, error } = await db
    .from("contacts")
    .select("id, owner_id, name, role_label, default_rate, default_category_id");
  if (error) throw error;
  if (!contacts?.length) {
    console.log("（沒有任何人物，無事可做）");
    return;
  }

  // 每位擁有者需要哪些類別（依其收費老師的 preset 反推）
  const neededByOwner = new Map<string, Set<string>>();
  for (const c of contacts) {
    const p = presetFor(c.role_label ?? "", c.name);
    if (!p?.categoryName) continue;
    if (!neededByOwner.has(c.owner_id)) neededByOwner.set(c.owner_id, new Set());
    neededByOwner.get(c.owner_id)!.add(p.categoryName);
  }

  // 補建缺少的費用類別（unique(owner_id,name)，非破壞性），並建 名稱→id 對應
  console.log("→ 確認/補建費用類別…");
  const catByOwner = new Map<string, Map<string, string>>();
  let catCreated = 0;
  for (const [oid, names] of neededByOwner) {
    const { data: cats } = await db
      .from("expense_categories")
      .select("id, name")
      .eq("owner_id", oid);
    const m = new Map<string, string>();
    for (const c of cats ?? []) m.set(c.name, c.id);
    for (const name of names) {
      if (m.has(name)) continue;
      const { data: ins, error: insErr } = await db
        .from("expense_categories")
        .insert({ owner_id: oid, name, group_label: CATEGORY_GROUP[name] ?? null })
        .select("id")
        .single();
      if (insErr) throw insErr;
      m.set(name, ins!.id);
      catCreated++;
    }
    catByOwner.set(oid, m);
  }

  let ratesSet = 0;
  let catsLinked = 0;
  let skippedNotFee = 0;
  const rows: string[] = [];

  for (const c of contacts) {
    const preset = presetFor(c.role_label ?? "", c.name);
    if (!preset) {
      skippedNotFee++;
      continue;
    }
    const catId = preset.categoryName
      ? (catByOwner.get(c.owner_id)?.get(preset.categoryName) ?? null)
      : null;

    const patch: Record<string, unknown> = {};
    // 金額/付款：只在尚未設定時補（不覆蓋既有）
    if (c.default_rate == null) {
      patch.billing_mode = preset.billing_mode;
      patch.default_rate = preset.default_rate;
      patch.default_direction = preset.default_direction;
      patch.default_payment_method = preset.default_payment_method;
    }
    // 預設類別：只在尚未連動時補
    if (c.default_category_id == null && catId) {
      patch.default_category_id = catId;
    }
    if (Object.keys(patch).length === 0) continue; // 全都設過了

    const { error: upErr } = await db.from("contacts").update(patch).eq("id", c.id);
    if (upErr) throw upErr;

    if ("default_rate" in patch) ratesSet++;
    if ("default_category_id" in patch) catsLinked++;
    const unit = preset.billing_mode === "hourly" ? "／時" : "／堂";
    rows.push(
      `   ${c.name}（${c.role_label ?? "—"}）→ $${preset.default_rate}${unit} · ${PM_LABEL[preset.default_payment_method]} · 類別「${preset.categoryName}」`,
    );
  }

  console.log("\n✓ 完成");
  if (rows.length) console.log(rows.join("\n"));
  console.log(
    `\n  新建類別：${catCreated} 個／補金額：${ratesSet} 位／補類別連動：${catsLinked} 位／非收費對象略過：${skippedNotFee} 位`,
  );
  console.log("  測試：新增行程 → 人物選到上面任一位 → 財務自動打開並帶入金額/付款方式/費用類別，並顯示灰底提示。\n");
}

main().catch((e) => {
  console.error("\n✗ 失敗：", e);
  process.exit(1);
});
