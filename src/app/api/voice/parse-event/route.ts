import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  MODEL,
  WALL,
  outputSchema,
  buildHabits,
  buildSystemPrompt,
  buildUserMessage,
  buildFollowUpMessage,
  withLocationSuffix,
  type Output,
  type EventOutput,
  type ContactRow,
} from "@/lib/voice/parse-event";
import { withSubjectSuffix } from "@/lib/subject-title";

/**
 * 語音助理：把一句口語交給 Claude 判斷「意圖」再解析：
 *   - 新增（create）：一句話可含多個行程，各自解析成結構化欄位（含主角、相關人物、標籤、司機、重複），
 *     並附上「依過去紀錄帶入／假設／待確認」提示，回給前端逐筆帶入「新增行程」讓使用者確認。
 *   - 搜尋（search）：精煉關鍵字，回給前端導到搜尋頁。
 *   - 追問（followUp）：使用者用語音回答助理的問題，依表單現值更新「這一筆」。
 *
 * 只做「文字 → 意圖／欄位」解析，不直接寫資料庫——避免辨識/解析錯誤污染行事曆。
 * spec：docs/specs/語音新增-精準判斷與缺漏提醒.md、docs/specs/語音-多筆行程與追問.md
 */

export const runtime = "nodejs";

/** 一句話最多拆幾筆 */
const MAX_EVENTS = 5;

const bodySchema = z.object({
  transcript: z.string().trim().min(1).max(500),
  calendars: z
    .array(z.object({ id: z.string(), name: z.string() }))
    .min(1)
    .max(50),
  // 台北「現在」的基準時間，由前端提供以確保時區正確。
  nowWall: z.string().regex(WALL),
  nowHuman: z.string().min(1).max(60),
  /** 追問模式：transcript＝使用者的回答 */
  followUp: z
    .object({
      original: z.string().max(500),
      current: z.record(z.string(), z.unknown()),
      questions: z.array(z.string().max(300)).max(20),
    })
    .optional(),
});

export async function POST(req: Request) {
  // 1) 驗證登入
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登入" }, { status: 401 });
  }

  // 2) 驗證輸入
  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "輸入格式不正確" }, { status: 400 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "伺服器尚未設定 ANTHROPIC_API_KEY" },
      { status: 500 },
    );
  }

  // 3) 脈絡：人物、標籤、過去習慣（伺服器端查，RLS 只會給看得到的資料）
  const [ctRes, tagRes] = await Promise.all([
    supabase.from("contacts").select("id, name, role_label, is_family, is_self").order("name"),
    supabase.from("tags").select("name").order("name"),
  ]);
  const contacts: ContactRow[] = ctRes.data ?? [];
  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const tagNames = (tagRes.data ?? []).map((t) => t.name);
  let habits = "（無法讀取過去紀錄）";
  try {
    habits = await buildHabits(supabase, contactById);
  } catch (err) {
    console.error("[voice/parse-event] habits", err);
  }

  const userMessage = parsed.followUp
    ? buildFollowUpMessage({
        nowHuman: parsed.nowHuman,
        original: parsed.followUp.original,
        current: parsed.followUp.current,
        questions: parsed.followUp.questions,
        answer: parsed.transcript,
      })
    : buildUserMessage(parsed.nowHuman, parsed.transcript);

  // 4) 呼叫 Claude 解析（結構化輸出；婉拒時由伺服器端自動改用其他模型）
  const client = new Anthropic();
  let result: Output;
  try {
    const message = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 6000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // 語音要快：低 effort 對這種抽取任務已足夠
      output_config: { effort: "low", format: betaZodOutputFormat(outputSchema) },
      // 系統提示詞（人物＋習慣）短時間內不變，標記快取以降低連續使用的成本
      system: [
        {
          type: "text",
          text: buildSystemPrompt({ calendars: parsed.calendars, contacts, tagNames, habits }),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: userMessage }],
    });
    if (message.stop_reason === "refusal" || !message.parsed_output) {
      throw new Error(`無法解析（stop_reason=${message.stop_reason}）`);
    }
    result = message.parsed_output;
  } catch (err) {
    console.error("[voice/parse-event]", err);
    return NextResponse.json(
      { error: "解析失敗，請再說一次或改用手動新增" },
      { status: 502 },
    );
  }

  // 5a) 搜尋意圖（追問一律視為新增）：回精煉關鍵字，讓前端導到搜尋頁
  if (result.intent === "search" && !parsed.followUp) {
    return NextResponse.json({
      intent: "search",
      query: result.query?.trim() || parsed.transcript,
      note: "",
    });
  }

  // 5b) 新增意圖：逐筆收斂；追問只取第一筆
  const raw = parsed.followUp ? result.events.slice(0, 1) : result.events.slice(0, MAX_EVENTS);
  if (raw.length === 0) {
    return NextResponse.json(
      { error: "沒聽出要新增的行程，請再說一次" },
      { status: 422 },
    );
  }
  const events = raw.map((ev) =>
    normalizeEvent(ev, {
      calendars: parsed.calendars,
      contacts,
      contactById,
      isFollowUp: !!parsed.followUp,
    }),
  );
  return NextResponse.json({ intent: "create", events });
}

