import type { EffectiveRole } from "@/lib/constants";
import type { Tables } from "./database";

export type Calendar = Tables<"calendars">;
export type EventRow = Tables<"events">;
export type Contact = Tables<"contacts">;
export type Tag = Tables<"tags">;
export type FinanceRecord = Tables<"finance_records">;
export type EventNote = Tables<"event_notes">;
export type CalendarShare = Tables<"calendar_shares">;
export type Profile = Tables<"profiles">;

/** 使用者可存取的行事曆，附帶有效角色與是否為自己擁有 */
export interface AccessibleCalendar extends Calendar {
  effectiveRole: EffectiveRole;
  isOwned: boolean;
}

/** 行程完整檢視（含關聯），供視圖與詳情使用 */
export interface EventFull extends EventRow {
  contacts: Contact[];
  tags: Tag[];
  finance: FinanceRecord[];
  notesCount: number;
}
