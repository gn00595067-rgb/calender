/**
 * 司機接送：由行程推出「去程／回程」各趟，並排成給司機看的純文字時間表。
 * spec：docs/specs/司機接送.md
 */
import { D } from "@/lib/date";

export type DriverTrip = "to" | "from" | "round";

export const DRIVER_TRIPS: { value: DriverTrip; label: string }[] = [
  { value: "round", label: "來回" },
  { value: "to", label: "只有去程" },
  { value: "from", label: "只有回程" },
];

/** 去程提早上車的選項（分鐘） */
export const DRIVER_PICKUP_OPTIONS = [0, 15, 30, 45, 60, 90];
export const DEFAULT_PICKUP_MINUTES = 30;
/** 上車地點空白時的預設稱呼 */
export const DEFAULT_PICKUP_PLACE = "家";

export interface DriverInfo {
  trip: DriverTrip;
  pickupMinutes: number;
  pickupLocation: string | null;
  note: string | null;
}

/** 行程原始列 → 司機資訊（沒勾需要司機、或 0009 前的庫為 null） */
export function driverFromRow(row: {
  needs_driver?: boolean;
  driver_trip?: DriverTrip | null;
  driver_pickup_minutes?: number | null;
  driver_pickup_location?: string | null;
  driver_note?: string | null;
}): DriverInfo | null {
  if (!row.needs_driver) return null;
  return {
    trip: row.driver_trip ?? "round",
    pickupMinutes: row.driver_pickup_minutes ?? DEFAULT_PICKUP_MINUTES,
    pickupLocation: row.driver_pickup_location ?? null,
    note: row.driver_note ?? null,
  };
}

/** 行程需要的最少欄位 */
export interface DriverEventLike {
  id: string;
  title: string;
  location: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  subjectNames: string[];
  driver: DriverInfo | null;
}

/** 一趟車 */
export interface DriverLeg {
  eventId: string;
  kind: "to" | "from";
  /** 上車時間（UTC ISO） */
  at: string;
  from: string;
  to: string;
  passengers: string;
  title: string;
  note: string | null;
  allDay: boolean;
}

/** 一筆行程拆成去程／回程（來回＝兩趟） */
export function driverLegs(e: DriverEventLike): DriverLeg[] {
  if (!e.driver) return [];
  const home = e.driver.pickupLocation?.trim() || DEFAULT_PICKUP_PLACE;
  const dest = e.location?.trim() || "（地點未填）";
  const base = {
    eventId: e.id,
    passengers: e.subjectNames.length ? e.subjectNames.join("、") : "本人",
    title: e.title,
    note: e.driver.note,
    allDay: e.all_day,
  };
  const legs: DriverLeg[] = [];
  if (e.driver.trip !== "from") {
    const at = new Date(
      new Date(e.starts_at).getTime() - (e.all_day ? 0 : e.driver.pickupMinutes) * 60000,
    ).toISOString();
    legs.push({ ...base, kind: "to", at, from: home, to: dest });
  }
  if (e.driver.trip !== "to") {
    legs.push({ ...base, kind: "from", at: e.ends_at, from: dest, to: home, note: null });
  }
  return legs;
}

/** 「10/6（一）」 */
export function dayLabel(iso: string): string {
  return `${D.dateShort(iso)}（${D.weekday(iso).replace("週", "")}）`;
}

/** 台北曆日 yyyy-MM-dd（分組用） */
function dayKey(iso: string): string {
  return new Date(iso).toLocaleString("sv-SE", { timeZone: "Asia/Taipei" }).slice(0, 10);
}

/** 各趟依上車時間排序後按日期分組 */
export function groupLegsByDay(legs: DriverLeg[]): { day: string; label: string; legs: DriverLeg[] }[] {
  const sorted = [...legs].sort((a, b) => a.at.localeCompare(b.at));
  const groups: { day: string; label: string; legs: DriverLeg[] }[] = [];
  for (const l of sorted) {
    const day = dayKey(l.at);
    let g = groups.at(-1);
    if (!g || g.day !== day) {
      g = { day, label: dayLabel(l.at), legs: [] };
      groups.push(g);
    }
    g.legs.push(l);
  }
  return groups;
}

/** 一趟的單行文字：「08:30 去程｜家 → 台北醫院｜小明｜回診｜備註」 */
export function legLine(l: DriverLeg, showTitle: boolean): string {
  const time = l.allDay ? "整日" : D.time(l.at);
  const parts = [
    `${time} ${l.kind === "to" ? "去程" : "回程"}`,
    `${l.from} → ${l.to}`,
    l.passengers,
  ];
  if (showTitle) parts.push(l.title);
  if (l.note) parts.push(`備註：${l.note}`);
  return parts.join("｜");
}

/** 整份給司機的純文字（貼 LINE 用） */
export function driverScheduleText(
  legs: DriverLeg[],
  rangeLabel: string,
  showTitle: boolean,
): string {
  const groups = groupLegsByDay(legs);
  if (groups.length === 0) return `【司機行程】${rangeLabel}\n\n這段期間沒有需要接送的行程。`;
  const body = groups
    .map((g) => [g.label, ...g.legs.map((l) => legLine(l, showTitle))].join("\n"))
    .join("\n\n");
  return `【司機行程】${rangeLabel}\n\n${body}`;
}
