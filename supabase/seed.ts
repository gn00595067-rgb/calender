/**
 * ExecCal 種子資料
 * 執行：npm run seed
 *
 * 需要 .env.local 內：NEXT_PUBLIC_SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY
 * 以 service_role 連線（繞過 RLS）建立可展示的完整資料。具幂等性，可重複執行。
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fromZonedTime } from "date-fns-tz";

config({ path: ".env.local" });

const TZ = "Asia/Taipei";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !SERVICE_KEY) {
  console.error(
    "\n✗ 缺少環境變數。請在 .env.local 設定 NEXT_PUBLIC_SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY 後再執行。\n",
  );
  process.exit(1);
}

const db: SupabaseClient = createClient(URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PASSWORD = "test1234";
const BOSS_EMAIL = "boss@example.com";
const TUTOR_EMAIL = "tutor@example.com";

/** 將台北牆上時間（yyyy-MM-ddTHH:mm）轉 UTC ISO */
function tp(wall: string): string {
  return fromZonedTime(wall, TZ).toISOString();
}

/** 相對今天位移天數，回傳 yyyy-MM-dd（台北曆） */
function dayStr(offsetDays: number): string {
  const now = new Date();
  const tpNow = new Date(now.toLocaleString("en-US", { timeZone: TZ }));
  tpNow.setDate(tpNow.getDate() + offsetDays);
  const y = tpNow.getFullYear();
  const m = String(tpNow.getMonth() + 1).padStart(2, "0");
  const d = String(tpNow.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 今天的星期（0=日..6=六，台北） */
function todayWeekday(): number {
  const tpNow = new Date(new Date().toLocaleString("en-US", { timeZone: TZ }));
  return tpNow.getDay();
}

/** 取得「相對本週」某星期幾、第 weekOffset 週的日期字串 */
function weekdayStr(targetDow: number, weekOffset: number): string {
  const diff = targetDow - todayWeekday();
  return dayStr(diff + weekOffset * 7);
}

async function getOrCreateUser(
  email: string,
  displayName: string,
): Promise<string> {
  const { data: created, error } = await db.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });
  if (created?.user) return created.user.id;

  if (error && !/already|registered|exists/i.test(error.message)) {
    throw error;
  }
  // 已存在 → 從清單找出
  const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
  const found = list?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!found) throw new Error(`無法建立或找到使用者 ${email}`);
  // 確保密碼與 metadata 一致
  await db.auth.admin.updateUserById(found.id, {
    password: PASSWORD,
    user_metadata: { display_name: displayName },
  });
  return found.id;
}

