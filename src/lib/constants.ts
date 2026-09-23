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

/** 新增分類時可選的色盤（挑選色相分散、彼此好區別的 24 色） */
export const COLOR_PALETTE = [
  "#2563EB", // 藍
  "#0EA5E9", // 天藍
  "#0891B2", // 青
  "#0D9488", // 藍綠
  "#16A34A", // 綠
  "#65A30D", // 萊姆綠
  "#CA8A04", // 金黃
  "#EA580C", // 橘
  "#DC2626", // 紅
  "#E11D48", // 玫紅
  "#DB2777", // 桃紅
  "#C026D3", // 洋紅
  "#9333EA", // 紫
  "#7C3AED", // 藍紫
  "#4F46E5", // 靛藍
  "#059669", // 翡翠綠
  "#B45309", // 棕
  "#A16207", // 深黃棕
  "#BE123C", // 深玫紅
  "#0369A1", // 深藍
  "#15803D", // 深綠
  "#7E22CE", // 深紫
  "#475569", // 石板灰
  "#334155", // 深石板
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
  { value: "weekly", label: "每週（可指定星期）" },
  { value: "biweekly", label: "每兩週" },
  { value: "monthly", label: "每月" },
];

/**
 * 常用時長選項（分鐘）。新增行程時選「長度」即由開始時間自動推算結束時間，
 * 不必每次都手動選幾點幾分。
 */
export const DURATION_OPTIONS: { value: number; label: string }[] = [
  { value: 15, label: "15 分鐘" },
  { value: 30, label: "30 分鐘" },
  { value: 45, label: "45 分鐘" },
  { value: 60, label: "1 小時" },
  { value: 90, label: "1.5 小時" },
  { value: 120, label: "2 小時" },
  { value: 150, label: "2.5 小時" },
  { value: 180, label: "3 小時" },
  { value: 240, label: "4 小時" },
  { value: 300, label: "5 小時" },
  { value: 360, label: "6 小時" },
  { value: 480, label: "8 小時" },
];

/**
 * 星期籤（週一起）。value 為 JS `getDay()` 值（0=日..6=六），
 * 用於「每週」重複時指定要重複的星期（如每週二、四）。
 */
export const WEEKDAY_CHIPS: { value: number; label: string }[] = [
  { value: 1, label: "一" },
  { value: 2, label: "二" },
  { value: 3, label: "三" },
  { value: 4, label: "四" },
  { value: 5, label: "五" },
  { value: 6, label: "六" },
  { value: 0, label: "日" },
];

/** 財務方向 */
export type FinanceDirection = "expense" | "income";

export const FINANCE_DIRECTIONS: { value: FinanceDirection; label: string }[] = [
  { value: "expense", label: "支出" },
  { value: "income", label: "收入" },
];

/** 老師收費：計費方式 */
export type BillingMode = "fixed" | "hourly";

export const BILLING_MODES: { value: BillingMode; label: string; hint: string }[] = [
  { value: "fixed", label: "固定每堂", hint: "每堂固定金額" },
  { value: "hourly", label: "時薪 × 時數", hint: "依行程長度自動換算" },
];

/** 付款方式 */
export type PaymentMethod =
  | "monthly"
  | "per_time"
  | "prepaid_deduct"
  | "prepaid_term";

export const PAYMENT_METHODS: {
  value: PaymentMethod;
  label: string;
  hint: string;
  /** 該付款方式下，單堂財務的「已結清」預設值 */
  defaultSettled: boolean;
  /** 是否走預繳/預付儲值帳戶 */
  usesPrepaid: boolean;
}[] = [
  { value: "monthly", label: "月結", hint: "月底一次結清", defaultSettled: false, usesPrepaid: false },
  { value: "per_time", label: "每次（LINE Pay）", hint: "當次即付即結", defaultSettled: true, usesPrepaid: false },
  { value: "prepaid_deduct", label: "預繳累扣", hint: "先儲值、每堂扣抵", defaultSettled: true, usesPrepaid: true },
  { value: "prepaid_term", label: "預付一學期", hint: "學期初付清、每堂扣抵", defaultSettled: true, usesPrepaid: true },
];

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  monthly: "月結",
  per_time: "每次（LINE Pay）",
  prepaid_deduct: "預繳累扣",
  prepaid_term: "預付一學期",
};

/** 行程提醒：提前幾分鐘（null＝不提醒） */
export const REMINDER_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: "不提醒" },
  { value: 5, label: "5 分鐘前" },
  { value: 10, label: "10 分鐘前" },
  { value: 30, label: "30 分鐘前" },
  { value: 60, label: "1 小時前" },
  { value: 120, label: "2 小時前" },
  { value: 1440, label: "1 天前" },
];

/** 費用類別分群（統計時可分大人／小孩／通用） */
export const CATEGORY_GROUPS: { value: string; label: string }[] = [
  { value: "child", label: "小孩" },
  { value: "adult", label: "大人" },
  { value: "common", label: "通用" },
];

/** 重複行程展開上限：至結束日或 6 個月，取較早 */
export const RECURRENCE_MAX_MONTHS = 6;
