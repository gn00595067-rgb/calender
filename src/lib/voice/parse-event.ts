/**
 * 語音新增的解析核心：輸出 schema、過去習慣摘要、系統提示詞。
 * 與 API route 分開，方便本機用腳本以真實資料驗證。
 * spec：docs/specs/語音新增-精準判斷與缺漏提醒.md
 */
import { z } from "zod";
import { formatInTimeZone } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { TIME_ZONE } from "@/lib/constants";

/** 可用 VOICE_MODEL 覆寫（例如想省成本改 claude-haiku-4-5） */
export const MODEL = process.env.VOICE_MODEL || "claude-opus-5";
/** 習慣參考：往回看幾天、最多列幾種行程 */
export const HABIT_DAYS = 120;
export const HABIT_MAX_TITLES = 60;

export const WALL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const HABIT_FIELDS = [
  "time",
  "calendar",
  "subjects",
  "participants",
  "tags",
  "location",
  "driver",
] as const;

/** 模型輸出（結構化輸出保證符合；search 時新增欄位填空值） */
export const outputSchema = z.object({
  intent: z.enum(["create", "search"]),
  query: z.string().nullable(),
  calendarId: z.string().nullable(),
  title: z.string().nullable(),
  allDay: z.boolean(),
  startWall: z.string().nullable(),
  endWall: z.string().nullable(),
  location: z.string().nullable(),
  isImportant: z.boolean(),
  subjectIds: z.array(z.string()),
  participantIds: z.array(z.string()),
  tagNames: z.array(z.string()),
  needsDriver: z.boolean(),
  recurrence: z.enum(["none", "daily", "weekly", "biweekly", "monthly"]),
  weekdays: z.array(z.number().int()),
  recurrenceUntil: z.string().nullable(),
  fromHabit: z.array(z.enum(HABIT_FIELDS)),
  assumptions: z.array(z.string()),
  questions: z.array(z.string()),
  unknownNames: z.array(z.string()),
  confidence: z.number(),
  note: z.string(),
});
export type Output = z.infer<typeof outputSchema>;

type Supa = SupabaseClient<Database>;
export type ContactRow = { id: string; name: string; role_label: string | null; is_family: boolean };