async function main() {
  console.log("→ 建立測試帳號…");
  const bossId = await getOrCreateUser(BOSS_EMAIL, "王老闆");
  const tutorId = await getOrCreateUser(TUTOR_EMAIL, "陳老師");

  // 確保 profiles 存在（觸發器通常已建立）
  await db.from("profiles").upsert([
    { id: bossId, email: BOSS_EMAIL, display_name: "王老闆" },
    { id: tutorId, email: TUTOR_EMAIL, display_name: "陳老師" },
  ]);

  console.log("→ 清除既有資料（幂等）…");
  await db.from("calendars").delete().eq("owner_id", bossId); // 級聯 events / notes / shares
  await db.from("contacts").delete().eq("owner_id", bossId);
  await db.from("tags").delete().eq("owner_id", bossId);
  await db.from("finance_records").delete().eq("owner_id", bossId);
  // 家教是純協作者：移除其自身的預設分類，讓登入後只看到被分享的「小明（兒子）」
  await db.from("calendars").delete().eq("owner_id", tutorId);

  console.log("→ 建立分類…");
  const calendarsSpec = [
    { key: "self", name: "本人", kind: "self", color: "#2563EB", position: 0 },
    { key: "child", name: "小明（兒子）", kind: "child", color: "#16A34A", position: 1 },
    { key: "work", name: "公事", kind: "work", color: "#9333EA", position: 2 },
    { key: "private", name: "私事", kind: "private", color: "#EA580C", position: 3 },
  ];
  const { data: calRows, error: calErr } = await db
    .from("calendars")
    .insert(
      calendarsSpec.map((c) => ({
        owner_id: bossId,
        name: c.name,
        kind: c.kind,
        color: c.color,
        position: c.position,
      })),
    )
    .select();
  if (calErr) throw calErr;
  const cal: Record<string, string> = {};
  calendarsSpec.forEach((c, i) => (cal[c.key] = calRows![i].id));

  console.log("→ 建立人物…");
  const { data: contactRows, error: cErr } = await db
    .from("contacts")
    .insert([
      { owner_id: bossId, name: "陳老師", role_label: "數學家教", phone: "0912-345-678" },
      { owner_id: bossId, name: "林教練", role_label: "鋼琴老師" },
      { owner_id: bossId, name: "張醫師", role_label: "家庭醫師" },
      { owner_id: bossId, name: "黃總", role_label: "策略投資人" },
      { owner_id: bossId, name: "李律師", role_label: "法律顧問" },
    ])
    .select();
  if (cErr) throw cErr;
  const ct: Record<string, string> = {};
  for (const r of contactRows!) ct[r.name] = r.id;

  console.log("→ 建立標籤…");
  const { data: tagRows, error: tErr } = await db
    .from("tags")
    .insert(
      ["數學", "音樂", "健康", "投資", "家庭", "法務"].map((name) => ({
        owner_id: bossId,
        name,
      })),
    )
    .select();
  if (tErr) throw tErr;
  const tg: Record<string, string> = {};
  for (const r of tagRows!) tg[r.name] = r.id;

  console.log("→ 建立分享（小明 → 陳老師 contributor）…");
  await db.from("calendar_shares").insert({
    calendar_id: cal.child,
    invited_email: TUTOR_EMAIL,
    member_id: tutorId,
    role: "contributor",
  });

  // ---------------------------------------------------------
  // 行程
  // ---------------------------------------------------------
  console.log("→ 建立行程…");
  type EvSpec = {
    calendar_id: string;
    title: string;
    startWall: string;
    endWall: string;
    location?: string;
    description?: string;
    important?: boolean;
    contacts?: string[];
    tags?: string[];
    recurrenceGroup?: string;
    recurrenceRule?: string;
  };
  const specs: EvSpec[] = [];
  const push = (s: EvSpec) => specs.push(s);

  // 每週二 19:00–20:30 數學家教課（小明），從 4 週前到 6 週後
  const tutorGroup = crypto.randomUUID();
  const tutorWeeks: number[] = [];
  for (let w = -4; w <= 6; w++) tutorWeeks.push(w);
  for (const w of tutorWeeks) {
    const d = weekdayStr(2, w); // 週二
    push({
      calendar_id: cal.child,
      title: "數學家教課",
      startWall: `${d}T19:00`,
      endWall: `${d}T20:30`,
      location: "書房",
      description: "高中數學一對一",
      contacts: ["陳老師"],
      tags: ["數學"],
      recurrenceGroup: tutorGroup,
      recurrenceRule: "weekly",
    });
  }

  // 每週四 17:00–18:00 鋼琴課（小明）
  const pianoGroup = crypto.randomUUID();
  for (let w = -3; w <= 5; w++) {
    const d = weekdayStr(4, w);
    push({
      calendar_id: cal.child,
      title: "鋼琴課",
      startWall: `${d}T17:00`,
      endWall: `${d}T18:00`,
      location: "音樂教室",
      contacts: ["林教練"],
      tags: ["音樂"],
      recurrenceGroup: pianoGroup,
      recurrenceRule: "weekly",
    });
  }

  // 董事會（公事，重點）— 本週一 09:00–11:00
  const boardDay = weekdayStr(1, 0);
  push({
    calendar_id: cal.work,
    title: "董事會",
    startWall: `${boardDay}T09:00`,
    endWall: `${boardDay}T11:00`,
    location: "總部 20F 會議室",
    important: true,
    tags: ["投資"],
  });
  // 衝突 1：牙醫（本人）與董事會重疊
  push({
    calendar_id: cal.self,
    title: "牙醫回診",
    startWall: `${boardDay}T09:30`,
    endWall: `${boardDay}T10:15`,
    location: "康健牙醫",
    contacts: ["張醫師"],
    tags: ["健康"],
  });

  // 投資人餐敘（公事）— 下週三晚上，掛支出
  const dinnerDay = weekdayStr(3, 1);
  push({
    calendar_id: cal.work,
    title: "投資人餐敘",
    startWall: `${dinnerDay}T18:30`,
    endWall: `${dinnerDay}T21:00`,
    location: "晶華軒",
    contacts: ["黃總"],
    tags: ["投資"],
    important: true,
  });

  // 健檢（本人，重點）— 下週五早上
  const healthDay = weekdayStr(5, 1);
  push({
    calendar_id: cal.self,
    title: "年度健康檢查",
    startWall: `${healthDay}T08:00`,
    endWall: `${healthDay}T12:00`,
    location: "國泰健檢中心",
    important: true,
    contacts: ["張醫師"],
    tags: ["健康"],
  });

  // 高爾夫（私事）— 本週六早上，與家庭早餐衝突（衝突 2）
  const golfDay = weekdayStr(6, 0);
  push({
    calendar_id: cal.private,
    title: "高爾夫球敘",
    startWall: `${golfDay}T07:00`,
    endWall: `${golfDay}T11:00`,
    location: "林口高爾夫俱樂部",
    tags: ["家庭"],
  });
  push({
    calendar_id: cal.self,
    title: "家庭早餐",
    startWall: `${golfDay}T08:00`,
    endWall: `${golfDay}T09:00`,
    location: "家中",
    tags: ["家庭"],
  });

  // 其他填充行程
  push({
    calendar_id: cal.work,
    title: "季度策略會議",
    startWall: `${weekdayStr(4, 0)}T14:00`,
    endWall: `${weekdayStr(4, 0)}T16:00`,
    location: "總部 18F",
    tags: ["投資"],
    important: true,
  });
  push({
    calendar_id: cal.work,
    title: "與李律師討論併購案",
    startWall: `${weekdayStr(3, 0)}T15:00`,
    endWall: `${weekdayStr(3, 0)}T16:00`,
    location: "法務部",
    contacts: ["李律師"],
    tags: ["法務"],
  });
  push({
    calendar_id: cal.work,
    title: "出差－上海分公司",
    startWall: `${weekdayStr(1, 2)}T08:00`,
    endWall: `${weekdayStr(2, 2)}T20:00`,
    location: "上海",
    description: "兩天一夜，視察分公司營運",
    tags: ["投資"],
  });
  push({
    calendar_id: cal.private,
    title: "家長會",
    startWall: `${weekdayStr(5, 0)}T19:00`,
    endWall: `${weekdayStr(5, 0)}T20:30`,
    location: "明德中學",
    tags: ["家庭"],
  });
  push({
    calendar_id: cal.private,
    title: "結婚紀念日晚餐",
    startWall: `${weekdayStr(6, 1)}T19:00`,
    endWall: `${weekdayStr(6, 1)}T21:30`,
    location: "教父牛排",
    important: true,
    tags: ["家庭"],
  });
  push({
    calendar_id: cal.self,
    title: "健身教練課",
    startWall: `${weekdayStr(3, -1)}T07:00`,
    endWall: `${weekdayStr(3, -1)}T08:00`,
    location: "健身房",
    tags: ["健康"],
  });
  push({
    calendar_id: cal.child,
    title: "小明段考",
    startWall: `${weekdayStr(1, 1)}T08:00`,
    endWall: `${weekdayStr(1, 1)}T12:00`,
    location: "明德中學",
    important: true,
    tags: ["數學"],
  });
  push({
    calendar_id: cal.work,
    title: "投資組合檢視",
    startWall: `${weekdayStr(2, -1)}T10:00`,
    endWall: `${weekdayStr(2, -1)}T11:00`,
    location: "線上",
    contacts: ["黃總"],
    tags: ["投資"],
  });

  // 全部展開為列
  const eventRows = specs.map((s) => ({
    calendar_id: s.calendar_id,
    creator_id: bossId,
    title: s.title,
    description: s.description ?? null,
    location: s.location ?? null,
    starts_at: tp(s.startWall),
    ends_at: tp(s.endWall),
    all_day: false,
    is_important: s.important ?? false,
    recurrence_rule: s.recurrenceRule ?? null,
    recurrence_group_id: s.recurrenceGroup ?? null,
  }));
  const { data: insertedEvents, error: evErr } = await db
    .from("events")
    .insert(eventRows)
    .select();
  if (evErr) throw evErr;

  // 關聯 contacts / tags
  const ecRows: { event_id: string; contact_id: string }[] = [];
  const etRows: { event_id: string; tag_id: string }[] = [];
  specs.forEach((s, i) => {
    const eid = insertedEvents![i].id;
    for (const name of s.contacts ?? [])
      if (ct[name]) ecRows.push({ event_id: eid, contact_id: ct[name] });
    for (const name of s.tags ?? [])
      if (tg[name]) etRows.push({ event_id: eid, tag_id: tg[name] });
  });
  if (ecRows.length) await db.from("event_contacts").insert(ecRows);
  if (etRows.length) await db.from("event_tags").insert(etRows);

  // ---------------------------------------------------------
  // 財務：家教費（每堂 1600），過去堂數已結清、未來未結清
  // ---------------------------------------------------------
  console.log("→ 建立財務紀錄…");
  const tutorEvents = specs
    .map((s, i) => ({ s, ev: insertedEvents![i] }))
    .filter((x) => x.s.recurrenceGroup === tutorGroup);

  const financeRows = tutorEvents.map(({ s, ev }) => {
    const occurred = s.startWall.slice(0, 10);
    const isPast = new Date(ev.starts_at) < new Date();
    return {
      owner_id: bossId,
      calendar_id: cal.child,
      event_id: ev.id,
      direction: "expense" as const,
      amount: 1600,
      category_label: "家教費",
      contact_id: ct["陳老師"],
      occurred_on: occurred,
      is_settled: isPast, // 已上過的課視為已付
      note: null as string | null,
    };
  });
  // 投資人餐敘支出
  const dinnerEv = insertedEvents!.find((_e, i) => specs[i].title === "投資人餐敘");
  if (dinnerEv) {
    financeRows.push({
      owner_id: bossId,
      calendar_id: cal.work,
      event_id: dinnerEv.id,
      direction: "expense",
      amount: 18000,
      category_label: "餐敘",
      contact_id: ct["黃總"],
      occurred_on: dinnerEv.starts_at.slice(0, 10),
      is_settled: false,
      note: "含酒水",
    });
  }
  // 鋼琴課月費（一筆）
  const pianoFirst = insertedEvents!.find((_e, i) => specs[i].title === "鋼琴課");
  if (pianoFirst) {
    financeRows.push({
      owner_id: bossId,
      calendar_id: cal.child,
      event_id: pianoFirst.id,
      direction: "expense",
      amount: 4800,
      category_label: "才藝費",
      contact_id: ct["林教練"],
      occurred_on: pianoFirst.starts_at.slice(0, 10),
      is_settled: true,
      note: "鋼琴月費",
    });
  }
  await db.from("finance_records").insert(financeRows);

  // ---------------------------------------------------------
  // 教學回饋：陳老師針對前 3 堂已上的家教課
  // ---------------------------------------------------------
  console.log("→ 建立教學回饋…");
  const pastTutor = tutorEvents
    .filter((x) => new Date(x.ev.starts_at) < new Date())
    .sort((a, b) => +new Date(a.ev.starts_at) - +new Date(b.ev.starts_at));
  const noteContents = [
    { content: "今天複習三角函數基本恆等式，小明反應不錯，作業正確率約 8 成。", progress_label: "三角函數 ch1 完成" },
    { content: "進入和差角公式，計算較不熟練，需加強練習。已指派 20 題。", progress_label: "三角函數 ch2 進行中" },
    { content: "檢討上次作業並教授倍角公式，觀念已掌握，段考前再總複習。", progress_label: "三角函數 ch3 完成" },
  ];
  const noteRows = pastTutor.slice(-3).map((x, i) => ({
    event_id: x.ev.id,
    author_id: tutorId,
    content: noteContents[i]?.content ?? "課程回饋。",
    progress_label: noteContents[i]?.progress_label ?? null,
  }));
  if (noteRows.length) await db.from("event_notes").insert(noteRows);

  console.log(`\n✓ 種子資料完成！`);
  console.log(`  行程：${eventRows.length} 筆（含每週家教／鋼琴、2 組時間衝突、重點行程）`);
  console.log(`  財務：${financeRows.length} 筆　回饋：${noteRows.length} 筆`);
  console.log(`\n  登入帳號：`);
  console.log(`   老闆　boss@example.com / ${PASSWORD}`);
  console.log(`   家教　tutor@example.com / ${PASSWORD}（僅能看到「小明（兒子）」）\n`);
}

main().catch((e) => {
  console.error("\n✗ 種子失敗：", e);
  process.exit(1);
});
