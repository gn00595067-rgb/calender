import { taipeiDateStartUtcISO } from "./date";

/**
 * 空檔／負荷計算（找空檔引擎）。
 *
 * 純函式、與 UI 無關，方便測試。時間一律以「台北牆上分鐘數」（0..1440，0=當日 00:00）
 * 表示；台灣無日光節約，故一天固定 1440 分，換算安全。
 */

/** 一段時間，單位為「當日分鐘數」（0..1440） */
export interface Segment {
  start: number;
  end: number;
}

/** 工作時段（可用來排事情的視窗），單位同 Segment */
export interface WorkWindow {
  start: number;
  end: number;
}

/** 只需要時間欄位即可計算的行程 */
interface TimedLike {
  starts_at: string;
  ends_at: string;
  all_day: boolean;
}

/** 工作時段預設：全天 / 08–22（早到晚）/ 09–18（上班） */
export const WINDOW_PRESETS = [
  { key: "full", label: "全天", start: 0, end: 1440 },
  { key: "day", label: "08–22", start: 8 * 60, end: 22 * 60 },
  { key: "office", label: "09–18", start: 9 * 60, end: 18 * 60 },
] as const;

export type WindowKey = (typeof WINDOW_PRESETS)[number]["key"];

export function windowFromKey(key: WindowKey): WorkWindow {
  const p = WINDOW_PRESETS.find((w) => w.key === key) ?? WINDOW_PRESETS[0];
  return { start: p.start, end: p.end };
}

/** 最小空檔門檻：小於此長度的零碎縫隙不視為「可用空檔」 */
export const MIN_GAP_PRESETS = [
  { key: "30", label: "≥30 分", minutes: 30 },
  { key: "60", label: "≥1 小時", minutes: 60 },
  { key: "120", label: "≥2 小時", minutes: 120 },
] as const;

export type MinGapKey = (typeof MIN_GAP_PRESETS)[number]["key"];

export function minutesFromGapKey(key: MinGapKey): number {
  return MIN_GAP_PRESETS.find((g) => g.key === key)?.minutes ?? 60;
}

const DAY_MINUTES = 24 * 60;

/**
 * 將一筆行程裁切到指定台北曆日，回傳其在該日的分鐘區段；
 * 全天行程或未落在該日者回傳 null。
 */
export function eventSegmentOnDay(e: TimedLike, dayStr: string): Segment | null {
  if (e.all_day) return null;
  const dayStartMs = new Date(taipeiDateStartUtcISO(dayStr)).getTime();
  const dayEndMs = dayStartMs + DAY_MINUTES * 60000;
  const s = new Date(e.starts_at).getTime();
  const en = new Date(e.ends_at).getTime();
  const segStart = Math.max(s, dayStartMs);
  const segEnd = Math.min(en, dayEndMs);
  if (segEnd <= segStart) return null;
  return {
    start: Math.round((segStart - dayStartMs) / 60000),
    end: Math.round((segEnd - dayStartMs) / 60000),
  };
}

/** 某日仍在進行的全天行程（不佔用時段，但代表當天並非真正空閒，需另外提示） */
export function allDayOnDay<T extends TimedLike>(events: T[], dayStr: string): T[] {
  const dayStartMs = new Date(taipeiDateStartUtcISO(dayStr)).getTime();
  const dayEndMs = dayStartMs + DAY_MINUTES * 60000;
  return events.filter(
    (e) =>
      e.all_day &&
      new Date(e.starts_at).getTime() < dayEndMs &&
      new Date(e.ends_at).getTime() > dayStartMs,
  );
}

/** 合併重疊／相接的區段（輸入不需預先排序） */
export function mergeSegments(segs: Segment[]): Segment[] {
  if (segs.length === 0) return [];
  const sorted = [...segs].sort((a, b) => a.start - b.start);
  const out: Segment[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    const cur = sorted[i];
    if (cur.start <= last.end) last.end = Math.max(last.end, cur.end);
    else out.push({ ...cur });
  }
  return out;
}

/** 某日在工作時段內的忙碌區塊（已合併、已裁切到視窗） */
export function busyOnDay(
  events: TimedLike[],
  dayStr: string,
  w: WorkWindow,
): Segment[] {
  const segs: Segment[] = [];
  for (const e of events) {
    const seg = eventSegmentOnDay(e, dayStr);
    if (!seg) continue;
    const start = Math.max(seg.start, w.start);
    const end = Math.min(seg.end, w.end);
    if (end > start) segs.push({ start, end });
  }
  return mergeSegments(segs);
}

