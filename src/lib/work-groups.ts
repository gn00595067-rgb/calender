/**
 * 家庭老師工作紀錄：大項／類別預設、時數計算、週報統計（純函式）。
 * 大項用 Phoenix 週報的 4 項（使用者 11/19 選定）。
 * spec：docs/specs/Elsa需求-多人權限與家庭老師報告.md
 */

export const WORK_GROUPS = ["老師的教學", "陪上課與試上觀察", "師資招募與行政", "生活物資採買"] as const;

/** 套用「週報 4 大項」時新增的類別（名稱、所屬大項、Excel 類別的其他寫法） */
export const WORK_PRESET: { name: string; group: string; aliases: string[] }[] = [
  { name: "社會複習", group: "老師的教學", aliases: [] },
  { name: "自然複習", group: "老師的教學", aliases: [] },
  { name: "國語複習", group: "老師的教學", aliases: [] },
  { name: "數學複習", group: "老師的教學", aliases: [] },
  { name: "每日作業", group: "老師的教學", aliases: ["作業/英文教學", "檢查作業"] },
  { name: "英文教學", group: "老師的教學", aliases: [] },
  { name: "專題與口語練習", group: "老師的教學", aliases: ["道具製作/口語", "專題輔導"] },
  { name: "阿姨國語教學", group: "老師的教學", aliases: [] },
  { name: "陪上課", group: "陪上課與試上觀察", aliases: ["外出/行政", "外出/陪上課"] },
  { name: "試上觀察", group: "陪上課與試上觀察", aliases: ["外出上課"] },
  { name: "面試與師資", group: "師資招募與行政", aliases: [] },
  { name: "回報進度", group: "師資招募與行政", aliases: [] },
  { name: "課表與行政", group: "師資招募與行政", aliases: ["行政/其他"] },
  { name: "採購", group: "生活物資採買", aliases: [] },
];

/** 「17:30」→ 分鐘 */
export function hmToMin(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** 起訖算工時（小時，兩位小數）；結束早於開始視為跨午夜 */
export function hoursBetween(start: string, end: string): number {
  let d = hmToMin(end) - hmToMin(start);
  if (d < 0) d += 24 * 60;
  return Math.round((d / 60) * 100) / 100;
}

/** 某日所在週的週一（yyyy-MM-dd） */
export function mondayOf(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
  return dt.toISOString().slice(0, 10);
}

export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export interface GroupStatLog {
  hours: number;
  category_id: string | null;
  content: string | null;
}
export interface GroupStatCategory {
  id: string;
  name: string;
  group_label: string | null;
}

export interface GroupStat {
  group: string;
  hours: number;
  rows: { name: string; hours: number; contents: string[] }[];
}

/** 週報表格：依大項 → 類別加總工時；沒分類的放「未分類」 */
export function groupStats(logs: GroupStatLog[], cats: GroupStatCategory[]): { groups: GroupStat[]; total: number } {
  const catById = new Map(cats.map((c) => [c.id, c]));
  const groups = new Map<string, Map<string, { hours: number; contents: string[] }>>();
  let total = 0;
  for (const l of logs) {
    const c = l.category_id ? catById.get(l.category_id) : undefined;
    const g = c ? c.group_label || "其他" : "未分類";
    const n = c ? c.name : "未分類";
    const rows = groups.get(g) ?? new Map();
    const r = rows.get(n) ?? { hours: 0, contents: [] };
    r.hours += l.hours;
    if (l.content?.trim()) r.contents.push(l.content.trim());
    rows.set(n, r);
    groups.set(g, rows);
    total += l.hours;
  }
  const order = (g: string) => {
    const i = (WORK_GROUPS as readonly string[]).indexOf(g);
    return i >= 0 ? i : g === "未分類" ? 99 : 50;
  };
  const out = [...groups.entries()]
    .map(([group, rows]) => ({
      group,
      hours: [...rows.values()].reduce((s, r) => s + r.hours, 0),
      rows: [...rows.entries()].map(([name, r]) => ({ name, ...r })).sort((a, b) => b.hours - a.hours),
    }))
    .sort((a, b) => order(a.group) - order(b.group));
  return { groups: out, total };
}

/** 佔比文字「12.8%」 */
export function pctText(part: number, total: number): string {
  return total > 0 ? `${((part / total) * 100).toFixed(1)}%` : "—";
}
