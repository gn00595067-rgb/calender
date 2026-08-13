import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { zhTW } from "date-fns/locale";
import { TIME_ZONE } from "./constants";

/**
 * 日期／時間工具。
 * 規則：一律以 UTC（timestamptz）儲存，以 Asia/Taipei + zh-TW 顯示。
 * datetime-local 輸入視為台北牆上時間，需以 fromZonedTime 轉回 UTC 再存。
 */

/** 以台北時區＋zh-TW 格式化 UTC 時間字串 */
export function fmt(utc: string | Date, pattern: string): string {
  return formatInTimeZone(utc, TIME_ZONE, pattern, { locale: zhTW });
}

/** 取得台北時區下的 Date（其欄位為台北牆上時間），供做本地計算 */
export function toTaipei(utc: string | Date): Date {
  return toZonedTime(utc, TIME_ZONE);
}

/** 將台北牆上時間（datetime-local 值，如 2026-08-13T19:00）轉為 UTC ISO 字串 */
export function taipeiWallToUtcISO(wall: string): string {
  return fromZonedTime(wall, TIME_ZONE).toISOString();
}

/** 將 UTC 時間轉為 datetime-local 需要的台北牆上時間字串 yyyy-MM-dd'T'HH:mm */
export function utcToTaipeiWall(utc: string | Date): string {
  return formatInTimeZone(utc, TIME_ZONE, "yyyy-MM-dd'T'HH:mm");
}

/** 將台北當地日期字串（yyyy-MM-dd）對應之當日 00:00 台北時間轉為 UTC ISO */
export function taipeiDateStartUtcISO(dateStr: string): string {
  return fromZonedTime(`${dateStr}T00:00:00`, TIME_ZONE).toISOString();
}

/** 將台北當地日期字串（yyyy-MM-dd）對應之次日 00:00 台北時間轉為 UTC ISO（區間上界，exclusive） */
export function taipeiDateEndExclusiveUtcISO(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const nextStr = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
  return fromZonedTime(`${nextStr}T00:00:00`, TIME_ZONE).toISOString();
}

/** 台北「今天」的日期字串 yyyy-MM-dd */
export function taipeiTodayStr(): string {
  return formatInTimeZone(new Date(), TIME_ZONE, "yyyy-MM-dd");
}

/** 常用顯示格式 */
export const D = {
  time: (utc: string | Date) => fmt(utc, "HH:mm"),
  date: (utc: string | Date) => fmt(utc, "yyyy/MM/dd"),
  dateShort: (utc: string | Date) => fmt(utc, "M/d"),
  weekday: (utc: string | Date) => fmt(utc, "EEE"),
  monthDay: (utc: string | Date) => fmt(utc, "M月d日"),
  full: (utc: string | Date) => fmt(utc, "yyyy/MM/dd(EEE) HH:mm"),
  monthYear: (utc: string | Date) => fmt(utc, "yyyy年M月"),
};

/** 台幣金額顯示（整數、千分位） */
export function twd(amount: number): string {
  return `NT$${Math.round(amount).toLocaleString("zh-TW")}`;
}
