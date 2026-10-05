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
  /** 整堂總價（固定制＝每堂、時薪制＝每小時、月薪制＝每月） */
  rate: number;
  position: number;
  /** 適用小孩（主角 contact id）；空陣列＝不限，只依人數挑 */
  subject_ids: string[];
  /** 每次加收（如交通費）；0＝無 */
  extra_fee: number;
  /** 加收名稱，空＝「交通費」 */
  extra_label: string | null;
}

export const DEFAULT_EXTRA_LABEL = "交通費";

/** 加收名稱（未填用預設） */
export function extraLabel(plan: Pick<RatePlan, "extra_label">): string {
  return plan.extra_label?.trim() || DEFAULT_EXTRA_LABEL;
}

/** 依人數給的預設方案名稱：1 → 1對1、2 → 1對2 */
export function defaultPlanLabel(headcount: number): string {
  return `1對${headcount}`;
}

/** 兩組 id 是否相同（不計順序） */
function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

/** 依人數挑：人數完全相符 → 人數 ≥ 上課人數中最小的 → 第一個 */
function pickByHeadcount(sorted: RatePlan[], learners: number): RatePlan | null {
  if (sorted.length === 0) return null;
  const exact = sorted.find((p) => p.headcount === learners);
  if (exact) return exact;
  const bigger = sorted
    .filter((p) => p.headcount > learners)
    .sort((a, b) => a.headcount - b.headcount)[0];
  return bigger ?? sorted[0];
}

/**
 * 依這堂課的主角（上課的小孩）挑方案：
 * 1. 「適用小孩」與主角完全相同的方案（如鋼琴：妹妹 1000、哥哥 667）；
 * 2. 不限小孩的方案，依人數挑（1 位→1對1、2 位→1對2）；
 * 3. 都沒有不限小孩的方案時，退回所有方案依人數挑。
 */
export function pickPlan(plans: RatePlan[], subjectIds: string[]): RatePlan | null {
  if (plans.length === 0) return null;
  const sorted = [...plans].sort((a, b) => a.position - b.position);
  if (subjectIds.length > 0) {
    const forThem = sorted.find(
      (p) => p.subject_ids.length > 0 && sameSet(p.subject_ids, subjectIds),
    );
    if (forThem) return forThem;
  }
  const learners = Math.max(subjectIds.length, 1);
  const open = sorted.filter((p) => p.subject_ids.length === 0);
  return pickByHeadcount(open.length ? open : sorted, learners);
}

/** 月薪制：每堂不另計費，錢在月底記一筆月薪 */
export function isMonthlyPlan(plan: Pick<RatePlan, "billing_mode"> | null | undefined): boolean {
  return plan?.billing_mode === "monthly";
}

/** 方案本身的這堂金額（不含加收）：時薪制 × 時數、四捨五入；月薪制每堂為 0 */
export function planBaseAmount(plan: RatePlan, minutes: number): number {
  if (plan.billing_mode === "monthly") return 0;
  if (plan.billing_mode === "hourly") {
    return Math.round((plan.rate * Math.max(minutes, 0)) / 60);
  }
  return plan.rate;
}

/** 這一堂應付的總額＝方案金額＋每次加收（如交通費） */
export function planAmount(plan: RatePlan, minutes: number): number {
  return planBaseAmount(plan, minutes) + (plan.extra_fee || 0);
}

/** 方案摘要：「1對2 時薪 1,800」 */
export function planSummary(plan: Pick<RatePlan, "label" | "billing_mode" | "rate">): string {
  const rate = plan.rate.toLocaleString("zh-TW");
  if (plan.billing_mode === "monthly") return `${plan.label} 月薪 ${rate}`;
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
