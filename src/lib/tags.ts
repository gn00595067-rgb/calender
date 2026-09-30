/**
 * 標籤正規化 — 防呆的單一真相源。
 *
 * 統計要準，「同一個標籤」就不能因為大小寫、全半形、空白不同而被算成好幾個。
 * `tagKey` 產生「比對用」的正規化鍵；顯示與儲存仍保留使用者輸入的原樣，
 * 只是判斷「是不是同一個」時一律用 key。
 *
 *   tagKey("LINE Pay") === tagKey("line pay") === tagKey("ｌｉｎｅpay")  // 同一個
 *   tagKey("數學")     !== tagKey("數學課")                              // 仍是不同的（語意不同）
 */
export function tagKey(name: string): string {
  return name
    .normalize("NFKC") // 全形→半形（數字、英文、標點）
    .replace(/\s+/g, "") // 去除所有空白（LINE Pay / linepay 視為同一）
    .toLowerCase();
}
