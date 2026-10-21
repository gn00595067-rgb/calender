import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { MODEL } from "@/lib/voice/parse-event";
import { matchSubject, splitBodySchema, splitOutputSchema, splitSystemPrompt } from "@/lib/note-split";

/**
 * 學習回饋依小孩拆分：老師一次寫兩個小孩（Rick … Iris …）的回饋 → 拆成共同內容＋每個小孩一段。
 * 只回傳拆分結果，不寫資料庫；前端讓使用者確認（可改內容、改對應小孩）後才存。
 * spec：docs/specs/學習回饋-依小孩拆分與統整.md
 */

export const runtime = "nodejs";

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未登入" }, { status: 401 });

  let parsed: z.infer<typeof splitBodySchema>;
  try {
    parsed = splitBodySchema.parse(await req.json());
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
      output_config: { effort: "low", format: betaZodOutputFormat(splitOutputSchema) },
      system: splitSystemPrompt(parsed.subjects),
      messages: [{ role: "user", content: parsed.content }],
    });
    if (message.stop_reason === "refusal" || !message.parsed_output) {
      throw new Error(`無法拆分（stop_reason=${message.stop_reason}）`);
    }
    const out = message.parsed_output;
    const ids = new Set(parsed.subjects.map((s) => s.id));
    return NextResponse.json({
      shared: out.shared.trim(),
      children: out.children
        .filter((c) => c.content.trim())
        .map((c) => ({
          subjectId: ids.has(c.subjectId)
            ? c.subjectId
            : matchSubject(c.nameInText, parsed.subjects),
          nameInText: c.nameInText.trim(),
          content: c.content.trim(),
        })),
    });
  } catch (err) {
    console.error("[notes/split]", err);
    return NextResponse.json({ error: "自動拆分失敗，可改為整篇存" }, { status: 502 });
  }
}
