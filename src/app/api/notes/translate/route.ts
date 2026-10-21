import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { MODEL } from "@/lib/voice/parse-event";
import { translateBodySchema, translateOutputSchema, translateSystemPrompt } from "@/lib/note-translate";

/**
 * 英文課堂日誌（例如辯論課 LINE 傳的原文）→ 繁體中文的「課程進度」＋「每位學生的回饋」。
 * 只回傳翻譯結果，不寫資料庫；前端帶入輸入框讓使用者看過再送出。
 * spec：docs/specs/學習回饋-課程進度與英文翻譯.md
 */

export const runtime = "nodejs";

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未登入" }, { status: 401 });

  let parsed: z.infer<typeof translateBodySchema>;
  try {
    parsed = translateBodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "輸入格式不正確" }, { status: 400 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "伺服器尚未設定 ANTHROPIC_API_KEY" }, { status: 500 });
  }

  const client = new Anthropic();
  try {
    const message = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(translateOutputSchema) },
      system: translateSystemPrompt(parsed.subjects),
      messages: [{ role: "user", content: parsed.content }],
    });
    if (message.stop_reason === "refusal" || !message.parsed_output) {
      throw new Error(`無法翻譯（stop_reason=${message.stop_reason}）`);
    }
    const out = message.parsed_output;
    return NextResponse.json({ progress: out.progress.trim(), feedback: out.feedback.trim() });
  } catch (err) {
    console.error("[notes/translate]", err);
    return NextResponse.json({ error: "翻譯失敗，請稍後再試" }, { status: 502 });
  }
}
