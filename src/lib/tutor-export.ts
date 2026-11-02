/**
 * 家長端匯出：當月紀錄 CSV（Excel 直接開；UTF-8 BOM 避免中文亂碼）。
 * 上課紀錄每位學生一列；每日回報一天一列，內容摘要成文字。
 * spec：docs/specs/家教老師填報.md
 */
import { asDaily, asLesson, projectProgressText } from "@/lib/tutor";
import type { TutorReport } from "@/lib/client/tutor";

const HEAD = [
  "日期",
  "老師",
  "類型",
  "科目",
  "時間",
  "時數",
  "工作類別時數",
  "上課型式",
  "課程類型",
  "單元",
  "教學重點",
  "學生",
  "吸收程度",
  "測驗分數",
  "表現說明",
  "錯誤類型",
  "下次加強",
  "每日回報摘要",
  "照片數",
  "最後修改",
];

function cell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const hrs = (min: number) => String(Math.round((min / 60) * 100) / 100);

export function reportsCsv(reports: TutorReport[], studentName: (id: string) => string): string {
  const rows: unknown[][] = [];
  const sorted = [...reports].sort(
    (a, b) => a.report_date.localeCompare(b.report_date) || (a.start_time ?? "").localeCompare(b.start_time ?? ""),
  );
  for (const r of sorted) {
    const time = r.start_time ? `${r.start_time.slice(0, 5)}-${r.end_time?.slice(0, 5) ?? ""}` : "";
    const cats = Object.entries(r.minutes_by_category ?? {})
      .map(([k, v]) => `${k} ${hrs(v)}`)
      .join("；");
    const edited = Date.parse(r.updated_at) - Date.parse(r.created_at) > 60_000 ? r.updated_at.slice(0, 16).replace("T", " ") : "";
    if (r.kind === "lesson") {
      const c = asLesson(r.content);
      const base = [r.report_date, r.teacher_name, "上課紀錄", r.subject, time, hrs(r.minutes), cats, r.mode, c.lessonType, c.unit, c.focus];
      const studentsRows = c.students.length ? c.students : [null];
      for (const f of studentsRows) {
        rows.push([
          ...base,
          f ? studentName(f.id) : "",
          f ? `${f.absorption}%` : "",
          f?.score ?? "",
          f?.performance ?? "",
          f ? [...f.errors, f.errorNote].filter(Boolean).join("、") : "",
          f?.nextFocus ?? "",
          "",
          c.photos.length || "",
          edited,
        ]);
      }
    } else {
      const c = asDaily(r.content);
      const parts = [
        c.homework && `作業：${c.homework.status} ${c.homework.note} ${c.homework.special}`.trim(),
        ...c.reviews.map(
          (v) =>
            `${v.subject} ${v.unit}（${Object.entries(v.absorption)
              .map(([id, p]) => `${studentName(id)} ${p}%`)
              .join("、")}）${v.observation}`,
        ),
        ...c.english.map(
          (e) =>
            `英文 ${e.course} ${e.range} ${e.items.join("/")}（${Object.entries(e.mastery)
              .map(([id, p]) => `${studentName(id)} ${p}%`)
              .join("、")}）${e.note}`,
        ),
        c.project && `專題：${c.project.name} ${projectProgressText(c.project)} ${c.project.due ? `截止 ${c.project.due}` : ""}`,
        ...c.contacts.map((k) => `聯繫 ${k.who}：${k.matter}${k.needsParent ? "【需家長處理】" : ""}`),
        ...c.purchases.map((p) => `${p.category}：${p.item} ${p.amount ? `$${p.amount}` : ""} ${p.status}`),
        c.toParent && `給家長：${c.toParent}`,
      ].filter(Boolean);
      rows.push([
        r.report_date,
        r.teacher_name,
        "每日回報",
        "",
        c.segments.map((s) => `${s.start}-${s.end}`).join("；"),
        hrs(r.minutes),
        cats,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        parts.join("\n"),
        c.photos.length || "",
        edited,
      ]);
    }
  }
  return "﻿" + [HEAD, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
}

export function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
