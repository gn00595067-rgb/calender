/**
 * 老師收費方案（1對1／1對2…）的共用邏輯：挑方案、算金額、分攤。
 * 前後端共用，不可依賴瀏覽器或伺服器 API。
 * spec：docs/specs/課程收費方案-1對1與1對2.md
 */
import type { BillingMode } from "@/lib/constants";

export interface RatePlan {
  id: string;
  contact_id: string;
  label: string;
  /** 班型人數：1＝1對1、2＝1對2 */
  headcount: number;
  billing_mode: BillingMode;
  /** 整堂總價（固定制＝每堂、時薪制＝每小時） */
  rate: number;
  position: number;
}

/** 依人數給的預設方案名稱：1 → 1對1、2 → 1對2 */
export function defaultPlanLabel(headcount: number): string {
  return `1對${headcount}`;
}

/**
 * 依「上課的小孩人數」挑方案：
 * 1. 人數完全相符的第一個；2. 人數 ≥ 上課人數中最小的；3. 都沒有就取第一個。
 */
export function pickPlan(plans: RatePlan[], learners: number): RatePlan | null {
  if (plans.length === 0) return null;
  const sorted = [...plans].sort((a, b) => a.position - b.position);
  const exact = sorted.find((p) => p.headcount === learners);
  if (exact) return exact;
  const bigger = sorted
    .filter((p) => p.headcount > learners)
    .sort((a, b) => a.headcount - b.headcount)[0];
  return bigger ?? sorted[0];
}

/** 依方案算金額（時薪制 × 時數，四捨五入到元） */
export function planAmount(plan: RatePlan, minutes: number): number {
  if (plan.billing_mode === "hourly") {
    return Math.round((plan.rate * Math.max(minutes, 0)) / 60);
  }
  return plan.rate;
}

/** 方案摘要：「1對2 時薪 1,800」 */
export function planSummary(plan: Pick<RatePlan, "label" | "billing_mode" | "rate">): string {
  const rate = plan.rate.toLocaleString("zh-TW");
  return plan.billing_mode === "hourly"
    ? `${plan.label} 時薪 ${rate}`
    : `${plan.label} 每堂 ${rate}`;
}

/**
 * 把一筆金額平均分給 n 個人（餘數給前面的人），總和必等於原金額。
 * 例：1,801 分 2 人 → [901, 900]
 */
export function splitAmount(amount: number, n: number): number[] {
  const k = Math.max(1, Math.floor(n));
  const base = Math.floor(amount / k);
  const rem = amount - base * k;
  return Array.from({ length: k }, (_, i) => base + (i < rem ? 1 : 0));
}
