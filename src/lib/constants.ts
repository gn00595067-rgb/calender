/**
 * 全站共用領域常數。
 * UI 文案一律繁體中文；時區固定 Asia/Taipei；貨幣固定 TWD。
 */

export const APP_NAME = "ExecCal";
export const APP_TAGLINE = "高階主管行事曆";
export const TIME_ZONE = "Asia/Taipei";
export const LOCALE = "zh-TW";
export const CURRENCY = "TWD";

/** 行事曆分類種類 */
export type CalendarKind = "self" | "child" | "work" | "private" | "other";

export const CALENDAR_KINDS: { value: CalendarKind; label: string }[] = [
  { value: "self", label: "本人" },
  { value: "child", label: "小孩" },
  { value: "work", label: "公事" },
  { value: "private", label: "私事" },
  { value: "other", label: "其他" },
];

export const CALENDAR_KIND_LABEL: Record<CalendarKind, string> = {
  self: "本人",
  child: "小孩",
  work: "公事",
  private: "私事",
  other: "其他",
};

/** 依 UX 設計原則第 2 條的預設色票 */
export const KIND_DEFAULT_COLOR: Record<CalendarKind, string> = {
  self: "#2563EB", // 藍
  child: "#16A34A", // 綠
  work: "#9333EA", // 紫
  private: "#EA580C", // 橘
  other: "#0891B2", // 青（其他）
};

/** 衝突警示色 */
export const CONFLICT_COLOR = "#DC2626";

/** 新增分類時可選的色盤 */
export const COLOR_PALETTE = [
  "#2563EB",
  "#16A34A",
  "#9333EA",
  "#EA580C",
  "#0891B2",
  "#DB2777",
  "#CA8A04",
  "#4F46E5",
  "#059669",
  "#DC2626",
  "#475569",
  "#0D9488",
];

/** 預設分類（首次登入時建立） */
export const DEFAULT_CALENDARS: {
  name: string;
  kind: CalendarKind;
  color: string;
  position: number;
}[] = [
  { name: "本人", kind: "self", color: KIND_DEFAULT_COLOR.self, position: 0 },
  { name: "小孩", kind: "child", color: KIND_DEFAULT_COLOR.child, position: 1 },
  { name: "公事", kind: "work", color: KIND_DEFAULT_COLOR.work, position: 2 },
  { name: "私事", kind: "private", color: KIND_DEFAULT_COLOR.private, position: 3 },
];

/** 分享角色 */
export type ShareRole = "editor" | "contributor" | "viewer";

export const SHARE_ROLES: { value: ShareRole; label: string; hint: string }[] = [
  { value: "editor", label: "編輯者", hint: "可新增／編輯行程、查看財務金額、填寫回饋" },
  { value: "contributor", label: "協作者", hint: "只能查看行程與填寫回饋，看不到金額" },
  { value: "viewer", label: "檢視者", hint: "僅能查看行程，不能回饋、看不到金額" },
];

export const SHARE_ROLE_LABEL: Record<ShareRole, string> = {
  editor: "編輯者",
  contributor: "協作者",
  viewer: "檢視者",
};

/** 有效角色（含擁有者），用於前端能力判斷 */
export type EffectiveRole = "owner" | ShareRole;

/** 重複規則 */
export type RecurrenceRule = "daily" | "weekly" | "biweekly" | "monthly";

export const RECURRENCE_OPTIONS: { value: RecurrenceRule | "none"; label: string }[] = [
  { value: "none", label: "不重複" },
  { value: "daily", label: "每天" },
  { value: "weekly", label: "每週" },
  { value: "biweekly", label: "每兩週" },
  { value: "monthly", label: "每月" },
];

/** 財務方向 */
export type FinanceDirection = "expense" | "income";

export const FINANCE_DIRECTIONS: { value: FinanceDirection; label: string }[] = [
  { value: "expense", label: "支出" },
  { value: "income", label: "收入" },
];

/** 重複行程展開上限：至結束日或 6 個月，取較早 */
export const RECURRENCE_MAX_MONTHS = 6;
