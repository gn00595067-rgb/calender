/**
 * 家教測試沙盒：一個「測試家長」帳號＋一個「家教老師」帳號，跟 Peggy 的真實資料完全隔開。
 * 執行：npx tsx supabase/seed-tutor-sandbox.ts
 *
 * - 測試家長 sandbox-parent@execcal.test：行事曆「哥哥」「妹妹」「哥哥+妹妹」（全新、空白），
 *   人物只有哥哥、妹妹（家人），11 月放 3 筆小孩行程（1 筆已上完、2 筆未來）。
 * - 家教老師 sandbox-tutor@execcal.test：被分享上面 3 個行事曆，身分「老師」（scheduler）：
 *   看得到全部行程、可新增、只能改／刪自己加的、可以寫回饋、看不到金額。
 * 具冪等性：重跑會重設兩個帳號的密碼、把 3 筆示範行程刪掉重建（家教自己加的行程與回饋也一併清掉）。
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { fromZonedTime } from "date-fns-tz";

config({ path: ".env.local" });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const db = createClient(URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TZ = "Asia/Taipei";
const PASSWORD = "test1234";
const PARENT = { email: "sandbox-parent@execcal.test", name: "測試家長" };
const TUTOR = { email: "sandbox-tutor@execcal.test", name: "家教老師（測試）" };
const KID_CALS = [
  { name: "哥哥+妹妹", color: "#16A34A" },
  { name: "哥哥", color: "#0EA5E9" },
  { name: "妹妹", color: "#EC4899" },
];

const at = (d: string, t: string) => fromZonedTime(`${d}T${t}:00`, TZ).toISOString();

// 回傳型別取「沒有 error」那一支的 data，讓 supabase 的成功／失敗聯集型別過得了 next build 的型別檢查
type Ok<R> = Exclude<R, { error: { message: string } }> extends { data: infer D } ? D : never;
function must<R extends { data: unknown; error: { message: string } | null }>(r: R, what: string): Ok<R> {
  if (r.error) throw new Error(`${what}：${r.error.message}`);
  return r.data as Ok<R>;
}

async function ensureUser(email: string, name: string): Promise<string> {
  const list = must(await db.auth.admin.listUsers({ perPage: 1000 }), "列出使用者");
  const found = list.users.find((u) => u.email?.toLowerCase() === email);
  if (found) {
    must(await db.auth.admin.updateUserById(found.id, { password: PASSWORD }), "重設密碼");
    return found.id;
  }
  const created = must(
    await db.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: name },
    }),
    `建立 ${email}`,
  );
  return created.user!.id;
}

async function main() {
  // 1. 家長（觸發器會建預設 4 個行事曆：本人／小孩／公事／私事）
  const parentId = await ensureUser(PARENT.email, PARENT.name);

  // 2. 小孩行事曆：把預設「小孩」拿掉，改成跟 Peggy 一樣的三個
  await db.from("calendars").delete().eq("owner_id", parentId).eq("name", "小孩");
  const cals = must(
    await db.from("calendars").select("id,name").eq("owner_id", parentId),
    "讀行事曆",
  );
  const calId: Record<string, string> = {};
  for (const [i, c] of KID_CALS.entries()) {
    const hit = cals.find((x) => x.name === c.name);
    if (hit) {
      calId[c.name] = hit.id;
      continue;
    }
    const row = must(
      await db
        .from("calendars")
        .insert({ owner_id: parentId, name: c.name, kind: "child", color: c.color, position: 1 + i })
        .select("id")
        .single(),
      `建行事曆 ${c.name}`,
    );
    calId[c.name] = row.id;
  }

  // 3. 分享給家教（先建分享再建帳號 → 觸發器不會幫家教建自己的空行事曆）
  for (const name of Object.keys(calId)) {
    must(
      await db
        .from("calendar_shares")
        .upsert(
          { calendar_id: calId[name], invited_email: TUTOR.email, role: "scheduler" },
          { onConflict: "calendar_id,invited_email" },
        ),
      `分享 ${name}`,
    );
  }
  const tutorId = await ensureUser(TUTOR.email, TUTOR.name);
  await db.from("calendar_shares").update({ member_id: tutorId }).eq("invited_email", TUTOR.email);

  // 4. 人物：哥哥、妹妹（家人，當行程主角 → 回饋區會出現「課程進度／學習回饋」）
  const kidId: Record<string, string> = {};
  for (const k of ["哥哥", "妹妹"]) {
    const hit = must(
      await db.from("contacts").select("id").eq("owner_id", parentId).eq("name", k).maybeSingle(),
      "讀人物",
    );
    kidId[k] =
      hit?.id ??
      must(
        await db
          .from("contacts")
          .insert({ owner_id: parentId, name: k, is_family: true, role_label: "小孩" })
          .select("id")
          .single(),
        `建人物 ${k}`,
      ).id;
  }

  // 5. 清掉三個小孩行事曆裡所有行程（含家教測試時加的），重建 3 筆
  must(
    await db.from("events").delete().in("calendar_id", Object.values(calId)),
    "清行程",
  );
  const demo = [
    { cal: "哥哥+妹妹", title: "哥哥妹妹 英文家教", day: "2026-11-06", s: "16:00", e: "17:30", loc: "家裡", kids: ["哥哥", "妹妹"] },
    { cal: "哥哥", title: "哥哥 數學家教", day: "2026-11-13", s: "19:00", e: "20:30", loc: "家裡", kids: ["哥哥"] },
    { cal: "妹妹", title: "妹妹 游泳課", day: "2026-11-21", s: "10:00", e: "11:00", loc: "運動中心", kids: ["妹妹"], desc: "帶泳鏡、泳帽、毛巾" },
  ];
  for (const ev of demo) {
    const row = must(
      await db
        .from("events")
        .insert({
          calendar_id: calId[ev.cal],
          creator_id: parentId,
          title: ev.title,
          description: ev.desc ?? null,
          location: ev.loc,
          starts_at: at(ev.day, ev.s),
          ends_at: at(ev.day, ev.e),
        })
        .select("id")
        .single(),
      `建行程 ${ev.title}`,
    );
    must(
      await db
        .from("event_contacts")
        .insert(ev.kids.map((k) => ({ event_id: row.id, contact_id: kidId[k], role: "subject" }))),
      "掛主角",
    );
  }

  console.log("✓ 沙盒完成");
  console.log(`  家長 ${PARENT.email} / ${PASSWORD}`);
  console.log(`  家教 ${TUTOR.email} / ${PASSWORD}`);
}

main().catch((e) => {
  console.error("✗", e.message);
  process.exit(1);
});
