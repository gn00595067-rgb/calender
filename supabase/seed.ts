/**
 * ExecCal 種子資料 — 「老闆的 8 月」完整模擬
 * 執行：npm run seed
 *
 * 需要 .env.local 內：NEXT_PUBLIC_SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY
 * 以 service_role 連線（繞過 RLS）建立可展示的完整資料。具幂等性，可重複執行。
 *
 * 設計目標：模擬一位高階主管在 2026 年 8 月「密密麻麻」的真實一個月——
 *   公務邀約（董事會、法說會、餐敘、出差、簽約、專訪…）、
 *   兩個小孩的家教與才藝課、家庭活動、本人的健身與健康行程；
 *   會產生費用的課程／活動都掛上模擬收支，並保留 2 組時間衝突與教學回饋。
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

/** 模擬月份（台北曆）：涵蓋 2026 年 8＋9 月。今天＝2026-08-24，8/1–23 為過去。 */
const YEAR = 2026;
const MONTHS: { month: number; days: number }[] = [
  { month: 8, days: 31 },
  { month: 9, days: 30 },
];

const pad = (n: number) => String(n).padStart(2, "0");
/** 某月第 d 天 → yyyy-MM-dd */
function ymd(month: number, d: number): string {
  return `${YEAR}-${pad(month)}-${pad(d)}`;
}
/** 某月第 d 天的星期（0=日..6=六，台北） */
function dowOf(month: number, d: number): number {
  return new Date(`${ymd(month, d)}T12:00:00Z`).getUTCDay();
}
/** 8 月／9 月便捷寫法 */
const A = (d: number) => ymd(8, d);
const S = (d: number) => ymd(9, d);

/** 將台北牆上時間（yyyy-MM-ddTHH:mm）轉 UTC ISO */
function tp(wall: string): string {
  return fromZonedTime(wall, TZ).toISOString();
}

const NOW = new Date();
/** 該台北牆上時間是否已過（用來判定費用是否已結清、回饋是否已產生） */
function isPastWall(wall: string): boolean {
  return fromZonedTime(wall, TZ) < NOW;
}

async function getOrCreateUser(email: string, displayName: string): Promise<string> {
  const { data: created, error } = await db.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });
  if (created?.user) return created.user.id;

  if (error && !/already|registered|exists/i.test(error.message)) throw error;
  const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
  const found = list?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!found) throw new Error(`無法建立或找到使用者 ${email}`);
  await db.auth.admin.updateUserById(found.id, {
    password: PASSWORD,
    user_metadata: { display_name: displayName },
  });
  return found.id;
}

/* ------------------------------------------------------------------ */
/* 行程規格                                                            */
/* ------------------------------------------------------------------ */

type FinanceSpec = {
  direction: "expense" | "income";
  amount: number;
  category: string;
  contactName?: string;
  /** 未指定時，依行程是否已過去自動判定 */
  settled?: boolean;
  note?: string;
};

type EvSpec = {
  calKey: string;
  title: string;
  startWall: string;
  endWall: string;
  location?: string;
  description?: string;
  important?: boolean;
  allDay?: boolean;
  contacts?: string[];
  tags?: string[];
  recurrenceGroup?: string;
  recurrenceRule?: "daily" | "weekly" | "biweekly" | "monthly";
  finance?: FinanceSpec;
  /** 標記給回饋產生器用 */
  noteKind?: "math";
};