/**
 * 某日工作時段內的空檔區段。
 * minGap＝0 時回傳所有縫隙（含極短）；>0 時只回長度達門檻者。
 */
export function freeOnDay(
  events: TimedLike[],
  dayStr: string,
  w: WorkWindow,
  minGap: number,
): Segment[] {
  const busy = busyOnDay(events, dayStr, w);
  const free: Segment[] = [];
  let cursor = w.start;
  for (const b of busy) {
    if (b.start - cursor >= minGap && b.start > cursor)
      free.push({ start: cursor, end: b.start });
    cursor = Math.max(cursor, b.end);
  }
  if (w.end - cursor >= minGap && w.end > cursor)
    free.push({ start: cursor, end: w.end });
  return free;
}

export interface DayAvailability {
  busy: Segment[];
  /** 達門檻的可用空檔 */
  free: Segment[];
  busyMin: number;
  /** 達門檻空檔的總分鐘數 */
  freeMin: number;
  /** 最長單一空檔（分鐘） */
  largestFree: number;
  windowMin: number;
  hasAllDay: boolean;
}

const sumLen = (segs: Segment[]) => segs.reduce((s, x) => s + (x.end - x.start), 0);

/** 某日的忙碌／空檔綜合統計 */
export function dayAvailability(
  events: TimedLike[],
  dayStr: string,
  w: WorkWindow,
  minGap: number,
): DayAvailability {
  const busy = busyOnDay(events, dayStr, w);
  const free = freeOnDay(events, dayStr, w, minGap);
  return {
    busy,
    free,
    busyMin: sumLen(busy),
    freeMin: sumLen(free),
    largestFree: free.reduce((m, f) => Math.max(m, f.end - f.start), 0),
    windowMin: Math.max(0, w.end - w.start),
    hasAllDay: events.some((e) => e.all_day),
  };
}

/** 一段跨日的可用空檔（供區間總覽列出「最長可用空檔」） */
export interface FreeBlock {
  dayStr: string;
  start: number;
  end: number;
  minutes: number;
}

/**
 * 跨整個區間彙總可用空檔。
 * @param days 台北曆日字串陣列（yyyy-MM-dd）
 * @param eventsByDay 以「起訖裁切到該日」為準，呼叫端傳入該日相關行程即可
 */
export function intervalAvailability(
  days: string[],
  eventsForDay: (dayStr: string) => TimedLike[],
  w: WorkWindow,
  minGap: number,
): {
  totalFreeMin: number;
  freeDayCount: number;
  blocks: FreeBlock[];
} {
  const blocks: FreeBlock[] = [];
  let totalFreeMin = 0;
  let freeDayCount = 0;
  for (const dayStr of days) {
    const free = freeOnDay(eventsForDay(dayStr), dayStr, w, minGap);
    if (free.length > 0) freeDayCount++;
    for (const f of free) {
      const minutes = f.end - f.start;
      totalFreeMin += minutes;
      blocks.push({ dayStr, start: f.start, end: f.end, minutes });
    }
  }
  blocks.sort((a, b) => b.minutes - a.minutes);
  return { totalFreeMin, freeDayCount, blocks };
}

/** 列出台北曆日字串（含頭尾），上限 400 天 */
export function enumerateDays(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  const cur = new Date(`${startDate}T12:00:00Z`);
  const end = new Date(`${endDate}T12:00:00Z`);
  for (let i = 0; i < 400 && cur <= end; i++) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/** 分鐘數 → HH:mm（24:00 表示當日終點） */
export function minToHHMM(min: number): string {
  const clamped = Math.max(0, Math.min(DAY_MINUTES, Math.round(min)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** 分鐘數 → 人性化長度，如「1 小時 30 分」「45 分」 */
export function humanMinutes(min: number): string {
  const total = Math.round(min);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h} 小時 ${m} 分`;
  if (h) return `${h} 小時`;
  return `${m} 分`;
}

/** 概略小時（供大區間顯示「約 Xh」） */
export function roughHours(min: number): string {
  return (Math.round((min / 60) * 10) / 10).toString();
}