/** 出現最多次的值 */
function mode<T>(values: T[]): T | null {
  const counts = new Map<T, number>();
  let best: T | null = null;
  let bestN = 0;
  for (const v of values) {
    const n = (counts.get(v) ?? 0) + 1;
    counts.set(v, n);
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

const WEEKDAY_ZH = ["", "一", "二", "三", "四", "五", "六", "日"];

/**
 * 近期同名行程的習慣摘要（一行一種），讓模型能補上沒講的人物、時間、地點等。
 * 例：「- 桌球（8 次，最近 10/01）：常在 週二/週四 18:15，60 分；分類=…；主角=哥哥；相關人物=郭老師；標籤=運動；地點=XX球館；通常要司機」
 */
export async function buildHabits(
  supabase: Supa,
  contactById: Map<string, ContactRow>,
): Promise<string> {
  const since = new Date(Date.now() - HABIT_DAYS * 86400000).toISOString();
  const { data: events } = await supabase
    .from("events")
    .select("*")
    .gte("starts_at", since)
    .order("starts_at", { ascending: false })
    .limit(600);
  const evs = events ?? [];
  if (evs.length === 0) return "（尚無過去紀錄）";
  const ids = evs.map((e) => e.id);

  const [ecRes, etRes] = await Promise.all([
    supabase.from("event_contacts").select("event_id, contact_id, role").in("event_id", ids),
    supabase.from("event_tags").select("event_id, tag_id").in("event_id", ids),
  ]);
  const tagIds = [...new Set((etRes.data ?? []).map((r) => r.tag_id))];
  const { data: tags } = tagIds.length
    ? await supabase.from("tags").select("id, name").in("id", tagIds)
    : { data: [] as { id: string; name: string }[] };
  const tagName = new Map((tags ?? []).map((t) => [t.id, t.name]));

  const subjectsOf = new Map<string, string[]>();
  const participantsOf = new Map<string, string[]>();
  for (const r of ecRes.data ?? []) {
    const name = contactById.get(r.contact_id)?.name;
    if (!name) continue;
    const map = r.role === "subject" ? subjectsOf : participantsOf;
    map.set(r.event_id, [...(map.get(r.event_id) ?? []), name]);
  }
  const tagsOf = new Map<string, string[]>();
  for (const r of etRes.data ?? []) {
    const n = tagName.get(r.tag_id);
    if (n) tagsOf.set(r.event_id, [...(tagsOf.get(r.event_id) ?? []), n]);
  }

  // 依標題分組
  const groups = new Map<string, typeof evs>();
  for (const e of evs) {
    const key = e.title.trim();
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }

  const lines = [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, HABIT_MAX_TITLES)
    .map(([title, list]) => {
      const timed = list.filter((e) => !e.all_day);
      const parts: string[] = [];
      if (timed.length) {
        const days = [
          ...new Set(
            timed.map((e) => Number(formatInTimeZone(e.starts_at, TIME_ZONE, "i"))),
          ),
        ]
          .sort()
          .map((d) => `週${WEEKDAY_ZH[d]}`)
          .slice(0, 4)
          .join("/");
        const time = mode(timed.map((e) => formatInTimeZone(e.starts_at, TIME_ZONE, "HH:mm")));
        const dur = mode(
          timed.map((e) => Math.round((+new Date(e.ends_at) - +new Date(e.starts_at)) / 60000)),
        );
        parts.push(`常在 ${days} ${time}，${dur} 分`);
      } else {
        parts.push("整日");
      }
      parts.push(`分類=${mode(list.map((e) => e.calendar_id))}`);
      const subj = mode(list.map((e) => (subjectsOf.get(e.id) ?? []).sort().join("、")));
      if (subj) parts.push(`主角=${subj}`);
      const part = mode(list.map((e) => (participantsOf.get(e.id) ?? []).sort().join("、")));
      if (part) parts.push(`相關人物=${part}`);
      const tg = mode(list.map((e) => (tagsOf.get(e.id) ?? []).sort().join("、")));
      if (tg) parts.push(`標籤=${tg}`);
      const loc = mode(list.map((e) => e.location?.trim() || ""));
      if (loc) parts.push(`地點=${loc}`);
      const driverCount = list.filter((e) => e.needs_driver).length;
      if (driverCount * 2 >= list.length) parts.push("通常要司機");
      const last = formatInTimeZone(list[0].starts_at, TIME_ZONE, "M/d");
      return `- ${title}（${list.length} 次，最近 ${last}）：${parts.join("；")}`;
    });
  return lines.join("\n");
}

export function buildSystemPrompt(args: {
  calendars: { id: string; name: string }[];
  contacts: ContactRow[];
  tagNames: string[];
  habits: string;
}) {
  const calList = args.calendars.map((c) => `- id="${c.id}" 名稱="${c.name}"`).join("\n");
  const family = args.contacts.filter((c) => c.is_family);
  const others = args.contacts.filter((c) => !c.is_family);
  const fmt = (c: ContactRow) =>
    `- id="${c.id}" 名字="${c.name}"${c.role_label ? ` 稱謂="${c.role_label}"` : ""}`;
  return `你是家庭行事曆的語音助理。使用者（家長／主管）說一句話，你先判斷「意圖」，再盡可能完整地解析成行程欄位。
使用者通常只講「什麼時候做什麼」，人物、標籤、地點常常不講——請善用下面的人物清單與過去習慣補齊，並清楚標出哪些是推測的。

「現在時間」會附在使用者訊息開頭。

## 意圖
- "search"：想找已存在的行程（幫我搜尋…、找一下…、查…、有沒有…、上次那個…）。只填 query（精煉關鍵字，去掉贅語），其他欄位填空值（null、空陣列、false、"none"）。
- "create"：想新增／安排行程。兩者皆可時，只有明確出現搜尋動詞才判 search。

## 新增時的欄位規則
分類（calendarId，從清單挑最合適的；沒把握時參考過去習慣）：
${calList}

家人（可當「主角」＝誰的行程／誰去上課）：
${family.length ? family.map(fmt).join("\n") : "（無）"}

其他人物（「相關人物」＝老師、醫師、客戶、司機等）：
${others.length ? others.map(fmt).join("\n") : "（無）"}

既有標籤：${args.tagNames.length ? args.tagNames.join("、") : "（無）"}

過去習慣（近 ${HABIT_DAYS} 天同名行程的常見設定；分類欄位是分類 id）：
${args.habits}

規則：
- 時間一律台北時間、24 小時制「YYYY-MM-DDTHH:mm」。相對日期（明天、下週三…）依現在時間換算，星期不要算錯。
- 沒講時長：有過去習慣用習慣的時長，否則 1 小時。只講日期沒講時間：有習慣用習慣時間（並寫進 assumptions），否則 allDay=true、00:00–23:59。
- 只講幾點沒講上下午，依常識與習慣判斷。
- title 簡潔，不含時間、地點、人名（「哥哥桌球」→ title="桌球"，哥哥放主角）。若與過去習慣的標題是同一件事，沿用習慣的標題寫法。
- subjectIds：句子提到的家人（哥哥、妹妹、小明…，含暱稱與稱謂對應）；沒提到但過去習慣固定是某位家人時可帶入（記入 fromHabit）。本人（使用者自己）的行程留空陣列。
- participantIds：老師、醫師、客戶等；「郭老師」對到稱謂或名字相符者。沒提到但習慣固定是某人時可帶入（記入 fromHabit）。
- tagNames：優先用既有標籤（含習慣中的標籤）；只有明顯需要時才新增，最多 3 個。
- needsDriver：說到「司機、載、接送、送去、接回」或習慣「通常要司機」時 true。
- recurrence／weekdays：說「每週二四」→ weekly、weekdays=[2,4]（0=日..6=六）；「每天」daily；「每兩週」biweekly；「每月」monthly；否則 none、[]。有講「到幾月」填 recurrenceUntil（YYYY-MM-DD），否則 null。
- location：有講才填；沒講但習慣有固定地點可帶入（記入 fromHabit）。
- isImportant：明確強調很重要／一定要／別忘了才 true。
- fromHabit：列出「不是使用者說的、而是依過去習慣帶入」的欄位（time/calendar/subjects/participants/tags/location/driver）。
- assumptions：你做的假設，每條一句中文（例：「沒講時間，先用平常的 18:15–19:15」）。沒有就空陣列。
- questions：缺了而且重要的資訊，用一句溫和、具體的中文問句（例：「這是哥哥還是妹妹的課？」「要在哪裡上課？」）。資訊足夠就空陣列，不要為了問而問。
- unknownNames：句子裡提到、但人物清單裡沒有的人名或稱謂（例：「林醫師」）。
- confidence：0~1，你對整體解析的把握。
- note：其他想提醒的一句話，沒有就空字串。`;
}

/** 使用者訊息：把會變動的「現在時間」放這裡，讓系統提示詞（人物＋習慣）可以被快取 */
export function buildUserMessage(nowHuman: string, transcript: string): string {
  return `現在時間（台北）：${nowHuman}\n使用者說：「${transcript}」`;
}
