/**
 * 家長端報表：時數統計、各科進度、吸收程度趨勢、待辦提醒（純計算）。
 * spec：docs/specs/家教老師填報.md §六
 */
import { asDaily, asLesson, projectProgressText } from "@/lib/tutor";
import type { TutorReport } from "@/lib/client/tutor";

export interface HoursRow {
  teacherId: string;
  teacherName: string;
  kind: "lesson" | "daily";
  count: number;
  minutes: number;
  /** 每日回報：依工作類別 */
  byCategory: Record<string, number>;
  /** 上課紀錄：依科目 */
  bySubject: Record<string, number>;
}

export function hoursByTeacher(reports: TutorReport[]): HoursRow[] {
  const m = new Map<string, HoursRow>();
  for (const r of reports) {
    const row =
      m.get(r.teacher_contact_id) ??
      ({
        teacherId: r.teacher_contact_id,
        teacherName: r.teacher_name,
        kind: r.kind,
        count: 0,
        minutes: 0,
        byCategory: {},
        bySubject: {},
      } as HoursRow);
    row.count += 1;
    row.minutes += r.minutes;
    for (const [k, v] of Object.entries(r.minutes_by_category ?? {})) row.byCategory[k] = (row.byCategory[k] ?? 0) + v;
    if (r.kind === "lesson") {
      const s = r.subject ?? "其他";
      row.bySubject[s] = (row.bySubject[s] ?? 0) + r.minutes;
    }
    m.set(r.teacher_contact_id, row);
  }
  return [...m.values()].sort((a, b) => b.minutes - a.minutes);
}

export interface ProgressRow {
  subject: string;
  unit: string;
  date: string;
  teacherName: string;
}

/** 各科最近一次上到哪（上課紀錄單元、家庭老師社會自然單元、英文範圍） */
export function latestProgress(reports: TutorReport[]): ProgressRow[] {
  const m = new Map<string, ProgressRow>();
  const put = (row: ProgressRow) => {
    const cur = m.get(row.subject);
    if (!cur || row.date > cur.date) m.set(row.subject, row);
  };
  for (const r of reports) {
    if (r.kind === "lesson" && r.subject) {
      const c = asLesson(r.content);
      if (c.unit) put({ subject: r.subject, unit: c.unit, date: r.report_date, teacherName: r.teacher_name });
    } else if (r.kind === "daily") {
      const c = asDaily(r.content);
      for (const v of c.reviews) put({ subject: v.subject, unit: v.unit, date: r.report_date, teacherName: r.teacher_name });
      for (const e of c.english) put({ subject: `英文 ${e.course}`, unit: e.range, date: r.report_date, teacherName: r.teacher_name });
    }
  }
  return [...m.values()].sort((a, b) => a.subject.localeCompare(b.subject, "zh-Hant"));
}

export interface TrendPoint {
  date: string;
  value: number;
  unit: string;
}

/** 學生 id → 科目 → 依日期排序的吸收程度 */
export function absorptionTrends(reports: TutorReport[]): Map<string, Map<string, TrendPoint[]>> {
  const out = new Map<string, Map<string, TrendPoint[]>>();
  const add = (sid: string, subject: string, p: TrendPoint) => {
    const bySub = out.get(sid) ?? new Map<string, TrendPoint[]>();
    bySub.set(subject, [...(bySub.get(subject) ?? []), p]);
    out.set(sid, bySub);
  };
  for (const r of reports) {
    if (r.kind === "lesson" && r.subject) {
      const c = asLesson(r.content);
      for (const f of c.students) add(f.id, r.subject, { date: r.report_date, value: f.absorption, unit: c.unit });
    } else if (r.kind === "daily") {
      const c = asDaily(r.content);
      for (const v of c.reviews)
        for (const [sid, val] of Object.entries(v.absorption)) add(sid, v.subject, { date: r.report_date, value: val, unit: v.unit });
      for (const e of c.english)
        for (const [sid, val] of Object.entries(e.mastery))
          add(sid, `英文 ${e.course}`, { date: r.report_date, value: val, unit: e.range });
    }
  }
  for (const bySub of out.values()) for (const pts of bySub.values()) pts.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

export interface TodoItem {
  /** 標「已處理」用的固定鍵 */
  key: string;
  kind: "contact" | "purchase" | "project";
  date: string;
  title: string;
  detail: string;
  teacherName: string;
  reportId: string;
}

/**
 * 待辦：需家長處理的聯繫（近 30 天）、未完成的採購報名、未完成且有截止日的專題。
 * 採購與專題以「同名最新一筆」為準（每天回報會重複填同一件事）。
 */
export function todos(reports: TutorReport[], today: string): TodoItem[] {
  const since = new Date(Date.parse(`${today}T12:00:00Z`) - 30 * 86400000).toISOString().slice(0, 10);
  const items: TodoItem[] = [];
  const latestPurchase = new Map<string, TodoItem & { status: string }>();
  const latestProject = new Map<string, TodoItem & { done: boolean; due: string }>();
  const dailies = reports.filter((r) => r.kind === "daily").sort((a, b) => a.report_date.localeCompare(b.report_date));
  for (const r of dailies) {
    const c = asDaily(r.content);
    if (r.report_date >= since) {
      c.contacts.forEach((k) => {
        if (k.needsParent)
          items.push({
            key: `contact:${r.id}:${k.who}|${k.matter.slice(0, 60)}`,
            kind: "contact",
            date: r.report_date,
            title: `聯繫 ${k.who}`,
            detail: k.matter,
            teacherName: r.teacher_name,
            reportId: r.id,
          });
      });
    }
    for (const p of c.purchases) {
      latestPurchase.set(`${p.category}|${p.item}`, {
        key: `purchase:${p.category}|${p.item}|${p.status}`,
        kind: "purchase",
        date: r.report_date,
        title: `${p.category}：${p.item}`,
        detail: `${p.status}${p.amount ? `・$${p.amount}` : ""}`,
        teacherName: r.teacher_name,
        reportId: r.id,
        status: p.status,
      });
    }
    if (c.project?.name) {
      latestProject.set(c.project.name, {
        key: `project:${c.project.name}|${c.project.due}|${projectProgressText(c.project)}`,
        kind: "project",
        date: r.report_date,
        title: `專題：${c.project.name}`,
        detail: `${projectProgressText(c.project)}${c.project.due ? `・截止 ${c.project.due}` : ""}${c.project.next ? `・下一步：${c.project.next}` : ""}`,
        teacherName: r.teacher_name,
        reportId: r.id,
        done: c.project.progress === "完成" || c.project.percent === 100,
        due: c.project.due,
      });
    }
  }
  for (const p of latestPurchase.values()) if (p.status !== "已完成") items.push(p);
  for (const p of latestProject.values()) if (!p.done && p.due && p.due >= today) items.push(p);
  return items.sort((a, b) => b.date.localeCompare(a.date));
}
