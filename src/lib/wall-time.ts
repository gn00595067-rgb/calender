/**
 * 「牆上時間」字串（`yyyy-MM-ddTHH:mm`，不帶時區）的純函式運算。
 *
 * 用 UTC 為基底做加減，避免瀏覽器本地時區／DST 造成日期漂移——這裡的
 * Date 只是承載欄位的容器，不代表真正的 UTC 瞬間。
 */

export interface WallParts {
  date: string; // yyyy-MM-dd
  h: number; // 0..23
  m: number; // 0..59
}

export function parseWall(wall: string): WallParts {
  const [date, time] = wall.split("T");
  const [h, m] = (time ?? "00:00").split(":").map(Number);
  return { date, h: h || 0, m: m || 0 };
}

export function makeWall(date: string, h: number, m: number): string {
  return `${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function wallToDate(wall: string): Date {
  const { date, h, m } = parseWall(wall);
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, (mo || 1) - 1, d || 1, h, m));
}

function dateToWall(dt: Date): string {
  const y = dt.getUTCFullYear();
  const mo = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  const h = String(dt.getUTCHours()).padStart(2, "0");
  const mi = String(dt.getUTCMinutes()).padStart(2, "0");
  return `${y}-${mo}-${d}T${h}:${mi}`;
}

/** 兩個牆上時間相差的分鐘數（end − start，可為負） */
export function diffMinutes(startWall: string, endWall: string): number {
  return Math.round(
    (wallToDate(endWall).getTime() - wallToDate(startWall).getTime()) / 60000,
  );
}

/** 牆上時間加上分鐘數（正確跨日／跨月） */
export function addMinutesToWall(wall: string, mins: number): string {
  return dateToWall(new Date(wallToDate(wall).getTime() + mins * 60000));
}

/** 牆上時間對應的星期（0=日..6=六） */
export function wallWeekday(wall: string): number {
  return wallToDate(wall).getUTCDay();
}
