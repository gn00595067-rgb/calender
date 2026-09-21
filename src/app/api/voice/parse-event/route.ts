import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * 語音新增行程：把一句口語（如「明天下午三點跟客戶開會兩小時」）用 Claude Haiku
 * 解析成結構化欄位，回給前端帶入「新增行程」對話框讓使用者確認後再送出。
 *
 * 只做「文字 → 欄位」解析，不直接寫資料庫——避免辨識/解析錯誤污染行事曆。
 */

export const runtime = "nodejs";

const bodySchema = z.object({
  transcript: z.string().trim().min(1).max(500),
  calendars: z
    .array(z.object({ id: z.string(), name: z.string() }))
    .min(1)
    .max(50),
  // 台北「現在」的基準時間，由前端提供以確保時區正確。
  nowWall: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  nowHuman: z.string().min(1).max(60),
});

// Claude 回傳的形狀
const parsedSchema = z.object({
  calendarId: z.string().nullable(),
  title: z.string(),
  allDay: z.boolean(),
  startWall: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  endWall: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  location: z.string().nullable(),
  isImportant: z.boolean(),
  confidence: z.number().min(0).max(1),
  note: z.string(),
});

function buildSystemPrompt(nowHuman: string, calendars: { id: string; name: string }[]) {
  const calList = calendars.map((c) => `- id="${c.id}" 名稱="${c.name}"`).join("\n");
  return `你是行事曆助理，負責把使用者口述的一句話，解析成「新增行程」需要的結構化欄位。

現在時間（台北）：${nowHuman}

可用的行事曆分類（務必從中挑一個最合適的 id；真的無法判斷才回 null）：
${calList}

規則：
- 一律以台北時間思考與輸出。
- 時間格式一律用 24 小時制的「YYYY-MM-DDTHH:mm」。
- 相對日期（今天/明天/後天/下週三…）要依「現在時間」換算成實際日期，注意星期不要算錯。
- 若使用者沒講持續時間，預設為 1 小時。
- 若使用者沒講任何具體時間、只有日期（如「下週一繳費」），視為整日行程：allDay=true，startWall 用當天的 00:00、endWall 用當天的 23:59。
- 若時間只講到時（如「三點」）沒講上下午，依常識判斷（多為下午/晚上的活動）。
- title 用簡潔的行程標題，不要包含時間、地點字眼（那些放到對應欄位）。
- location：有講地點才填，否則 null。
- isImportant：使用者明確強調很重要/一定要/別忘了時才 true，否則 false。
- confidence：你對這次解析的把握（0~1）。
- note：若有模糊或你做了假設，用一句中文說明；否則空字串。

只輸出一個 JSON 物件，不要有任何其他文字或 markdown 圍欄。JSON 形狀：
{"calendarId": string|null, "title": string, "allDay": boolean, "startWall": "YYYY-MM-DDTHH:mm", "endWall": "YYYY-MM-DDTHH:mm", "location": string|null, "isImportant": boolean, "confidence": number, "note": string}`;
}

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("模型未回傳 JSON");
  }
  return JSON.parse(text.slice(start, end + 1));
}

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

  // 3) 呼叫 Claude Haiku 解析
  const client = new Anthropic();
  let result: z.infer<typeof parsedSchema>;
  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 500,
      system: buildSystemPrompt(parsed.nowHuman, parsed.calendars),
      messages: [{ role: "user", content: parsed.transcript }],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("模型未回傳文字");
    }
    result = parsedSchema.parse(extractJson(textBlock.text));
  } catch (err) {
    console.error("[voice/parse-event]", err);
    return NextResponse.json(
      { error: "解析失敗，請再說一次或改用手動新增" },
      { status: 502 },
    );
  }

  // 4) 收斂 calendarId：若模型給的 id 不在清單內，就退回第一個分類
  const validIds = new Set(parsed.calendars.map((c) => c.id));
  const calendarId =
    result.calendarId && validIds.has(result.calendarId)
      ? result.calendarId
      : parsed.calendars[0].id;

  return NextResponse.json({
    calendarId,
    title: result.title.trim() || "（未命名行程）",
    allDay: result.allDay,
    startWall: result.startWall,
    endWall: result.endWall,
    location: result.location?.trim() || null,
    isImportant: result.isImportant,
    confidence: result.confidence,
    note: result.note.trim(),
  });
}
