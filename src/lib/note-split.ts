import { z } from "zod";

/**
 * 學習回饋依小孩拆分：AI 的輸入／輸出格式與提示詞（route 與測試腳本共用）。
 * spec：docs/specs/學習回饋-依小孩拆分與統整.md
 */

export const splitBodySchema = z.object({
  content: z.string().trim().min(1).max(4000),
  subjects: z
    .array(
      z.object({
        id: z.uuid(),
        name: z.string().max(60),
        aliases: z.array(z.string().max(40)).max(10).default([]),
      }),
    )
    .min(2)
    .max(6),
});

export const splitOutputSchema = z.object({
  shared: z
    .string()
    .describe("適用所有小孩的共同內容（標題、教學概念、作業等），原文照抄；沒有就空字串"),
  children: z.array(
    z.object({
      subjectId: z
        .string()
        .describe("這段屬於哪個小孩：填候選小孩的 id；無法確定是誰就填空字串"),
      nameInText: z.string().describe("原文中稱呼這個小孩的名字，例如 Rick、哥哥"),
      content: z.string().describe("只屬於這個小孩的段落，原文照抄（含小標題）"),
    }),
  ),
});

export function splitSystemPrompt(subjects: z.infer<typeof splitBodySchema>["subjects"]): string {
  const list = subjects
    .map(
      (s) =>
        `- id=${s.id}：${s.name}${s.aliases.length ? `（別名：${s.aliases.join("、")}）` : "（未設別名）"}`,
    )
    .join("\n");
  return `你負責把家教老師寫給家長的「一堂課多個小孩」學習回饋，拆成每個小孩各自的段落。

這堂課的小孩（候選）：
${list}

規則：
1. 原文逐字照抄，不改寫、不摘要、不補字；只做切分。每個字都要出現在 shared 或某個小孩的 content 裡。
2. 標題、日期、教學概念、作業等對所有小孩都適用的內容放 shared。
3. 每個小孩一段：包含提到他的小標題（如「Rick 教學回饋」）與其後的內容。
4. subjectId：原文名字對得上候選的本名或別名就填那個 id（大小寫不分；簡稱也算，例如「哥」＝哥哥、「妹」＝妹妹）；對不上（例如英文名但沒設別名）填空字串，由家長自己選。
   不要用猜的——兩個英文名都沒設別名時，兩段都填空字串。
5. 原文根本沒有分小孩（整篇講共同內容）→ children 給空陣列，全文放 shared。`;
}

/** 稱呼比對用：去空白、轉小寫 */
const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

/**
 * AI 沒填 subjectId 時，用原文稱呼比對本名／別名再補一次（AI 偶爾漏對已設好的別名）。
 * 簡稱：「哥」對「哥哥」、「妹」對「妹妹」這種疊字本名的單字。
 */
export function matchSubject(
  nameInText: string,
  subjects: z.infer<typeof splitBodySchema>["subjects"],
): string | null {
  const n = norm(nameInText);
  if (!n) return null;
  const hits = subjects.filter((s) => {
    const names = [s.name, ...s.aliases].map(norm).filter(Boolean);
    return names.some((x) => x === n || (x.length === 2 && x[0] === x[1] && x[0] === n));
  });
  return hits.length === 1 ? hits[0].id : null;
}
