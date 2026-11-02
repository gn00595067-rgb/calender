/**
 * 家教老師填報：選項、內容格式、時數計算、檢查與摘要（老師端、家長端共用）。
 * spec：docs/specs/家教老師填報.md
 */

export const SUBJECTS = ["數學", "國文", "社會", "自然", "英文 CET", "英文 FET", "其他"] as const;
export const LESSON_TYPES = ["新進度", "複習", "評量練習", "模擬考"] as const;
export const MODES = ["1 對 1", "1 對 2"] as const;
export const ERROR_TYPES = ["審題不清", "計算粗心", "單位換算", "概念混淆"] as const;
export const WORK_CATEGORIES = ["教學統籌", "行政跑腿", "外傭教學"] as const;
export const HOMEWORK_STATUS = ["已完成並檢查", "已完成未檢查", "未完成"] as const;
export const ENGLISH_ITEMS = ["單字", "課文", "My View", "文法", "練習卷"] as const;
export const PURCHASE_CATEGORIES = ["制服", "雜項", "課後才藝報名"] as const;
export const PURCHASE_STATUS = ["待處理", "已下單或已報名", "已完成"] as const;
export const PROJECT_STAGES = ["找資料中", "撰寫中", "完成"] as const;

export type TutorKind = "specialist" | "home";

/** 照片（存在 Storage 的路徑；section：lesson＝上課附件、parent＝給家長的話） */
export interface Photo {
  path: string;
  section: "lesson" | "parent";
}

export const SCHEDULE_RESPONSIBLE = ["數學老師", "國文老師", "家庭老師", "補習班", "家長"] as const;

/** 學生回饋（專科老師，每位學生一份） */
export interface StudentFeedback {
  id: string;
  absorption: number; // 0–100
  score: string; // 有測驗才填
  performance: string;
  errors: string[];
  errorNote: string;
  nextFocus: string;
}

/** 專科老師上課紀錄的內容 */
export interface LessonContent {
  lessonType: string;
  unit: string;
  focus: string;
  materials: string;
  method: string;
  students: StudentFeedback[];
  photos: Photo[];
}

export interface WorkSegment {
  start: string; // HH:mm
  end: string;
  category: string;
}

export interface SubjectReview {
  subject: string; // 社會／自然
  unit: string;
  method: string;
  absorption: Record<string, number>; // 學生 id → 0–100
  observation: string;
}

export interface EnglishReview {
  course: string; // CET／FET
  range: string;
  items: string[];
  hwDone: string; // 已完成／未完成／""
  mastery: Record<string, number>;
  note: string;
}

export interface SchoolContact {
  who: string;
  matter: string;
  needsParent: boolean;
}

export interface Purchase {
  category: string;
  item: string;
  amount: string;
  status: string;
}

/** 家庭老師每日回報的內容；沒填的區塊為空陣列／空字串 */
export interface DailyContent {
  segments: WorkSegment[];
  homework: { status: string; note: string; special: string } | null;
  reviews: SubjectReview[];
  english: EnglishReview[];
  /** progress＝階段；percent＝0–100（兩者擇一或都填） */
  project: { name: string; progress: string; percent?: number | null; due: string; next: string } | null;
  contacts: SchoolContact[];
  purchases: Purchase[];
  toParent: string;
  photos: Photo[];
}

export function emptyLesson(studentIds: string[]): LessonContent {
  return {
    lessonType: "",
    unit: "",
    focus: "",
    materials: "",
    method: "",
    students: studentIds.map(emptyFeedback),
    photos: [],
  };
}

export function emptyFeedback(id: string): StudentFeedback {
  return { id, absorption: 70, score: "", performance: "", errors: [], errorNote: "", nextFocus: "" };
}

export function emptyDaily(): DailyContent {
  return {
    segments: [{ start: "", end: "", category: "教學統籌" }],
    homework: null,
    reviews: [],
    english: [],
    project: null,
    contacts: [],
    purchases: [],
    toParent: "",
    photos: [],
  };
}

/** "HH:mm" → 分鐘；格式不對回 null */
export function toMin(hhmm: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? "");
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 起迄 → 分鐘數（迄早於起視為 0） */
export function spanMinutes(start: string | null | undefined, end: string | null | undefined): number {
  const s = toMin(start);
  const e = toMin(end);
  if (s == null || e == null || e <= s) return 0;
  return e - s;
}

/** 每日回報：依工作類別加總分鐘 */
export function dailyMinutes(segments: WorkSegment[]): { total: number; byCategory: Record<string, number> } {
  const byCategory: Record<string, number> = {};
  let total = 0;
  for (const seg of segments) {
    const m = spanMinutes(seg.start, seg.end);
    if (!m) continue;
    byCategory[seg.category] = (byCategory[seg.category] ?? 0) + m;
    total += m;
  }
  return { total, byCategory };
}

