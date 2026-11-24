import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { MODEL } from "@/lib/voice/parse-event";

/**
 * 學習回饋 AI 總結（Peggy 11/24）：某位老師（科目）這個月給某些小孩的回饋 →
 * 進度判斷、表現好的、要加強的，並把「只是紀錄」和「要做的事（誰做）」分開。
 * 只回傳文字，不寫資料庫；內容只根據回饋原文。
 */
export const runtime = "nodejs";

const bodySchema = z.object({
  teacher: z.string().max(80),
  children: z.array(z.string().max(40)).min(1).max(6),
  entries: z
    .array(
      z.object({
        date: z.string().max(20),
        title: z.string().max(200),
        progress: z.string().max(1000).nullable(),
        child: z.string().max(40),
        content: z.string().max(4000),
      }),
    )
    .min(1)
    .max(80),
});

const outputSchema = z.object({
  progress: z.string().describe("進度：這個月上到哪裡、看起來是否照進度（看不出來就寫「回饋裡沒有提到進度」），1～2 句"),
  perChild: z
    .array(
      z.object({
        child: z.string().describe("小孩名字，照輸入"),
        strengths: z.string().describe("表現好的地方，1～2 句；沒有就空字串"),
        improve: z.string().describe("要加強的地方，1～2 句；沒有就空字串"),
      }),
    )
    .describe("每個小孩一筆"),
  todos: z
    .array(
      z.object({
        who: z.enum(["老師", "家長", "小孩", "家庭老師"]),
        item: z.string().describe("具體要做的事，一句"),
      }),
    )
    .describe("回饋裡明確提到要做的事（作業、補交、練習、聯絡、準備考試）；沒有就空陣列"),
});

const SYSTEM = `你在幫家長整理家教老師一個月的學習回饋。輸入是同一位老師這個月每堂課的回饋（可能有多個小孩）。
請整理成：進度判斷、每個小孩表現好的與要加強的、以及「要做的事」清單。
- 繁體中文，簡短具體，只根據回饋原文，不要編造沒寫的事，也不要給泛泛的建議。
- 「要做的事」只列回饋裡明確提到、需要有人去做的事（例如補交作業、加強練習某單元、家長要簽名），並標是誰要做；純描述上課情形的不要列。
- 看不出進度是否落後就照實說。`;

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未登入" }, { status: 401 });
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "輸入格式不正確" }, { status: 400 });
  }
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "伺服器尚未設定 ANTHROPIC_API_KEY" }, { status: 500 });

  const input =
    `老師：${body.teacher}\n小孩：${body.children.join("、")}\n\n` +
    body.entries
      .map((e) => `【${e.date} ${e.title}｜${e.child}】${e.progress ? `進度：${e.progress}\n` : ""}${e.content}`)
      .join("\n\n");
  try {
    const m = await new Anthropic().beta.messages.parse({
      model: MODEL,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(outputSchema) },
      system: SYSTEM,
      messages: [{ role: "user", content: input }],
    });
    if (m.stop_reason === "refusal" || !m.parsed_output) throw new Error(`stop_reason=${m.stop_reason}`);
    return NextResponse.json(m.parsed_output);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[learning summarize]", msg);
    return NextResponse.json(
      { error: /credit balance/i.test(msg) ? "AI 服務額度不足，請稍後再試" : "AI 總結失敗，請稍後再試" },
      { status: 502 },
    );
  }
}
