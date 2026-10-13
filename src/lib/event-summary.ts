/**
 * 一句話描述行程（人事時地），給「已新增」確認與新增紀錄清單用。
 * 例：11/3(二) 起每週二 20:00–21:00　Peggy姐 與 Phoenix　Phoenix談話（公司）
 * spec：docs/specs/新增確認與新增紀錄.md
 */

import type { CalEvent } from "@/lib/client/events";
import { utcToTaipeiWall } from "@/lib/date";

const WD = ["日", "一", "二", "三", "四", "五", "六"];

function dayLabel(ds: string): string {
  const d = new Date(`${ds}T12:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WD[d.getUTCDay()]})`;
}

function shortDate(ds: string): string {
  const d = new Date(`${ds}T12:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

export interface SummaryInput {
  title: string;
  /** 台北牆上時間 yyyy-MM-ddTHH:mm */
  startWall: string;
  endWall: string;
  allDay: boolean;
  recurrence: "none" | "daily" | "weekly" | "biweekly" | "monthly" | "dates";
  weekdays?: number[];
  until?: string | null;
  /** 全部發生日期（含開始日）；有給就用來顯示次數與最後一天 */
  dates?: string[];
  /** 主角名字；空＝本人 */
  subjects: string[];
  /** 本人名字（主角空時顯示） */
  selfName?: string | null;
  participants: string[];
  location?: string | null;
}

/** 時間部分：10/16(五) 14:00–15:00／11/3(二) 起每週二 20:00–21:00（到 1/31）／10/16(五) 起共 5 天 14:00–15:00 */
export function timePhrase(x: SummaryInput): string {
  const startDate = x.startWall.slice(0, 10);
  const endDate = x.endWall.slice(0, 10);
  const time = x.allDay
    ? "整天"
    : `${x.startWall.slice(11)}–${endDate !== startDate ? `${shortDate(endDate)} ` : ""}${x.endWall.slice(11)}`;
  const dates = x.dates ?? [];
  const last = dates.length > 1 ? dates[dates.length - 1] : null;
  const untilText = last ? `（共 ${dates.length} 次，到 ${shortDate(last)}）` : x.until ? `（到 ${shortDate(x.until)}）` : "";
  switch (x.recurrence) {
    case "none":
      return `${dayLabel(startDate)} ${time}`;
    case "daily":
      return `${dayLabel(startDate)} 起每天 ${time}${untilText}`;
    case "weekly": {
      const wds = x.weekdays?.length ? x.weekdays : [new Date(`${startDate}T12:00:00Z`).getUTCDay()];
      return `${dayLabel(startDate)} 起每週${wds.map((d) => WD[d]).join("、")} ${time}${untilText}`;
    }
    case "biweekly":
      return `${dayLabel(startDate)} 起每兩週 ${time}${untilText}`;
    case "monthly":
      return `${dayLabel(startDate)} 起每月 ${time}${untilText}`;
    case "dates": {
      const all = dates.length ? dates : [startDate];
      const list = all.length <= 5 ? all.map(shortDate).join("、") : `${all.slice(0, 4).map(shortDate).join("、")}…共 ${all.length} 天`;
      return `${list} ${time}`;
    }
  }
}

/** 人部分：「哥哥 與 Jack」；沒主角＝本人 */
export function peoplePhrase(x: Pick<SummaryInput, "subjects" | "selfName" | "participants">): string {
  const who = x.subjects.length ? x.subjects.join("、") : (x.selfName ?? "");
  const withText = x.participants.length ? `與 ${x.participants.join("、")}` : "";
  return [who, withText].filter(Boolean).join(" ");
}

/** 完整一句：時　人　事（地） */
export function eventSentence(x: SummaryInput): string {
  const loc = x.location?.trim();
  const what = loc && !x.title.includes(loc) ? `${x.title}（${loc}）` : x.title;
  return [timePhrase(x), peoplePhrase(x), what].filter(Boolean).join("　");
}

/** 既有行程（同系列的多筆，依時間排序）→ 一句話的輸入 */
export function summaryFromEvents(all: CalEvent[], selfName: string | null): SummaryInput {
  const e = all[0];
  const dates = all.map((x) => utcToTaipeiWall(x.starts_at).slice(0, 10));
  const rule = e.recurrence_rule as SummaryInput["recurrence"] | null;
  return {
    title: e.title,
    startWall: utcToTaipeiWall(e.starts_at),
    endWall: utcToTaipeiWall(e.ends_at),
    allDay: e.all_day,
    recurrence: all.length > 1 ? (rule ?? "dates") : "none",
    weekdays: [...new Set(dates.map((ds) => new Date(`${ds}T12:00:00Z`).getUTCDay()))].sort(),
    dates,
    subjects: e.subjectNames,
    selfName,
    participants: e.participantNames,
    location: e.location,
  };
}
