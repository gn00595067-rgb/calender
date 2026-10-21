import { z } from "zod";

/**
 * 英文課堂日誌翻成中文：AI 的輸入／輸出格式與提示詞。
 * spec：docs/specs/學習回饋-課程進度與英文翻譯.md
 */

export const translateBodySchema = z.object({
  content: z.string().trim().min(1).max(8000),
  /** 這堂課的小孩（翻譯時把英文名換成系統裡的名字） */
  subjects: z
    .array(
      z.object({
        name: z.string().max(60),
        aliases: z.array(z.string().max(40)).max(10).default([]),
      }),
    )
    .max(6)
    .default([]),
});

export const translateOutputSchema = z.object({
  progress: z
    .string()
    .describe("全班共同的課程進度（今天的技能、學了什麼、怎麼學），繁體中文；沒有就空字串"),
  feedback: z
    .string()
    .describe("每位學生的評語與評分，繁體中文，每人一段、段首「【名字】」；沒有就空字串"),
});

/** 文字大多是英文（拉丁字母遠多於中文字）→ 顯示「翻成中文」 */
export function looksEnglish(text: string): boolean {
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  const cjk = (text.match(/[一-鿿]/g) ?? []).length;
  return latin >= 40 && latin > cjk * 4;
}

export function translateSystemPrompt(
  subjects: z.infer<typeof translateBodySchema>["subjects"],
): string {
  const list = subjects.length
    ? subjects
        .map(
          (s) =>
            `- ${s.name}${s.aliases.length ? `（原文可能寫：${s.aliases.join("、")}）` : ""}`,
        )
        .join("\n")
    : "（未提供）";
  return `你負責把補習班／才藝課老師用英文寫給家長的課堂日誌，翻成給台灣家長看的繁體中文。

這堂課的小孩（系統裡的名字）：
${list}

規則：
1. 忠實翻譯，不增刪意思、不加評論；語氣自然、像老師寫給家長。
2. progress：全班共同的內容——今天練的技能（Today's skills）、學了什麼（What we learned）、怎麼學（How we learned）。
   用「今日技能：」「學習內容：」「上課方式：」開頭分行。
3. feedback：每位學生一段，段首寫「【名字】」，名字用上面系統裡的名字（原文的英文名對得上本名或別名就換掉；對不上就保留英文名）。
   評語翻成中文；評分保留數字，例如：
   技能：運用證據 8/10、權衡論點 8/10
   表現：主動參與 9/10、不干擾秩序 8/10
4. 課程名稱、日期時間、分校地址這些行程本身已有的資訊省略，不要翻。
5. 原文沒有分學生（只有共同內容）→ feedback 給空字串；沒有共同內容 → progress 給空字串。`;
}