/** 分鐘 → 「1.5 小時」 */
export function hoursText(min: number): string {
  const h = Math.round((min / 60) * 100) / 100;
  return `${h} 小時`;
}

/** 上課紀錄送出前檢查；回傳第一個問題（null＝可送出） */
export function checkLesson(x: {
  subject: string;
  date: string;
  start: string;
  end: string;
  mode: string;
  studentIds: string[];
  content: LessonContent;
  studentName: (id: string) => string;
}): string | null {
  if (!x.subject) return "請選科目";
  if (!x.date) return "請選上課日期";
  if (!spanMinutes(x.start, x.end)) return "請填上課時間（結束要晚於開始）";
  if (!x.mode) return "請選上課型式";
  if (x.studentIds.length === 0) return "請勾選上課學生";
  if (!x.content.lessonType) return "請選課程類型";
  if (!x.content.unit.trim()) return "請填單元";
  if (!x.content.focus.trim()) return "請填教學重點";
  for (const f of x.content.students) {
    const n = x.studentName(f.id);
    if (!f.performance.trim()) return `請填${n}的表現說明`;
    if (!f.nextFocus.trim()) return `請填${n}的下次加強重點`;
  }
  return null;
}

/** 每日回報送出前檢查 */
export function checkDaily(date: string, c: DailyContent): string | null {
  if (!date) return "請選日期";
  const segs = c.segments.filter((s) => s.start || s.end);
  if (segs.length === 0) return "請至少填一段工作時段";
  for (const s of segs) {
    if (!spanMinutes(s.start, s.end)) return "工作時段的結束要晚於開始";
    if (!s.category) return "請選工作類別";
  }
  if (c.homework && !c.homework.status) return "學校作業請選完成狀態";
  for (const r of c.reviews) if (!r.subject || !r.unit.trim()) return "社會／自然請填科目與單元";
  for (const e of c.english) if (!e.course || !e.range.trim() || e.items.length === 0) return "英文請填課程、範圍與項目";
  if (c.project && (!c.project.name.trim() || (!c.project.progress.trim() && c.project.percent == null)))
    return "專題報告請填名稱與目前進度（階段或百分比）";
  for (const k of c.contacts) if (!k.who.trim() || !k.matter.trim()) return "學校老師聯繫請填對象與事由";
  for (const p of c.purchases) if (!p.category || !p.item.trim() || !p.status) return "採購報名請填類別、品項與狀態";
  return null;
}

/** 上課紀錄 → 行事曆那堂課的回饋摘要（家長在行事曆、學習回饋頁看得到） */
export function lessonNoteText(
  subject: string,
  c: LessonContent,
  studentName: (id: string) => string,
): string {
  const lines = [
    `【${subject}｜${c.lessonType}】${c.unit}`,
    `教學重點：${c.focus}`,
    c.materials && `教材：${c.materials}`,
    c.method && `教學方式：${c.method}`,
    ...c.students.map((f) => {
      const parts = [
        `${studentName(f.id)}：吸收 ${f.absorption}%`,
        f.score && `測驗 ${f.score} 分`,
        f.performance,
        f.errors.length || f.errorNote ? `錯誤：${[...f.errors, f.errorNote].filter(Boolean).join("、")}` : "",
        `下次加強：${f.nextFocus}`,
      ];
      return parts.filter(Boolean).join("；");
    }),
  ];
  return lines.filter(Boolean).join("\n");
}

/** 讀回 jsonb 時補齊欄位（舊資料或手動改過的資料也不會壞） */
export function asLesson(raw: unknown): LessonContent {
  const r = (raw ?? {}) as Partial<LessonContent>;
  return {
    lessonType: r.lessonType ?? "",
    unit: r.unit ?? "",
    focus: r.focus ?? "",
    materials: r.materials ?? "",
    method: r.method ?? "",
    students: (r.students ?? []).map((f) => ({ ...emptyFeedback(f.id), ...f })),
    photos: r.photos ?? [],
  };
}

export function asDaily(raw: unknown): DailyContent {
  const r = (raw ?? {}) as Partial<DailyContent>;
  return {
    segments: r.segments?.length ? r.segments : emptyDaily().segments,
    homework: r.homework ?? null,
    reviews: r.reviews ?? [],
    english: r.english ?? [],
    project: r.project ?? null,
    contacts: r.contacts ?? [],
    purchases: r.purchases ?? [],
    toParent: r.toParent ?? "",
    photos: r.photos ?? [],
  };
}

/** 專題進度顯示：「撰寫中・60%」 */
export function projectProgressText(p: { progress: string; percent?: number | null }): string {
  return [p.progress, p.percent != null ? `${p.percent}%` : ""].filter(Boolean).join("・");
}

/** 某天是星期幾的週一（yyyy-MM-dd） */
export function mondayOf(ds: string): string {
  const d = new Date(`${ds}T12:00:00Z`);
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);
}

export function addDays(ds: string, n: number): string {
  return new Date(Date.parse(`${ds}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}
