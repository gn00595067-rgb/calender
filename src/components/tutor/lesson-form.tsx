"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CalendarCheck, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Choice, Chips, Field, Percent, Text, TimeRange } from "./fields";
import { PhotoField, initPhotos, type PhotoState } from "./photos";
import {
  ERROR_TYPES,
  LESSON_TYPES,
  MODES,
  SUBJECTS,
  asLesson,
  checkLesson,
  emptyFeedback,
  emptyLesson,
  hoursText,
  spanMinutes,
  type LessonContent,
  type StudentFeedback,
} from "@/lib/tutor";
import { saveReport, useTeacherLessonsOn, useUnits, type TutorProfile, type TutorReport } from "@/lib/client/tutor";
import { taipeiTodayStr, utcToTaipeiWall } from "@/lib/date";

/**
 * 專科老師上課紀錄（數學、國文…）：共用欄位＋上課內容＋每位學生的回饋。
 * 選了日期後，若行事曆那天有這位老師的課，可一鍵帶入時間並連到那堂課。
 */
export function LessonForm({
  profile,
  userId,
  report,
  onDone,
}: {
  profile: TutorProfile;
  userId: string;
  report?: TutorReport | null;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const subjects = profile.subjects.length ? profile.subjects : [...SUBJECTS];
  const allStudentIds = profile.students.map((s) => s.id);
  const nameOf = (id: string) => profile.students.find((s) => s.id === id)?.name ?? "學生";

  const [date, setDate] = useState(report?.report_date ?? taipeiTodayStr());
  const [subject, setSubject] = useState(report?.subject ?? (subjects.length === 1 ? subjects[0] : ""));
  const [start, setStart] = useState(report?.start_time?.slice(0, 5) ?? "");
  const [end, setEnd] = useState(report?.end_time?.slice(0, 5) ?? "");
  const [mode, setMode] = useState(report?.mode ?? (allStudentIds.length > 1 ? "1 對 2" : "1 對 1"));
  const [studentIds, setStudentIds] = useState<string[]>(report?.student_ids ?? allStudentIds);
  const [eventId, setEventId] = useState<string | null>(report?.event_id ?? null);
  const [content, setContent] = useState<LessonContent>(() =>
    report ? asLesson(report.content) : emptyLesson(allStudentIds),
  );
  const [saving, setSaving] = useState(false);
  const [photos, setPhotos] = useState<PhotoState>(() => initPhotos(content.photos, "lesson"));
  // 家長建好的課本單元清單（沒建就只能手打）
  const unitOptions = useUnits(profile.ownerId).data?.get(subject) ?? [];

  const lessonsQ = useTeacherLessonsOn(date, true);
  const lessons = lessonsQ.data ?? [];

  const setStudents = (ids: string[]) => {
    setStudentIds(ids);
    // 回饋卡跟著勾選的學生走：新勾的補一張、取消的拿掉
    setContent((c) => ({
      ...c,
      students: ids.map((id) => c.students.find((f) => f.id === id) ?? emptyFeedback(id)),
    }));
    if (ids.length === 1) setMode("1 對 1");
    if (ids.length >= 2) setMode("1 對 2");
  };
  const setFeedback = (id: string, patch: Partial<StudentFeedback>) =>
    setContent((c) => ({ ...c, students: c.students.map((f) => (f.id === id ? { ...f, ...patch } : f)) }));

  const minutes = spanMinutes(start, end);

  async function submit() {
    const problem = checkLesson({ subject, date, start, end, mode, studentIds, content, studentName: nameOf });
    if (problem) return void toast.error(problem);
    setSaving(true);
    const res = await saveReport({
      id: report?.id,
      profile,
      authorId: userId,
      kind: "lesson",
      reportDate: date,
      subject,
      start,
      end,
      mode,
      studentIds,
      eventId,
      prevEventId: report?.event_id ?? null,
      prevEventNoteId: report?.event_note_id ?? null,
      content: content as unknown as Record<string, unknown>,
      newPhotos: photos.added.map((file) => ({ file, section: "lesson" as const })),
      removedPaths: photos.removed,
      minutes,
      minutesByCategory: {},
      studentName: nameOf,
    });
    setSaving(false);
    if (res.error) return void toast.error(res.error);
    if (res.warning) toast.warning(res.warning);
    else toast.success(report ? "已更新紀錄" : "已送出紀錄，家長看得到了");
    await qc.invalidateQueries({ queryKey: ["tutor"] });
    await qc.invalidateQueries({ queryKey: ["teach"] });
    onDone();
  }

  return (
    <div className="space-y-4">
      <div className="space-y-4 rounded-xl border bg-card p-3">
        <Field label="上課日期" required>
          <Input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setEventId(null);
            }}
            className="h-11 text-base"
          />
        </Field>
        {/* 那天行事曆上有這位老師的課 → 一鍵帶入 */}
        {lessons.length > 0 && (
          <div className="space-y-1.5">
            {lessons.map((l) => {
              const s = utcToTaipeiWall(l.starts_at).slice(11, 16);
              const e = utcToTaipeiWall(l.ends_at).slice(11, 16);
              const on = eventId === l.event_id;
              return (
                <button
                  key={l.event_id}
                  type="button"
                  onClick={() => {
                    setStart(s);
                    setEnd(e);
                    setEventId(on ? null : l.event_id);
                    const ids = profile.students.filter((st) => l.subject_names.includes(st.name)).map((st) => st.id);
                    if (!on && ids.length) setStudents(ids);
                  }}
                  className={
                    "flex min-h-11 w-full items-center gap-2 rounded-lg border px-3 text-left text-sm " +
                    (on ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30" : "border-dashed hover:bg-accent")
                  }
                >
                  <CalendarCheck className="size-4 shrink-0 text-emerald-600" />
                  {on ? "已連到行事曆：" : "帶入行事曆的課："}
                  <span className="font-medium">
                    {s}–{e} {l.title}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <Field label="上課時間" required hint={minutes ? `共 ${hoursText(minutes)}` : undefined}>
          <TimeRange
            start={start}
            end={end}
            onChange={(s, e) => {
              setStart(s);
              setEnd(e);
            }}
          />
        </Field>
        <Field label="科目" required>
          <Choice options={subjects} value={subject} onChange={setSubject} />
        </Field>
        <Field label="上課學生" required>
          <Chips options={allStudentIds} value={studentIds} onChange={setStudents} labelOf={nameOf} />
        </Field>
        <Field label="上課型式" required>
          <Choice options={MODES} value={mode} onChange={setMode} />
        </Field>
      </div>

      <div className="space-y-4 rounded-xl border bg-card p-3">
        <div className="font-semibold">上課內容</div>
        <Field label="課程類型" required>
          <Choice
            options={LESSON_TYPES}
            value={content.lessonType}
            onChange={(v) => setContent({ ...content, lessonType: v })}
          />
        </Field>
        <Field label="單元" required>
          <Text value={content.unit} onChange={(v) => setContent({ ...content, unit: v })} placeholder="例：數學第三～五單元；國語第五課" />
          {unitOptions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {unitOptions.map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => setContent({ ...content, unit: u })}
                  className={
                    "min-h-9 rounded-full border px-3 text-sm " +
                    (content.unit === u ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent")
                  }
                >
                  {u}
                </button>
              ))}
            </div>
          )}
        </Field>
        <Field label="教學重點" required>
          <Text multiline value={content.focus} onChange={(v) => setContent({ ...content, focus: v })} placeholder="例：第三～五單元重點概念與應用題型" />
        </Field>
        <Field label="使用教材／頁碼">
          <Text value={content.materials} onChange={(v) => setContent({ ...content, materials: v })} placeholder="例：第五課評量 p.32–35" />
        </Field>
        <Field label="教學方式">
          <Text value={content.method} onChange={(v) => setContent({ ...content, method: v })} placeholder="例：不主動引導，先讓孩子獨立解題" />
        </Field>
      </div>

      {content.students.map((f) => (
        <div key={f.id} className="space-y-4 rounded-xl border bg-card p-3">
          <div className="font-semibold">{nameOf(f.id)} 的回饋</div>
          <Field label="吸收程度" required hint="依本次測驗／練習評估">
            <Percent value={f.absorption} onChange={(v) => setFeedback(f.id, { absorption: v })} />
          </Field>
          <Field label="測驗分數" hint="有測驗才填">
            <Input
              inputMode="decimal"
              value={f.score}
              onChange={(e) => setFeedback(f.id, { score: e.target.value })}
              className="h-11 w-32 text-base"
            />
          </Field>
          <Field label="表現說明" required>
            <Text multiline value={f.performance} onChange={(v) => setFeedback(f.id, { performance: v })} placeholder="例：表現穩定，能寫出正確計算過程" />
          </Field>
          <Field label="錯誤類型">
            <Chips options={ERROR_TYPES} value={f.errors} onChange={(v) => setFeedback(f.id, { errors: v })} />
            <Text value={f.errorNote} onChange={(v) => setFeedback(f.id, { errorNote: v })} placeholder="其他錯誤（選填）" />
          </Field>
          <Field label="下次加強重點" required>
            <Text multiline value={f.nextFocus} onChange={(v) => setFeedback(f.id, { nextFocus: v })} placeholder="例：圈出條件、列出算式、計算並檢查" />
          </Field>
        </div>
      ))}

      <div className="space-y-2 rounded-xl border bg-card p-3">
        <div className="font-semibold">
          附件照片 <span className="text-xs font-normal text-muted-foreground">考卷、課本、作業，可多張</span>
        </div>
        <PhotoField state={photos} onChange={setPhotos} />
      </div>

      <div className="sticky bottom-0 flex gap-2 bg-background/95 py-3 backdrop-blur">
        <Button variant="outline" className="h-12 flex-1" onClick={onDone} disabled={saving}>
          取消
        </Button>
        <Button className="h-12 flex-[2] text-base" onClick={() => void submit()} disabled={saving}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          {report ? "儲存修改" : "送出紀錄"}
        </Button>
      </div>
    </div>
  );
}
