import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  startOfDay,
  endOfDay,
  eachDayOfInterval,
} from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { TIME_ZONE } from "./constants";

/** 週起始日：週日（符合台灣常見月曆 日一二三四五六） */
const WEEK_STARTS_ON = 0 as const;

export interface UtcRange {
  startIso: string;
  endIso: string;
}

/** 將某 UTC 時間轉為台北牆上時間的 Date（其本地欄位＝台北時間） */
export function zoned(utc: string | Date): Date {
  return toZonedTime(utc, TIME_ZONE);
}

/** 將台北牆上 Date 轉回 UTC ISO */
export function zonedToIso(z: Date): string {
  return fromZonedTime(z, TIME_ZONE).toISOString();
}

/** 月視圖：回傳整個網格（含前後補齊）的每日（台北）與 UTC 查詢區間 */
export function monthGrid(anchorUtc: Date): {
  days: Date[];
  monthStart: Date;
  range: UtcRange;
} {
  const a = zoned(anchorUtc);
  const mStart = startOfMonth(a);
  const gridStart = startOfWeek(mStart, { weekStartsOn: WEEK_STARTS_ON });
  const gridEnd = endOfWeek(endOfMonth(a), { weekStartsOn: WEEK_STARTS_ON });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  return {
    days,
    monthStart: mStart,
    range: { startIso: zonedToIso(gridStart), endIso: zonedToIso(endOfDay(gridEnd)) },
  };
}

/** 週視圖：回傳一週七天（台北）與 UTC 查詢區間 */
export function weekDays(anchorUtc: Date): { days: Date[]; range: UtcRange } {
  const a = zoned(anchorUtc);
  const start = startOfWeek(a, { weekStartsOn: WEEK_STARTS_ON });
  const end = endOfWeek(a, { weekStartsOn: WEEK_STARTS_ON });
  const days = eachDayOfInterval({ start, end });
  return { days, range: { startIso: zonedToIso(start), endIso: zonedToIso(endOfDay(end)) } };
}

/** 日視圖區間 */
export function dayRange(anchorUtc: Date): { day: Date; range: UtcRange } {
  const a = zoned(anchorUtc);
  return {
    day: startOfDay(a),
    range: { startIso: zonedToIso(startOfDay(a)), endIso: zonedToIso(endOfDay(a)) },
  };
}

/** 任意日期字串（台北 yyyy-MM-dd）→ 當天 UTC 區間 */
export function dayStrRange(dateStr: string): UtcRange {
  const start = fromZonedTime(`${dateStr}T00:00:00`, TIME_ZONE);
  const end = fromZonedTime(`${dateStr}T23:59:59.999`, TIME_ZONE);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

interface TimeSpan {
  id: string;
  starts_at: string;
  ends_at: string;
}

/** 兩事件是否時間重疊（以 UTC 瞬間比較） */
export function overlaps(a: TimeSpan, b: TimeSpan): boolean {
  return (
    new Date(a.starts_at) < new Date(b.ends_at) &&
    new Date(b.starts_at) < new Date(a.ends_at)
  );
}

/** 回傳與至少一筆其他行程時間重疊的行程 id 集合（衝突） */
export function conflictIds(events: TimeSpan[]): Set<string> {
  const sorted = [...events].sort(
    (a, b) => +new Date(a.starts_at) - +new Date(b.starts_at),
  );
  const conflict = new Set<string>();
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (new Date(sorted[j].starts_at) >= new Date(sorted[i].ends_at)) break;
      if (overlaps(sorted[i], sorted[j])) {
        conflict.add(sorted[i].id);
        conflict.add(sorted[j].id);
      }
    }
  }
  return conflict;
}

export interface PositionedEvent<T extends TimeSpan> {
  event: T;
  col: number;
  cols: number;
  /** 向右延展的欄數（吃掉右側沒被其他行程佔用的空欄，讓標題更好讀） */
  span: number;
}

/**
 * 時間軸並排佈局：將同一天內重疊的行程分配欄位。
 * 回傳每筆的欄位索引 col、該群組總欄數 cols，與可向右延展的 span。
 */
export function layoutDay<T extends TimeSpan>(events: T[]): PositionedEvent<T>[] {
  const sorted = [...events].sort(
    (a, b) =>
      +new Date(a.starts_at) - +new Date(b.starts_at) ||
      +new Date(b.ends_at) - +new Date(a.ends_at),
  );
  const result: PositionedEvent<T>[] = [];
  let cluster: T[] = [];
  let clusterEnd = 0;

  const flush = () => {
    if (cluster.length === 0) return;
    // 貪婪分欄
    const colEnds: number[] = [];
    const assign = new Map<string, number>();
    for (const ev of cluster) {
      const s = +new Date(ev.starts_at);
      let placed = -1;
      for (let c = 0; c < colEnds.length; c++) {
        if (colEnds[c] <= s) {
          placed = c;
          break;
        }
      }
      if (placed === -1) {
        placed = colEnds.length;
        colEnds.push(0);
      }
      colEnds[placed] = +new Date(ev.ends_at);
      assign.set(ev.id, placed);
    }
    const cols = colEnds.length;
    for (const ev of cluster) {
      const col = assign.get(ev.id) ?? 0;
      // 向右延展：吃掉右側每一欄中「與本行程時間不重疊」的空間，直到碰到會撞到的行程
      let span = 1;
      for (let c = col + 1; c < cols; c++) {
        const blocked = cluster.some(
          (o) => assign.get(o.id) === c && overlaps(o, ev),
        );
        if (blocked) break;
        span++;
      }
      result.push({ event: ev, col, cols, span });
    }
    cluster = [];
  };

  for (const ev of sorted) {
    const s = +new Date(ev.starts_at);
    if (cluster.length > 0 && s >= clusterEnd) {
      flush();
      clusterEnd = 0;
    }
    cluster.push(ev);
    clusterEnd = Math.max(clusterEnd, +new Date(ev.ends_at));
  }
  flush();
  return result;
}