/** 一筆行程：不在清單的 id 丟掉、時間格式不對退回 null、標題加地點／主角後綴、規則式提醒 */
function normalizeEvent(
  ev: EventOutput,
  ctx: {
    calendars: { id: string; name: string }[];
    contacts: ContactRow[];
    contactById: Map<string, ContactRow>;
    /** 追問回答過了：「沒指定主角＝本人」不再重複提醒 */
    isFollowUp: boolean;
  },
) {
  const { calendars, contacts, contactById, isFollowUp } = ctx;
  const validCal = new Set(calendars.map((c) => c.id));
  const calendarId =
    ev.calendarId && validCal.has(ev.calendarId) ? ev.calendarId : calendars[0].id;
  const subjectIds = [...new Set(ev.subjectIds)].filter((id) => contactById.has(id));
  const participantIds = [...new Set(ev.participantIds)].filter(
    (id) => contactById.has(id) && !subjectIds.includes(id),
  );
  const startWall = ev.startWall && WALL.test(ev.startWall) ? ev.startWall : null;
  const endWall = ev.endWall && WALL.test(ev.endWall) ? ev.endWall : null;
  const location = ev.location?.trim() || null;
  const fromHabit = [...new Set(ev.fromHabit)];
  // 標題：有講地點加「(地點)」（習慣帶入的不加），非本人再加「-主角名」：美甲(延吉街)-豪哥
  const base = ev.title?.trim() || "（未命名行程）";
  const title = withSubjectSuffix(
    fromHabit.includes("location") ? base : withLocationSuffix(base, location),
    subjectIds
      .map((id) => contactById.get(id)!)
      .filter((c) => !c.is_self)
      .map((c) => c.name),
  );
  const weekdays = [...new Set(ev.weekdays)].filter((d) => d >= 0 && d <= 6);
  const recurrenceUntil =
    ev.recurrenceUntil && /^\d{4}-\d{2}-\d{2}$/.test(ev.recurrenceUntil)
      ? ev.recurrenceUntil
      : null;
  // 指定日期：只留格式正確、不等於開始日的日期；沒有其他日期就退回不重複
  const startDate = startWall?.slice(0, 10);
  const extraDates = [...new Set(ev.extraDates)]
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d !== startDate)
    .sort();
  const recurrence =
    ev.recurrence === "dates" && extraDates.length === 0 ? "none" : ev.recurrence;

  // 規則式提醒：不完全依賴模型，重要缺漏一定提醒
  const warnings = [...ev.questions.map((q) => q.trim()).filter(Boolean)];
  const addWarn = (text: string) => {
    if (!warnings.includes(text)) warnings.push(text);
  };
  if (!startWall || !endWall) addWarn("沒聽清楚時間，請確認日期與時間");
  if (!isFollowUp && subjectIds.length === 0 && contacts.some((c) => c.is_family)) {
    addWarn("沒有指定主角，會當成本人的行程；如果是小孩的活動，請選主角");
  }
  if (ev.needsDriver && !location) {
    addWarn("需要司機，但還沒有地點，司機會不知道要去哪裡");
  }
  if (/課|班|家教|老師|教練|練習/.test(base) && participantIds.length === 0) {
    addWarn("看起來是課程，但沒有選老師；選了老師才會自動帶入收費方案");
  }
  const unknownNames = [...new Set(ev.unknownNames.map((n) => n.trim()).filter(Boolean))];
  for (const n of unknownNames) {
    addWarn(`「${n}」不在人物清單，可在相關人物欄快速新增`);
  }

  return {
    calendarId,
    title,
    allDay: ev.allDay,
    startWall,
    endWall,
    location,
    isImportant: ev.isImportant,
    subjectIds,
    participantIds,
    tagNames: [...new Set(ev.tagNames.map((t) => t.trim()).filter(Boolean))].slice(0, 3),
    needsDriver: ev.needsDriver,
    recurrence,
    weekdays,
    recurrenceUntil,
    extraDates: recurrence === "dates" ? extraDates : [],
    fromHabit,
    assumptions: ev.assumptions.map((a) => a.trim()).filter(Boolean),
    warnings,
    confidence: ev.confidence,
    note: ev.note.trim(),
  };
}
