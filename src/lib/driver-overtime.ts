/**
 * 司機加班：固定班表、日別判斷、加班費（依分鐘實算＋勞基法級距）。
 * 純函式，司機端與 Peggy 端共用。
 * spec：docs/specs/司機打卡與加班費.md
 */

export interface ShiftDay {
  /** HH:mm */
  start: string;
  end: string;
  /** 午休說明（不保證準時，以工作做完為主，只顯示不計算） */
  rest: string;
}

/**
 * 約定班表（星期 0＝日 … 6＝六）。週一＝休息日、週日＝例假日。
 * 取自《司機薪資與加班費試算》；改班表目前要改這裡（第一版不做設定頁）。
 */
export const DRIVER_SHIFTS: Record<number, ShiftDay | null> = {
  0: null,
  1: null,
  2: { start: "07:30", end: "17:30", rest: "午休 2 小時" },
  3: { start: "07:30", end: "17:30", rest: "午休 2 小時" },
  4: { start: "07:30", end: "17:30", rest: "午休 2 小時" },
  5: { start: "07:30", end: "20:00", rest: "午休 4.5 小時" },
  6: { start: "09:30", end: "18:30", rest: "午休 1 小時" },
};

export const DEFAULT_DRIVER_SALARY = 50000;
/** 每月加班上限（勞基法 46 小時） */
export const MONTH_LIMIT_MINUTES = 46 * 60;

export type DayKind = "workday" | "restday" | "sunday" | "holiday";

export const DAY_KIND_LABEL: Record<DayKind, string> = {
  workday: "平日",
  restday: "休息日",
  sunday: "例假日",
  holiday: "國定假日",
};

/** yyyy-MM-dd → 星期幾（0＝日） */
export function weekdayOf(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay();
}

/**
 * 日別：國定假日（政府行事曆）優先，其次週日例假、週一休息日，其他平日。
 * 國定假日與例假日的算法待人資確認 → 費用不自動算（見 overtimeFees）。
 */
export function dayKind(dateStr: string, holidays: Map<string, string>): DayKind {
  if (holidays.has(dateStr)) return "holiday";
  const wd = weekdayOf(dateStr);
  if (wd === 0) return "sunday";
  if (wd === 1) return "restday";
  return "workday";
}

/** 級距（分鐘起點, 倍率）；最後一段延用到底 */
const TIERS: Record<"workday" | "restday", [number, number][]> = {
  // 平日：前 2 小時 ×1⅓、第 3 小時起 ×1⅔
  workday: [
    [0, 4 / 3],
    [120, 5 / 3],
  ],
  // 休息日：前 2 小時 ×1⅓、第 3–8 小時 ×1⅔、第 9 小時起 ×2⅔
  restday: [
    [0, 4 / 3],
    [120, 5 / 3],
    [480, 8 / 3],
  ],
};

/** HH:mm(:ss) → 當天第幾分鐘 */
export function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function minutesText(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h} 小時 ${m} 分`;
  if (h) return `${h} 小時`;
  return `${m} 分`;
}

/** 每分鐘工資＝月薪 ÷ 30 天 ÷ 8 小時 ÷ 60 分（煒喻提供的勞基法算法） */
export function perMinuteWage(salary: number): number {
  return salary / 30 / 8 / 60;
}

export interface OvertimeLike {
  id: string;
  work_date: string;
  start_time: string;
  end_time: string;
  status: "pending" | "approved" | "rejected";
}

export interface OvertimeCalc {
  minutes: number;
  kind: DayKind;
  /** null＝國定假日／例假日，待人工確認 */
  fee: number | null;
  /** 這筆各倍率的分鐘數（顯示明細用） */
  parts: { rate: number; minutes: number }[];
}

/**
 * 每筆加班的時數與費用。同一天多筆合併計算級距（依開始時間先後累計），
 * 退回的不算。每筆金額四捨五入到元。
 */
export function overtimeFees(
  rows: OvertimeLike[],
  salary: number,
  holidays: Map<string, string>,
): Map<string, OvertimeCalc> {
  const out = new Map<string, OvertimeCalc>();
  const perMin = perMinuteWage(salary);
  const byDay = new Map<string, OvertimeLike[]>();
  for (const r of rows) {
    if (r.status === "rejected") continue;
    byDay.set(r.work_date, [...(byDay.get(r.work_date) ?? []), r]);
  }
  for (const [date, list] of byDay) {
    const kind = dayKind(date, holidays);
    list.sort((a, b) => a.start_time.localeCompare(b.start_time));
    let used = 0;
    for (const r of list) {
      const minutes = Math.max(0, toMinutes(r.end_time) - toMinutes(r.start_time));
      if (kind === "holiday" || kind === "sunday") {
        out.set(r.id, { minutes, kind, fee: null, parts: [] });
        used += minutes;
        continue;
      }
      const tiers = TIERS[kind];
      const parts: { rate: number; minutes: number }[] = [];
      let left = minutes;
      let pos = used;
      while (left > 0) {
        const i = tiers.findLastIndex(([from]) => from <= pos);
        const next = tiers[i + 1]?.[0] ?? Infinity;
        const take = Math.min(left, next - pos);
        const rate = tiers[i][1];
        const last = parts[parts.length - 1];
        if (last && last.rate === rate) last.minutes += take;
        else parts.push({ rate, minutes: take });
        left -= take;
        pos += take;
      }
      used += minutes;
      const fee = Math.round(parts.reduce((s, p) => s + p.minutes * perMin * p.rate, 0));
      out.set(r.id, { minutes, kind, fee, parts });
    }
  }
  return out;
}

export function rateLabel(rate: number): string {
  if (Math.abs(rate - 4 / 3) < 1e-9) return "×1⅓";
  if (Math.abs(rate - 5 / 3) < 1e-9) return "×1⅔";
  if (Math.abs(rate - 8 / 3) < 1e-9) return "×2⅔";
  return `×${rate.toFixed(2)}`;
}

/** 同一天的加班分鐘（不含退回）——檢查一天總工時是否超過 12 小時 */
export function dayOvertimeMinutes(rows: OvertimeLike[], date: string): number {
  return rows
    .filter((r) => r.work_date === date && r.status !== "rejected")
    .reduce((s, r) => s + Math.max(0, toMinutes(r.end_time) - toMinutes(r.start_time)), 0);
}

/**
 * 這天的檢核提醒（不擋送出）：一天工時超過 12 小時；
 * 平日正常 8 小時＋加班超過 4 小時、休息日加班超過 12 小時。
 */
export function dayWarning(kind: DayKind, overtimeMin: number): string | null {
  if (kind === "workday" && overtimeMin > 240) return "當天正常 8 小時＋加班已超過 12 小時";
  if (kind === "restday" && overtimeMin > 720) return "休息日出勤已超過 12 小時";
  return null;
}

/** 兩筆時間有沒有重疊（同一天） */
export function overlaps(a: OvertimeLike, b: OvertimeLike): boolean {
  return (
    a.id !== b.id &&
    a.work_date === b.work_date &&
    a.status !== "rejected" &&
    b.status !== "rejected" &&
    a.start_time < b.end_time &&
    b.start_time < a.end_time
  );
}

/** HH:mm:ss → HH:mm */
export function hm(t: string): string {
  return t.slice(0, 5);
}
