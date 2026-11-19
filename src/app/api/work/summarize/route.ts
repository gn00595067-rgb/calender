import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { MODEL } from "@/lib/voice/parse-event";
import { addDays, groupStats } from "@/lib/work-groups";

/**
 * 週報「執行內容與成效概述」：依當週工作紀錄，每個大項擬一段（老師看過可改）。
 * 只回傳文字，不寫資料庫。資料用登入者身分讀（家長或那位員工才讀得到）。
 * spec：docs/specs/Elsa需求-多人權限與家庭老師報告.md
 */
export const runtime = "nodejs";

const bodySchema = z.object({
  contactId: z.uuid(),
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const outputSchema = z.object({
  summaries: z
    .array(
      z.object({
        group: z.string().describe("大項名稱，照輸入原字"),
        text: z.string().describe("這個大項本週的執行內容與成效概述，繁體中文 1～3 句"),
      }),
    )
    .describe("每個大項一段"),
});

const SYSTEM = `你在幫家庭老師寫給家長的「本週工作執行與學習輔導成果報告」。
輸入是本週工作紀錄，依大項、類別分好，含時數與每筆做了什麼。
請為每個大項寫一段「執行內容與成效概述」：
- 繁體中文，1～3 句，具體寫出做了什麼（科目、單元、對象），有成果就寫成果。
- 只根據紀錄內容，不要編造沒有寫到的事，不要加評價形容詞堆砌。
- 小孩名字照紀錄寫法；「哥妹」指哥哥和妹妹。`;

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
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "伺服器尚未設定 ANTHROPIC_API_KEY" }, { status: 500 });
  }

  const [{ data: logs, error }, { data: cats }] = await Promise.all([
    supabase
      .from("work_logs")
      .select("hours, category_id, content")
      .eq("contact_id", body.contactId)
      .gte("work_date", body.weekStart)
      .lte("work_date", addDays(body.weekStart, 6)),
    supabase.rpc("my_work_categories", { p_contact: body.contactId }),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!logs?.length) return NextResponse.json({ error: "這週還沒有工作紀錄" }, { status: 400 });

  const { groups } = groupStats(
    logs.map((l) => ({ ...l, hours: Number(l.hours) })),
    cats ?? [],
  );
  const input = groups
    .map(
      (g) =>
        `【${g.group}】共 ${g.hours.toFixed(2)} 小時\n` +
        g.rows.map((r) => `- ${r.name}（${r.hours.toFixed(2)}h）：${r.contents.join("；")}`).join("\n"),
    )
    .join("\n\n");

  try {
    const message = await new Anthropic().beta.messages.parse({
      model: MODEL,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(outputSchema) },
      system: SYSTEM,
      messages: [{ role: "user", content: input }],
    });
    if (message.stop_reason === "refusal" || !message.parsed_output) {
      throw new Error(`無法產生（stop_reason=${message.stop_reason}）`);
    }
    const out: Record<string, string> = {};
    for (const s of message.parsed_output.summaries) out[s.group.trim()] = s.text.trim();
    return NextResponse.json({ summaries: out });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[work summarize]", msg);
    return NextResponse.json(
      { error: /credit balance/i.test(msg) ? "AI 服務額度不足，請先手動填寫" : "AI 擬稿失敗，請先手動填寫" },
      { status: 502 },
    );
  }
}
