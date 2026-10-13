import { addDays, addMonths, addWeeks } from "date-fns";
import { RECURRENCE_MAX_MONTHS } from "@/lib/constants";

export type RecurrenceKind = "none" | "daily" | "weekly" | "biweekly" | "monthly" | "dates";

/**
 * 產生重複日期（台北曆日字串），上限至 recurrenceUntil 或起始日 +6 個月。
 * 伺服器建立行程與前端衝突檢查共用，確保兩邊算出的日期一致。
 */
export function generateDates(
  startDate: string,
  rule: "daily" | "weekly" | "biweekly" | "monthly",
  until: string | null | undefined,
  weekdays?: number[] | null,
): string[] {
  const anchor = new Date(`${startDate}T12:00:00Z`);
  const hardCap = addMonths(anchor, RECURRENCE_MAX_MONTHS);
  const untilCap = until ? new Date(`${until}T12:00:00Z`) : null;
  const cap = untilCap && untilCap < hardCap ? untilCap : hardCap;

  // 每週 + 指定星期（如每週二、四）：逐日掃描，取符合星期者
  if (rule === "weekly" && weekdays && weekdays.length) {
    const set = new Set(weekdays);
    const out: string[] = [];
    let cur = anchor;
    for (let i = 0; i < 400 && cur <= cap; i++) {
      if (set.has(cur.getUTCDay())) out.push(cur.toISOString().slice(0, 10));
      cur = addDays(cur, 1);
    }
    return out;
  }

  const step = (d: Date): Date => {
    switch (rule) {
      case "daily":
        return addDays(d, 1);
      case "weekly":
        return addWeeks(d, 1);
      case "biweekly":
        return addWeeks(d, 2);
      case "monthly":
        return addMonths(d, 1);
    }
  };

  const out: string[] = [];
  let cur = anchor;
  // 安全上限，避免異常輸入產生過多列
  for (let i = 0; i < 400 && cur <= cap; i++) {
    out.push(cur.toISOString().slice(0, 10));
    cur = step(cur);
  }
  return out;
}

/** 一筆新行程會落在哪些日期（含開始日；不重複時只有開始日） */
export function occurrenceDates(args: {
  startDate: string;
  recurrence: RecurrenceKind;
  until?: string | null;
  weekdays?: number[] | null;
  dates?: string[] | null;
}): string[] {
  const { startDate, recurrence } = args;
  const out =
    recurrence === "none"
      ? [startDate]
      : recurrence === "dates"
        ? [...new Set([startDate, ...(args.dates ?? [])])].sort()
        : generateDates(startDate, recurrence, args.until, args.weekdays);
  return out.length ? out : [startDate];
}
