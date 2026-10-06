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
  withSubjectSuffix,
  type Output,
  type ContactRow,
} from "@/lib/voice/parse-event";

/**
 * 語音助理：把一句口語交給 Claude 判斷「意圖」再解析：
 *   - 新增（create）：結構化欄位（含主角、相關人物、標籤、司機、重複），
 *     並附上「依過去紀錄帶入／假設／待確認」提示，回給前端帶入「新增行程」讓使用者確認。
 *   - 搜尋（search）：精煉關鍵字，回給前端導到搜尋頁。
 *
 * 只做「文字 → 意圖／欄位」解析，不直接寫資料庫——避免辨識/解析錯誤污染行事曆。
 * spec：docs/specs/語音新增-精準判斷與缺漏提醒.md
 */

export const runtime = "nodejs";

const bodySchema = z.object({
  transcript: z.string().trim().min(1).max(500),
  calendars: z
    .array(z.object({ id: z.string(), name: z.string() }))
    .min(1)
    .max(50),
  // 台北「現在」的基準時間，由前端提供以確保時區正確。
  nowWall: z.string().regex(WALL),
  nowHuman: z.string().min(1).max(60),
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
    supabase.from("contacts").select("id, name, role_label, is_family").order("name"),
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

  // 4) 呼叫 Claude 解析（結構化輸出；婉拒時由伺服器端自動改用其他模型）
  const client = new Anthropic();
  let result: Output;
  try {
    const message = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 4000,
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
      messages: [
        { role: "user", content: buildUserMessage(parsed.nowHuman, parsed.transcript) },
      ],
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

  // 5a) 搜尋意圖：回精煉關鍵字，讓前端導到搜尋頁
  if (result.intent === "search") {
    return NextResponse.json({
      intent: "search",
      query: result.query?.trim() || parsed.transcript,
      note: result.note.trim(),
    });
  }

  // 5b) 新增意圖：逐欄收斂（不在清單的 id 丟掉、時間格式不對退回現在）
  const validCal = new Set(parsed.calendars.map((c) => c.id));
  const calendarId =
    result.calendarId && validCal.has(result.calendarId)
      ? result.calendarId
      : parsed.calendars[0].id;
  const subjectIds = [...new Set(result.subjectIds)].filter((id) => contactById.has(id));
  const participantIds = [...new Set(result.participantIds)].filter(
    (id) => contactById.has(id) && !subjectIds.includes(id),
  );
  const startWall = result.startWall && WALL.test(result.startWall) ? result.startWall : null;
  const endWall = result.endWall && WALL.test(result.endWall) ? result.endWall : null;
  // 非本人（有主角）的行程標題加主角名，月曆上一眼看出是誰的：打球-豪哥
  const title = withSubjectSuffix(
    result.title?.trim() || "（未命名行程）",
    subjectIds.map((id) => contactById.get(id)!.name),
  );
  const location = result.location?.trim() || null;
  const weekdays = [...new Set(result.weekdays)].filter((d) => d >= 0 && d <= 6);
  const recurrenceUntil =
    result.recurrenceUntil && /^\d{4}-\d{2}-\d{2}$/.test(result.recurrenceUntil)
      ? result.recurrenceUntil
      : null;

  // 6) 規則式提醒：不完全依賴模型，重要缺漏一定提醒
  const warnings = [...result.questions.map((q) => q.trim()).filter(Boolean)];
  const addWarn = (text: string) => {
    if (!warnings.includes(text)) warnings.push(text);
  };
  if (!startWall || !endWall) addWarn("沒聽清楚時間，請確認日期與時間");
  if (subjectIds.length === 0 && contacts.some((c) => c.is_family)) {
    addWarn("沒有指定主角，會當成本人的行程；如果是小孩的活動，請選主角");
  }
  if (result.needsDriver && !location) {
    addWarn("需要司機，但還沒有地點，司機會不知道要去哪裡");
  }
  if (/課|班|家教|老師|教練|練習/.test(title) && participantIds.length === 0) {
    addWarn("看起來是課程，但沒有選老師；選了老師才會自動帶入收費方案");
  }
  const unknownNames = [...new Set(result.unknownNames.map((n) => n.trim()).filter(Boolean))];
  for (const n of unknownNames) {
    addWarn(`「${n}」不在人物清單，可在相關人物欄快速新增`);
  }

  return NextResponse.json({
    intent: "create",
    calendarId,
    title,
    allDay: result.allDay,
    startWall,
    endWall,
    location,
    isImportant: result.isImportant,
    subjectIds,
    participantIds,
    tagNames: [...new Set(result.tagNames.map((t) => t.trim()).filter(Boolean))].slice(0, 3),
    needsDriver: result.needsDriver,
    recurrence: result.recurrence,
    weekdays,
    recurrenceUntil,
    fromHabit: [...new Set(result.fromHabit)],
    assumptions: result.assumptions.map((a) => a.trim()).filter(Boolean),
    warnings,
    confidence: result.confidence,
    note: result.note.trim(),
  });
}