async function main() {
  console.log("→ 建立測試帳號…");
  const bossId = await getOrCreateUser(BOSS_EMAIL, "王董事長");
  const tutorId = await getOrCreateUser(TUTOR_EMAIL, "陳老師");

  await db.from("profiles").upsert([
    { id: bossId, email: BOSS_EMAIL, display_name: "王董事長" },
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
    { key: "work", name: "公事", kind: "work", color: "#9333EA", position: 1 },
    { key: "son", name: "小明（兒子）", kind: "child", color: "#16A34A", position: 2 },
    { key: "daughter", name: "小美（女兒）", kind: "child", color: "#DB2777", position: 3 },
    { key: "private", name: "私事", kind: "private", color: "#EA580C", position: 4 },
    // 新增類別（各自顏色，kind 取相近者）
    { key: "meeting", name: "會議", kind: "work", color: "#4F46E5", position: 5 }, // 靛藍
    { key: "client", name: "拜訪客戶", kind: "work", color: "#0EA5E9", position: 6 }, // 天藍
    { key: "dining", name: "餐敘", kind: "private", color: "#F59E0B", position: 7 }, // 琥珀
    { key: "food", name: "美食", kind: "private", color: "#E11D48", position: 8 }, // 玫紅
    { key: "study", name: "自我進修", kind: "self", color: "#14B8A6", position: 9 }, // 青綠
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
  const contactSpec = [
    { name: "陳老師", role_label: "數學家教", phone: "0912-345-678" },
    { name: "白老師", role_label: "英文家教", phone: "0922-118-220" },
    { name: "林老師", role_label: "鋼琴老師" },
    { name: "郭老師", role_label: "芭蕾老師" },
    { name: "周教練", role_label: "健身教練", phone: "0933-556-100" },
    { name: "蘇老師", role_label: "瑜珈老師" },
    { name: "張醫師", role_label: "家庭醫師" },
    { name: "黃總", role_label: "策略投資人" },
    { name: "李律師", role_label: "法律顧問", phone: "0955-880-321" },
    { name: "王執行長", role_label: "重要客戶 CEO" },
    { name: "林經理", role_label: "供應商窗口" },
    { name: "吳會計師", role_label: "財務顧問" },
    { name: "特助 Amber", role_label: "董事長特助", phone: "0966-333-777" },
  ];
  const { data: contactRows, error: cErr } = await db
    .from("contacts")
    .insert(contactSpec.map((c) => ({ owner_id: bossId, ...c })))
    .select();
  if (cErr) throw cErr;
  const ct: Record<string, string> = {};
  for (const r of contactRows!) ct[r.name] = r.id;

  console.log("→ 建立標籤…");
  const tagNames = [
    "數學", "英文", "音樂", "舞蹈", "健身", "健康",
    "投資", "董事會", "客戶", "法務", "家庭", "旅行", "才藝", "慈善",
    "會議", "進修", "美食",
  ];
  const { data: tagRows, error: tErr } = await db
    .from("tags")
    .insert(tagNames.map((name) => ({ owner_id: bossId, name })))
    .select();
  if (tErr) throw tErr;
  const tg: Record<string, string> = {};
  for (const r of tagRows!) tg[r.name] = r.id;

  console.log("→ 建立分享（小明 → 陳老師 contributor）…");
  await db.from("calendar_shares").insert({
    calendar_id: cal.son,
    invited_email: TUTOR_EMAIL,
    member_id: tutorId,
    role: "contributor",
  });

  // ---------------------------------------------------------
  // 組裝行程
  // ---------------------------------------------------------
  console.log("→ 組裝行程…");
  const specs: EvSpec[] = [];
  const push = (s: EvSpec) => specs.push(s);

  /* --- 1) 每週固定課程（含費用），逐日展開整個 8 月 --------------- */
  type Course = {
    calKey: string;
    weekday: number; // 0=日..6=六
    title: string;
    start: string; // HH:mm
    end: string;
    location: string;
    contact: string;
    tags: string[];
    fee: number;
    feeCategory: string;
    noteKind?: "math";
  };
  const courses: Course[] = [
    // 本人：健身／瑜珈
    { calKey: "self", weekday: 1, title: "健身教練課", start: "07:00", end: "08:00", location: "菁英健身房", contact: "周教練", tags: ["健身", "健康"], fee: 1200, feeCategory: "健身課" },
    { calKey: "self", weekday: 4, title: "健身教練課", start: "07:00", end: "08:00", location: "菁英健身房", contact: "周教練", tags: ["健身", "健康"], fee: 1200, feeCategory: "健身課" },
    { calKey: "self", weekday: 5, title: "瑜珈課", start: "07:00", end: "08:00", location: "菁英健身房", contact: "蘇老師", tags: ["健身", "健康"], fee: 800, feeCategory: "瑜珈課" },
    // 小明：數學家教、鋼琴
    { calKey: "son", weekday: 2, title: "數學家教課", start: "19:00", end: "20:30", location: "書房", contact: "陳老師", tags: ["數學", "才藝"], fee: 1600, feeCategory: "家教費", noteKind: "math" },
    { calKey: "son", weekday: 4, title: "鋼琴課", start: "17:00", end: "18:00", location: "河合音樂教室", contact: "林老師", tags: ["音樂", "才藝"], fee: 1000, feeCategory: "才藝費" },
    // 小美：英文家教、芭蕾
    { calKey: "daughter", weekday: 3, title: "英文家教課", start: "17:00", end: "18:00", location: "書房", contact: "白老師", tags: ["英文", "才藝"], fee: 1400, feeCategory: "家教費" },
    { calKey: "daughter", weekday: 4, title: "芭蕾課", start: "18:30", end: "19:30", location: "蕾蒙舞蹈教室", contact: "郭老師", tags: ["舞蹈", "才藝"], fee: 900, feeCategory: "才藝費" },
    // 新類別：自我進修（週六 EMBA）、部門週會（週三）
    { calKey: "study", weekday: 6, title: "EMBA 週末課程", start: "09:00", end: "12:00", location: "政大公企中心", contact: "", tags: ["進修"], fee: 0, feeCategory: "進修費" },
    { calKey: "meeting", weekday: 3, title: "部門週會", start: "14:00", end: "15:00", location: "總部 18F", contact: "特助 Amber", tags: ["會議"], fee: 0, feeCategory: "" },
  ];
  const courseKey = (c: Course) => `${c.calKey}|${c.title}|${c.start}|${c.weekday}`;
  const courseGroup: Record<string, string> = {};
  for (const c of courses) courseGroup[courseKey(c)] = crypto.randomUUID();

  for (const { month, days } of MONTHS) {
    for (let d = 1; d <= days; d++) {
      const wd = dowOf(month, d);
      for (const c of courses) {
        if (c.weekday !== wd) continue;
        const startWall = `${ymd(month, d)}T${c.start}`;
        push({
          calKey: c.calKey,
          title: c.title,
          startWall,
          endWall: `${ymd(month, d)}T${c.end}`,
          location: c.location,
          contacts: c.contact ? [c.contact] : undefined,
          tags: c.tags,
          recurrenceGroup: courseGroup[courseKey(c)],
          recurrenceRule: "weekly",
          finance:
            c.fee > 0
              ? { direction: "expense", amount: c.fee, category: c.feeCategory, contactName: c.contact }
              : undefined,
          noteKind: c.noteKind,
        });
      }
    }
  }

  /* --- 2) 每週固定公務例會（無費用） ----------------------------- */
  const meetingGroup = crypto.randomUUID();
  for (const { month, days } of MONTHS) {
    for (let d = 1; d <= days; d++) {
      if (dowOf(month, d) !== 1) continue; // 每週一
      // 8/3 有董事會，晨會照排 → 形成一組真實的「雙排程」衝突
      push({
        calKey: "work",
        title: "主管晨會",
        startWall: `${ymd(month, d)}T09:30`,
        endWall: `${ymd(month, d)}T10:30`,
        location: "總部 18F 會議室",
        description: "各部門週報與本週重點",
        tags: ["客戶"],
        recurrenceGroup: meetingGroup,
        recurrenceRule: "weekly",
      });
    }
  }

  /* --- 3) 一次性公務邀約 ---------------------------------------- */
  const work: EvSpec[] = [
    { calKey: "work", title: "第三季董事會", startWall: `${A(3)}T09:00`, endWall: `${A(3)}T11:30`, location: "總部 20F 董事會議室", important: true, contacts: ["黃總", "李律師"], tags: ["董事會", "投資"], description: "審議 Q3 財報與擴廠案" },
    { calKey: "work", title: "併購案協商", startWall: `${A(5)}T15:00`, endWall: `${A(5)}T16:30`, location: "法務部", important: true, contacts: ["李律師"], tags: ["法務", "投資"] },
    { calKey: "work", title: "投資人餐敘", startWall: `${A(6)}T18:30`, endWall: `${A(6)}T21:00`, location: "晶華軒", important: true, contacts: ["黃總"], tags: ["投資"], finance: { direction: "expense", amount: 18000, category: "餐敘招待", contactName: "黃總", note: "含酒水" } },
    { calKey: "work", title: "季度策略會議", startWall: `${A(7)}T14:00`, endWall: `${A(7)}T16:30`, location: "總部 18F", important: true, tags: ["投資"] },
    { calKey: "work", title: "供應商年度簡報", startWall: `${A(10)}T13:00`, endWall: `${A(10)}T14:00`, location: "總部 5F", contacts: ["林經理"], tags: ["客戶"] },
    { calKey: "work", title: "法人說明會", startWall: `${A(12)}T10:00`, endWall: `${A(12)}T12:00`, location: "君悅飯店宴會廳", important: true, tags: ["投資"], description: "上半年營運成果對外說明" },
    { calKey: "work", title: "媒體專訪（財經雜誌）", startWall: `${A(13)}T15:00`, endWall: `${A(13)}T16:00`, location: "總部 20F 貴賓室", contacts: ["特助 Amber"], tags: ["客戶"] },
    { calKey: "work", title: "面試 CFO 候選人", startWall: `${A(14)}T11:00`, endWall: `${A(14)}T12:00`, location: "總部 20F", contacts: ["吳會計師"], tags: ["投資"] },
    { calKey: "work", title: "商學院客座演講", startWall: `${A(18)}T14:00`, endWall: `${A(18)}T15:30`, location: "台大管理學院", tags: ["客戶"], finance: { direction: "income", amount: 50000, category: "演講顧問費", settled: true } },
    { calKey: "work", title: "投資組合檢視", startWall: `${A(19)}T14:00`, endWall: `${A(19)}T15:00`, location: "線上會議", contacts: ["黃總", "吳會計師"], tags: ["投資"] },
    { calKey: "work", title: "產業論壇 Keynote", startWall: `${A(20)}T09:00`, endWall: `${A(20)}T10:30`, location: "南港展覽館", important: true, tags: ["客戶"] },
    { calKey: "work", title: "重要客戶簽約儀式", startWall: `${A(17)}T16:00`, endWall: `${A(17)}T17:00`, location: "總部 20F", important: true, contacts: ["王執行長"], tags: ["客戶"] },
    { calKey: "work", title: "出差－上海分公司", startWall: `${A(24)}T08:00`, endWall: `${A(25)}T20:00`, location: "上海", description: "兩天一夜，視察分公司營運與在地招募", tags: ["旅行", "投資"], finance: { direction: "expense", amount: 46000, category: "差旅費", note: "機票＋住宿＋接待" } },
    { calKey: "work", title: "客戶拜訪（半導體大廠）", startWall: `${A(27)}T10:00`, endWall: `${A(27)}T12:00`, location: "新竹科學園區", contacts: ["王執行長"], tags: ["客戶"] },
    { calKey: "work", title: "月底財務結算會議", startWall: `${A(28)}T15:00`, endWall: `${A(28)}T16:30`, location: "總部 18F", contacts: ["吳會計師"], tags: ["投資"] },
  ];
  work.forEach(push);

  // 刻意衝突 #1：董事會當天另有客戶越洋電話（同為公事、時間重疊）
  push({
    calKey: "work",
    title: "客戶越洋電話（美西）",
    startWall: `${A(3)}T10:30`,
    endWall: `${A(3)}T11:00`,
    location: "線上",
    contacts: ["王執行長"],
    tags: ["客戶"],
  });

  /* --- 4) 健康（本人） ------------------------------------------ */
  push({ calKey: "self", title: "牙醫回診", startWall: `${A(11)}T14:00`, endWall: `${A(11)}T15:00`, location: "康健牙醫", contacts: ["張醫師"], tags: ["健康"] });
  push({ calKey: "self", title: "年度健康檢查", startWall: `${A(20)}T08:00`, endWall: `${A(20)}T12:00`, location: "國泰健檢中心", important: true, contacts: ["張醫師"], tags: ["健康"], finance: { direction: "expense", amount: 25000, category: "健檢費", note: "高階全身健檢" } });
  push({ calKey: "self", title: "眼科回診", startWall: `${A(28)}T17:30`, endWall: `${A(28)}T18:15`, location: "明亮眼科", tags: ["健康"] });

  /* --- 5) 小孩（考試／發表／檢定） ------------------------------ */
  push({ calKey: "son", title: "小明數學段考（第一天）", startWall: `${A(17)}T08:00`, endWall: `${A(17)}T12:00`, location: "明德中學", important: true, tags: ["數學"] });
  push({ calKey: "son", title: "小明數學段考（第二天）", startWall: `${A(18)}T08:00`, endWall: `${A(18)}T12:00`, location: "明德中學", important: true, tags: ["數學"] });
  push({ calKey: "daughter", title: "小美鋼琴檢定", startWall: `${A(16)}T10:00`, endWall: `${A(16)}T11:30`, location: "河合音樂教室", important: true, contacts: ["林老師"], tags: ["音樂"], finance: { direction: "expense", amount: 1800, category: "檢定報名費" } });
  push({ calKey: "daughter", title: "小美舞蹈成果發表", startWall: `${A(22)}T15:00`, endWall: `${A(22)}T17:00`, location: "城市藝文中心", important: true, contacts: ["郭老師"], tags: ["舞蹈", "家庭"] });

  /* --- 6) 家庭／私事 ------------------------------------------- */
  // 刻意衝突 #2：週六高爾夫與家庭早餐重疊（同為私事）
  push({ calKey: "private", title: "高爾夫球敘", startWall: `${A(1)}T07:00`, endWall: `${A(1)}T11:00`, location: "林口高爾夫俱樂部", tags: ["家庭"], finance: { direction: "expense", amount: 5200, category: "球敘", note: "果嶺費＋桿弟" } });
  push({ calKey: "private", title: "家庭早餐", startWall: `${A(1)}T08:00`, endWall: `${A(1)}T09:00`, location: "家中", tags: ["家庭"] });

  push({ calKey: "private", title: "全家聚餐", startWall: `${A(2)}T11:30`, endWall: `${A(2)}T14:00`, location: "欣葉台菜", tags: ["家庭"], finance: { direction: "expense", amount: 4800, category: "家庭聚餐" } });
  push({ calKey: "private", title: "父親節", startWall: A(8), endWall: A(8), allDay: true, tags: ["家庭"] });
  push({ calKey: "private", title: "家庭露營（第一天）", startWall: A(8), endWall: A(8), allDay: true, location: "武陵農場", tags: ["家庭", "旅行"], finance: { direction: "expense", amount: 12000, category: "家庭旅遊", note: "營位＋裝備＋伙食" } });
  push({ calKey: "private", title: "家庭露營（第二天）", startWall: A(9), endWall: A(9), allDay: true, location: "武陵農場", tags: ["家庭", "旅行"] });
  push({ calKey: "private", title: "結婚紀念日晚餐", startWall: `${A(15)}T19:00`, endWall: `${A(15)}T21:30`, location: "教父牛排", important: true, tags: ["家庭"], finance: { direction: "expense", amount: 8800, category: "紀念日" } });
  push({ calKey: "private", title: "家長會", startWall: `${A(21)}T19:00`, endWall: `${A(21)}T20:30`, location: "明德中學", tags: ["家庭"] });
  push({ calKey: "private", title: "岳母生日聚餐", startWall: `${A(23)}T18:00`, endWall: `${A(23)}T20:30`, location: "頤宮", important: true, tags: ["家庭"], finance: { direction: "expense", amount: 12800, category: "家庭聚餐", note: "含蛋糕與禮物" } });
  push({ calKey: "private", title: "慈善晚宴", startWall: `${A(26)}T18:30`, endWall: `${A(26)}T21:00`, location: "文華東方酒店", important: true, tags: ["慈善"], finance: { direction: "expense", amount: 100000, category: "公益捐款", note: "兒少教育基金會" } });
  push({ calKey: "private", title: "全家遊樂園", startWall: `${A(29)}T10:00`, endWall: `${A(29)}T17:00`, location: "六福村", tags: ["家庭"], finance: { direction: "expense", amount: 6400, category: "家庭出遊", note: "門票＋餐食" } });
  push({ calKey: "private", title: "週日家庭日", startWall: `${A(30)}T11:00`, endWall: `${A(30)}T13:00`, location: "家中", tags: ["家庭"] });

  /* --- 7) 新類別 + 9 月一次性行程 ------------------------------- */
  const extra: EvSpec[] = [
    // 8 月下旬：新類別鋪陳
    { calKey: "meeting", title: "產品藍圖會議", startWall: `${A(26)}T10:00`, endWall: `${A(26)}T11:30`, location: "總部 18F", tags: ["會議", "投資"] },
    { calKey: "client", title: "拜訪客戶－全國通路商", startWall: `${A(26)}T15:00`, endWall: `${A(26)}T16:30`, location: "台中", important: true, contacts: ["王執行長"], tags: ["客戶"] },
    { calKey: "dining", title: "策略夥伴餐敘", startWall: `${A(27)}T18:30`, endWall: `${A(27)}T20:30`, location: "請客樓", contacts: ["黃總"], tags: ["會議", "投資"], finance: { direction: "expense", amount: 16000, category: "餐敘招待", contactName: "黃總" } },
    { calKey: "study", title: "商業英文一對一", startWall: `${A(28)}T12:30`, endWall: `${A(28)}T13:30`, location: "線上", tags: ["進修"], finance: { direction: "expense", amount: 1500, category: "進修費" } },
    { calKey: "food", title: "無菜單料理嚐鮮", startWall: `${A(31)}T19:00`, endWall: `${A(31)}T21:00`, location: "RAW", tags: ["美食", "家庭"], finance: { direction: "expense", amount: 9800, category: "美食" } },

    // 9 月：公務 / 會議 / 客戶
    { calKey: "meeting", title: "9 月營運月會", startWall: `${S(1)}T10:00`, endWall: `${S(1)}T12:00`, location: "總部 18F", important: true, contacts: ["特助 Amber"], tags: ["會議", "投資"] },
    { calKey: "client", title: "拜訪客戶－日本商社", startWall: `${S(2)}T14:00`, endWall: `${S(2)}T16:00`, location: "總部 20F 貴賓室", important: true, contacts: ["王執行長"], tags: ["客戶"] },
    { calKey: "meeting", title: "第四季預算審查", startWall: `${S(4)}T14:00`, endWall: `${S(4)}T16:00`, location: "總部 18F", contacts: ["吳會計師"], tags: ["會議", "投資"] },
    { calKey: "work", title: "秋季法說會", startWall: `${S(9)}T10:00`, endWall: `${S(9)}T12:00`, location: "君悅飯店", important: true, tags: ["投資"], description: "第三季營運展望對外說明" },
    { calKey: "client", title: "拜訪客戶－歐洲代理商", startWall: `${S(10)}T15:00`, endWall: `${S(10)}T16:30`, location: "線上", contacts: ["林經理"], tags: ["客戶"] },
    { calKey: "dining", title: "投資人晚宴", startWall: `${S(11)}T18:30`, endWall: `${S(11)}T21:00`, location: "頤宮", important: true, contacts: ["黃總"], tags: ["會議", "投資"], finance: { direction: "expense", amount: 22000, category: "餐敘招待", contactName: "黃總" } },
    { calKey: "meeting", title: "董事會（第四季預備）", startWall: `${S(15)}T09:00`, endWall: `${S(15)}T11:30`, location: "總部 20F 董事會議室", important: true, contacts: ["李律師", "黃總"], tags: ["董事會", "會議"] },
    { calKey: "client", title: "客戶拜訪－半導體大廠", startWall: `${S(17)}T10:00`, endWall: `${S(17)}T12:00`, location: "新竹科學園區", important: true, contacts: ["王執行長"], tags: ["客戶"] },
    { calKey: "work", title: "出差－東京拓點", startWall: `${S(21)}T08:00`, endWall: `${S(22)}T20:00`, location: "東京", important: true, tags: ["旅行", "投資"], finance: { direction: "expense", amount: 68000, category: "差旅費", note: "機票＋住宿＋接待" } },
    { calKey: "meeting", title: "月底財務結算會議", startWall: `${S(29)}T15:00`, endWall: `${S(29)}T16:30`, location: "總部 18F", contacts: ["吳會計師"], tags: ["會議", "投資"] },

    // 9 月：美食 / 進修 / 健康
    { calKey: "food", title: "米其林三星饗宴", startWall: `${S(5)}T18:30`, endWall: `${S(5)}T21:00`, location: "頤宮", important: true, tags: ["美食", "家庭"], finance: { direction: "expense", amount: 15800, category: "美食", note: "結婚週年補請" } },
    { calKey: "study", title: "AI 策略工作坊", startWall: `${S(12)}T13:30`, endWall: `${S(12)}T17:00`, location: "台北文創", tags: ["進修"], finance: { direction: "expense", amount: 6800, category: "進修費" } },
    { calKey: "food", title: "老饕私廚聚會", startWall: `${S(19)}T19:00`, endWall: `${S(19)}T21:00`, location: "山海樓", tags: ["美食"], finance: { direction: "expense", amount: 7200, category: "美食" } },
    { calKey: "self", title: "年度心血管複檢", startWall: `${S(14)}T08:30`, endWall: `${S(14)}T10:00`, location: "國泰健檢中心", contacts: ["張醫師"], tags: ["健康"] },
    { calKey: "study", title: "讀書會：領導力", startWall: `${S(24)}T20:00`, endWall: `${S(24)}T21:30`, location: "線上", tags: ["進修"] },

    // 9 月：家庭 / 小孩
    { calKey: "private", title: "教師節家庭聚餐", startWall: `${S(28)}T18:00`, endWall: `${S(28)}T20:00`, location: "欣葉台菜", tags: ["家庭"], finance: { direction: "expense", amount: 5200, category: "家庭聚餐" } },
    { calKey: "daughter", title: "小美芭蕾成果驗收", startWall: `${S(6)}T15:00`, endWall: `${S(6)}T16:30`, location: "蕾蒙舞蹈教室", contacts: ["郭老師"], tags: ["舞蹈", "才藝"] },
    { calKey: "son", title: "小明科學展", startWall: `${S(13)}T09:00`, endWall: `${S(13)}T12:00`, location: "明德中學", important: true, tags: ["數學"] },
    { calKey: "private", title: "全家爬山", startWall: `${S(20)}T07:00`, endWall: `${S(20)}T12:00`, location: "陽明山", tags: ["家庭", "旅行"] },
  ];
  extra.forEach(push);

  // ---------------------------------------------------------
  // 寫入 events
  // ---------------------------------------------------------
  console.log(`→ 寫入 ${specs.length} 筆行程…`);
  const eventRows = specs.map((s) => ({
    calendar_id: cal[s.calKey],
    creator_id: bossId,
    title: s.title,
    description: s.description ?? null,
    location: s.location ?? null,
    starts_at: s.allDay ? tp(`${s.startWall}T00:00`) : tp(s.startWall),
    ends_at: s.allDay ? tp(`${s.endWall}T23:59`) : tp(s.endWall),
    all_day: s.allDay ?? false,
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
  // 財務：由帶 finance 的行程自動展開（課程費用、餐敘、差旅、捐款、演講收入…）
  // ---------------------------------------------------------
  console.log("→ 建立財務紀錄…");
  const financeRows = specs
    .map((s, i) => ({ s, ev: insertedEvents![i] }))
    .filter((x) => x.s.finance)
    .map(({ s, ev }) => {
      const f = s.finance!;
      return {
        owner_id: bossId,
        calendar_id: cal[s.calKey],
        event_id: ev.id,
        direction: f.direction,
        amount: f.amount,
        category_label: f.category,
        contact_id: f.contactName ? (ct[f.contactName] ?? null) : null,
        occurred_on: s.startWall.slice(0, 10),
        is_settled: f.settled ?? isPastWall(s.startWall),
        note: f.note ?? null,
      };
    });
  await db.from("finance_records").insert(financeRows);

  // ---------------------------------------------------------
  // 教學回饋：陳老師針對已上過的數學家教課
  // ---------------------------------------------------------
  console.log("→ 建立教學回饋…");
  const pastMath = specs
    .map((s, i) => ({ s, ev: insertedEvents![i] }))
    .filter((x) => x.s.noteKind === "math" && isPastWall(x.s.startWall))
    .sort((a, b) => +new Date(a.ev.starts_at) - +new Date(b.ev.starts_at));
  const mathNotes = [
    { content: "複習三角函數基本恆等式，小明反應不錯，作業正確率約 8 成。", progress_label: "三角函數 ch1 完成" },
    { content: "進入和差角公式，計算較不熟練，已指派 20 題加強。", progress_label: "三角函數 ch2 進行中" },
    { content: "教授倍角與半角公式，觀念已掌握，段考前安排總複習。", progress_label: "三角函數 ch3 完成" },
    { content: "段考前總複習，模擬考 88 分，粗心錯 2 題，提醒檢查。", progress_label: "段考總複習完成" },
  ];
  const noteRows = pastMath.map((x, i) => ({
    event_id: x.ev.id,
    author_id: tutorId,
    content: mathNotes[Math.min(i, mathNotes.length - 1)].content,
    progress_label: mathNotes[Math.min(i, mathNotes.length - 1)].progress_label,
  }));
  if (noteRows.length) await db.from("event_notes").insert(noteRows);

  // ---------------------------------------------------------
  // 摘要
  // ---------------------------------------------------------
  const expense = financeRows.filter((f) => f.direction === "expense").reduce((s, f) => s + f.amount, 0);
  const income = financeRows.filter((f) => f.direction === "income").reduce((s, f) => s + f.amount, 0);
  const unsettled = financeRows.filter((f) => !f.is_settled).length;
  console.log(`\n✓ 種子資料完成！（2026 年 8–9 月）`);
  console.log(`  行程：${eventRows.length} 筆（含每週課程、會議/拜訪客戶/餐敘/美食/自我進修等類別、公務邀約、家庭活動、時間衝突）`);
  console.log(`  財務：${financeRows.length} 筆　支出 $${expense.toLocaleString()}／收入 $${income.toLocaleString()}／未結清 ${unsettled} 筆`);
  console.log(`  回饋：${noteRows.length} 筆`);
  console.log(`\n  登入帳號：`);
  console.log(`   老闆　boss@example.com / ${PASSWORD}`);
  console.log(`   家教　tutor@example.com / ${PASSWORD}（僅能看到「小明（兒子）」）\n`);
}

main().catch((e) => {
  console.error("\n✗ 種子失敗：", e);
  process.exit(1);
});
