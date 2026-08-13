import "server-only";
import ICAL from "ical.js";
import { fromZonedTime } from "date-fns-tz";
import { TIME_ZONE } from "@/lib/constants";

export interface IcsAttendee {
  name: string | null;
  email: string | null;
}

export interface NormalizedEvent {
  uid: string;
  title: string;
  startIso: string; // UTC
  endIso: string; // UTC
  allDay: boolean;
  location: string | null;
  description: string | null;
  attendees: IcsAttendee[];
  categories: string[];
  recurring: boolean;
  recurrenceRule: "daily" | "weekly" | "biweekly" | "monthly" | null;
}

const MAX_EVENTS = 1500;
const MAX_ITER_PER_SERIES = 3000;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** ICAL.Time → UTC ISO；正確處理 UTC / TZID / floating(視為台北) / all-day */
function timeToUtcIso(t: ICAL.Time): string {
  if (t.isDate) {
    return fromZonedTime(
      `${t.year}-${pad(t.month)}-${pad(t.day)}T00:00:00`,
      TIME_ZONE,
    ).toISOString();
  }
  const tzid = t.zone && t.zone.tzid ? t.zone.tzid : null;
  if (!tzid || tzid === "floating") {
    // 無時區資訊 → 視為台北牆上時間
    return fromZonedTime(
      `${t.year}-${pad(t.month)}-${pad(t.day)}T${pad(t.hour)}:${pad(t.minute)}:${pad(t.second)}`,
      TIME_ZONE,
    ).toISOString();
  }
  return t.toJSDate().toISOString();
}

function mapRecurrence(
  ve: ICAL.Component,
): NormalizedEvent["recurrenceRule"] {
  const rrule = ve.getFirstPropertyValue("rrule") as ICAL.Recur | null;
  if (!rrule) return null;
  const freq = rrule.freq;
  const interval = rrule.interval || 1;
  if (freq === "DAILY") return "daily";
  if (freq === "WEEKLY") return interval >= 2 ? "biweekly" : "weekly";
  if (freq === "MONTHLY") return "monthly";
  return null;
}

function extractAttendees(ve: ICAL.Component): IcsAttendee[] {
  const out: IcsAttendee[] = [];
  const seen = new Set<string>();
  const add = (prop: ICAL.Property | null) => {
    if (!prop) return;
    const raw = String(prop.getFirstValue() ?? "");
    const email = raw.replace(/^mailto:/i, "").trim() || null;
    const name = (prop.getParameter("cn") as string | undefined)?.trim() || null;
    const key = (email ?? name ?? "").toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ name, email });
  };
  add(ve.getFirstProperty("organizer"));
  for (const p of ve.getAllProperties("attendee")) add(p);
  return out;
}

function extractCategories(ve: ICAL.Component): string[] {
  const out = new Set<string>();
  for (const p of ve.getAllProperties("categories")) {
    const vals = p.getValues();
    for (const v of vals) {
      const s = String(v).trim();
      if (s) out.add(s);
    }
  }
  return [...out];
}

/**
 * 解析 .ics 文字，回傳落在 [rangeStartIso, rangeEndIso) 內的行程（含重複行程展開）。
 */
export function parseIcs(
  text: string,
  rangeStartIso: string,
  rangeEndIso: string,
): { events: NormalizedEvent[]; truncated: boolean } {
  const jcal = ICAL.parse(text);
  const root = new ICAL.Component(jcal);

  // 註冊 VTIMEZONE，讓 TZID 時間可正確換算
  for (const vt of root.getAllSubcomponents("vtimezone")) {
    try {
      const tz = new ICAL.Timezone(vt);
      if (tz.tzid && !ICAL.TimezoneService.has(tz.tzid)) {
        ICAL.TimezoneService.register(tz);
      }
    } catch {
      /* 忽略無法解析的時區 */
    }
  }

  const rangeStart = new Date(rangeStartIso).getTime();
  const rangeEnd = new Date(rangeEndIso).getTime();
  const events: NormalizedEvent[] = [];
  let truncated = false;

  const vevents = root.getAllSubcomponents("vevent");
  for (const ve of vevents) {
    if (events.length >= MAX_EVENTS) {
      truncated = true;
      break;
    }
    let event: ICAL.Event;
    try {
      event = new ICAL.Event(ve);
    } catch {
      continue;
    }
    if (!event.startDate) continue;

    const uid = event.uid || `${event.summary}-${event.startDate.toString()}`;
    const title = (event.summary || "(未命名行程)").trim();
    const location = event.location?.trim() || null;
    const description = event.description?.trim() || null;
    const attendees = extractAttendees(ve);
    const categories = extractCategories(ve);
    const recurrenceRule = mapRecurrence(ve);

    const makeEvent = (
      s: ICAL.Time,
      e: ICAL.Time,
      recurring: boolean,
    ): NormalizedEvent => ({
      uid,
      title,
      startIso: timeToUtcIso(s),
      endIso: timeToUtcIso(e),
      allDay: s.isDate,
      location,
      description,
      attendees,
      categories,
      recurring,
      recurrenceRule,
    });

    if (event.isRecurring()) {
      const iter = event.iterator();
      let next: ICAL.Time | null;
      let count = 0;
      while ((next = iter.next()) && count < MAX_ITER_PER_SERIES) {
        count++;
        let occ;
        try {
          occ = event.getOccurrenceDetails(next);
        } catch {
          continue;
        }
        const startMs = occ.startDate.toJSDate().getTime();
        if (startMs >= rangeEnd) break;
        if (startMs < rangeStart) continue;
        events.push(makeEvent(occ.startDate, occ.endDate, true));
        if (events.length >= MAX_EVENTS) {
          truncated = true;
          break;
        }
      }
    } else {
      const startMs = event.startDate.toJSDate().getTime();
      const endMs = event.endDate
        ? event.endDate.toJSDate().getTime()
        : startMs;
      // 與區間有交集才納入
      if (endMs > rangeStart && startMs < rangeEnd) {
        events.push(makeEvent(event.startDate, event.endDate ?? event.startDate, false));
      }
    }
  }

  events.sort((a, b) => a.startIso.localeCompare(b.startIso));
  return { events, truncated };
}
