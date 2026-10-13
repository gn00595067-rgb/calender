/**
 * Phoenix 工作報告 Excel 的解析與分類比對（純函式，前端與驗證腳本共用）。
 * 格式：表頭列有「日期／工作內容／類別／開始時間／結束時間／工時」（欄位順序不限），
 * 之後每列一筆；週次標題列、空白列、沒有日期或時數的列會略過。
 * spec：docs/specs/工作紀錄匯入與效益.md
 */

export type Cell = string | number | boolean | Date | null | undefined;

export interface ParsedWorkRow {
  /** Excel 的第幾列（1 起算，給使用者對照） */
  line: number;
  workDate: string; // yyyy-MM-dd
  startTime: string | null; // HH:mm
  endTime: string | null;
  hours: number;
  content: string;
  categoryRaw: string;
}

export interface ParseResult {
  rows: ParsedWorkRow[];
  /** 有資料但無法使用的列（缺日期或時數） */
  skipped: { line: number; reason: string }[];
  sheetName: string;
}

export interface WorkCategoryLite {
  id: string;
  name: string;
  sub_label: string | null;
  aliases: string[];
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Excel 日期序號 → yyyy-MM-dd */
function serialToDate(n: number): string {
  const d = new Date(Math.round((n - 25569) * 86400000));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** 日期格：Date、序號或「2026/10/4」「10/4」字串 */
export function toDate(v: Cell, today: string): string | null {
  if (v instanceof Date && !isNaN(+v)) {
    if (v.getUTCFullYear() < 1950) return null; // 純時間被當成日期
    return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  }
  if (typeof v === "number" && v > 20000 && v < 80000) return serialToDate(v);
  if (typeof v === "string") {
    const s = v.trim();
    let m = s.match(/^(\d{4})[/.\-年](\d{1,2})[/.\-月](\d{1,2})/);
    if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
    m = s.match(/^(\d{1,2})[/.月](\d{1,2})日?$/);
    if (m) {
      // 沒寫年份：用今年；月份比今天晚超過 2 個月視為去年
      const [ty, tm] = today.split("-").map(Number);
      const y = +m[1] > tm + 2 ? ty - 1 : ty;
      return `${y}-${pad(+m[1])}-${pad(+m[2])}`;
    }
  }
  return null;
}

/** 時間格：Date（1899-12-30 起）、一天的小數、或「11:00」「1100」字串 */
export function toTime(v: Cell): string | null {
  if (v instanceof Date && !isNaN(+v)) return `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}`;
  if (typeof v === "number" && v >= 0 && v < 1) {
    const mins = Math.round(v * 1440);
    return `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;
  }
  if (typeof v === "string") {
    const m = v.trim().match(/^(\d{1,2})[:：]?(\d{2})$/);
    if (m && +m[1] < 24 && +m[2] < 60) return `${pad(+m[1])}:${pad(+m[2])}`;
  }
  return null;
}

function toNumber(v: Cell): number | null {
  if (typeof v === "number" && isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && isFinite(Number(v.trim()))) return Number(v.trim());
  return null;
}

function text(v: Cell): string {
  if (v == null) return "";
  if (v instanceof Date) return "";
  return String(v).trim();
}

const HEADERS = {
  date: ["日期"],
  content: ["工作內容", "內容", "項目"],
  category: ["類別", "分類", "大項"],
  start: ["開始"],
  end: ["結束"],
  hours: ["工時", "時數"],
} as const;

/** 找表頭列與各欄位置（前 20 列內） */
function findHeader(data: Cell[][]): { row: number; col: Record<keyof typeof HEADERS, number> } | null {
  for (let r = 0; r < Math.min(data.length, 20); r++) {
    const cells = data[r].map((c) => text(c).replace(/\s/g, ""));
    const find = (keys: readonly string[]) => cells.findIndex((c) => keys.some((k) => c.includes(k)));
    const col = {
      date: find(HEADERS.date),
      content: find(HEADERS.content),
      category: find(HEADERS.category),
      start: find(HEADERS.start),
      end: find(HEADERS.end),
      hours: find(HEADERS.hours),
    };
    if (col.date >= 0 && (col.content >= 0 || col.category >= 0)) return { row: r, col };
  }
  return null;
}

/** 一張工作表 → 工作紀錄；找不到表頭回 null */
export function parseWorkSheet(data: Cell[][], sheetName: string, today: string): ParseResult | null {
  const h = findHeader(data);
  if (!h) return null;
  const { col } = h;
  const get = (row: Cell[], i: number) => (i >= 0 ? row[i] : null);
  const rows: ParsedWorkRow[] = [];
  const skipped: ParseResult["skipped"] = [];
  for (let r = h.row + 1; r < data.length; r++) {
    const row = data[r] ?? [];
    const content = text(get(row, col.content));
    const categoryRaw = text(get(row, col.category));
    const startTime = toTime(get(row, col.start));
    const endTime = toTime(get(row, col.end));
    if (!content && !categoryRaw) continue; // 空白列或週次標題列
    const workDate = toDate(get(row, col.date), today);
    if (!workDate) {
      skipped.push({ line: r + 1, reason: "沒有日期" });
      continue;
    }
    let hours = toNumber(get(row, col.hours));
    if (hours == null && startTime && endTime) {
      const [sh, sm] = startTime.split(":").map(Number);
      const [eh, em] = endTime.split(":").map(Number);
      let mins = eh * 60 + em - (sh * 60 + sm);
      if (mins < 0) mins += 1440;
      hours = mins / 60;
    }
    if (hours == null || hours <= 0 || hours > 24) {
      skipped.push({ line: r + 1, reason: "沒有工時或開始／結束時間" });
      continue;
    }
    rows.push({
      line: r + 1,
      workDate,
      startTime,
      endTime,
      hours: Math.round(hours * 100) / 100,
      content,
      categoryRaw,
    });
  }
  return { rows, skipped, sheetName };
}

/** 從多張工作表中挑出第一張看得懂的 */
export function parseWorkbook(
  sheets: { sheet: string; data: Cell[][] }[],
  today: string,
): ParseResult | null {
  for (const s of sheets) {
    const r = parseWorkSheet(s.data, s.sheet, today);
    if (r && r.rows.length) return r;
  }
  return null;
}

/** 比對用：去空白、全形轉半形、去掉常見分隔符號 */
export function normKey(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[\s.．・、,，/／|]/g, "")
    .toLowerCase();
}

/**
 * Excel 的類別文字 → 工作分類 id。
 * 先比完整文字（大項／小項／別名），再比第一個詞（「行政/採購」取「行政」）。對不到回 null。
 */
export function matchCategory(raw: string, cats: WorkCategoryLite[]): string | null {
  const r = normKey(raw);
  if (!r) return null;
  const keysOf = (c: WorkCategoryLite) =>
    [c.name, c.sub_label ?? "", ...c.aliases].map(normKey).filter((k) => k.length > 0);
  for (const c of cats) if (keysOf(c).includes(r)) return c.id;
  const tokens = raw
    .normalize("NFKC")
    .split(/[\s/／、,，|]+/)
    .map(normKey)
    .filter((t) => t.length >= 2);
  for (const t of tokens) {
    for (const c of cats) {
      // 大項名稱拆開也算（「行政/其他」→ 行政、其他）
      const parts = [c.name, ...(c.sub_label ? [c.sub_label] : [])]
        .flatMap((x) => x.normalize("NFKC").split(/[\s/／、,，.．]+/))
        .map(normKey)
        .filter((p) => p.length >= 2);
      if (keysOf(c).includes(t) || parts.includes(t)) return c.id;
    }
  }
  return null;
}
