"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Choice, Chips, Field, Percent, Repeater, Section, Text, TimeRange } from "./fields";
import { PhotoField, initPhotos, type PhotoState } from "./photos";
import {
  ENGLISH_ITEMS,
  HOMEWORK_STATUS,
  PROJECT_STAGES,
  PURCHASE_CATEGORIES,
  PURCHASE_STATUS,
  WORK_CATEGORIES,
  asDaily,
  checkDaily,
  dailyMinutes,
  emptyDaily,
  hoursText,
  type DailyContent,
} from "@/lib/tutor";
import { saveReport, useSchedule, type TutorProfile, type TutorReport } from "@/lib/client/tutor";
import { taipeiTodayStr } from "@/lib/date";

/**
 * 家庭老師每日回報：工作時數（必填）＋教學／事務各區塊，沒有內容的區塊收著略過。
 * 一天一筆（資料庫唯一索引擋重複）。
 */
export function DailyForm({
  profile,
  userId,
  report,
  lastProjectName,
  onDone,
}: {
  profile: TutorProfile;
  userId: string;
  report?: TutorReport | null;
  /** 專題名稱沿用上次 */
  lastProjectName?: string;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const students = profile.students;
  const [date, setDate] = useState(report?.report_date ?? taipeiTodayStr());
  const [c, setC] = useState<DailyContent>(() => (report ? asDaily(report.content) : emptyDaily()));
  const [saving, setSaving] = useState(false);
  const [photos, setPhotos] = useState<PhotoState>(() => initPhotos(c.photos, "parent"));
  // 週課表上這天「家庭老師」負責、沒請假停課的時段 → 一鍵帶入工作時段
  const plan = (useSchedule(profile.ownerId, date, date).data ?? []).filter(
    (it) => it.responsible === "家庭老師" && !it.status,
  );
  const set = (patch: Partial<DailyContent>) => setC((x) => ({ ...x, ...patch }));
  const perStudent = (v: number) => Object.fromEntries(students.map((s) => [s.id, v]));

  const { total, byCategory } = dailyMinutes(c.segments);

  async function submit() {
    // 空白的工作時段不算
    const content: DailyContent = { ...c, segments: c.segments.filter((s) => s.start || s.end) };
    const problem = checkDaily(date, content);
    if (problem) return void toast.error(problem);
    setSaving(true);
    const res = await saveReport({
      id: report?.id,
      profile,
      authorId: userId,
      kind: "daily",
      reportDate: date,
      subject: null,
      start: null,
      end: null,
      mode: null,
      studentIds: students.map((s) => s.id),
      eventId: null,
      prevEventId: null,
      prevEventNoteId: null,
      content: content as unknown as Record<string, unknown>,
      newPhotos: photos.added.map((file) => ({ file, section: "parent" as const })),
      removedPaths: photos.removed,
      minutes: total,
      minutesByCategory: byCategory,
      studentName: (id) => students.find((s) => s.id === id)?.name ?? "",
    });
    setSaving(false);
    if (res.error) return void toast.error(res.error);
    if (res.warning) toast.warning(res.warning);
    else toast.success(report ? "已更新今日回報" : "已送出今日回報，家長看得到了");
    await qc.invalidateQueries({ queryKey: ["tutor"] });
    onDone();
  }

  return (
    <div className="space-y-3">
      <div className="space-y-4 rounded-xl border bg-card p-3">
        <Field label="日期" required>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11 text-base" />
        </Field>
        {plan.length > 0 && (
          <button
            type="button"
            onClick={() =>
              set({
                segments: plan.map((it) => ({
                  start: it.start_time.slice(0, 5),
                  end: it.end_time.slice(0, 5),
                  category: "教學統籌",
                })),
              })
            }
            className="flex min-h-11 w-full items-center justify-center rounded-lg border border-dashed border-emerald-500 text-sm text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
          >
            從週課表帶入 {plan.length} 段（{plan.map((it) => `${it.start_time.slice(0, 5)}–${it.end_time.slice(0, 5)}`).join("、")}）
          </button>
        )}
        <Field label="工作時段" required hint={total ? `共 ${hoursText(total)}` : "一天可新增多段"}>
          <Repeater
            items={c.segments}
            onChange={(segments) => set({ segments })}
            make={() => ({ start: "", end: "", category: "教學統籌" })}
            addLabel="新增一段時間"
            render={(seg, put) => (
              <>
                <TimeRange start={seg.start} end={seg.end} onChange={(start, end) => put({ ...seg, start, end })} />
                <Choice options={WORK_CATEGORIES} value={seg.category} onChange={(category) => put({ ...seg, category })} />
              </>
            )}
          />
        </Field>
      </div>

      <div className="px-1 pt-1 text-sm font-semibold text-muted-foreground">教學（沒有就略過）</div>

      <Section title="學校作業" filled={c.homework?.status}>
        <Field label="完成狀態" required>
          <Choice
            options={HOMEWORK_STATUS}
            value={c.homework?.status ?? ""}
            onChange={(status) => set({ homework: { note: "", special: "", ...c.homework, status } })}
          />
        </Field>
        <Field label="作業內容說明">
          <Text
            multiline
            value={c.homework?.note ?? ""}
            onChange={(note) => set({ homework: { status: "", special: "", ...c.homework, note } })}
            placeholder="例：數學習作公里應用題，兩人都正確"
          />
        </Field>
        <Field label="特殊狀況">
          <Text
            value={c.homework?.special ?? ""}
            onChange={(special) => set({ homework: { status: "", note: "", ...c.homework, special } })}
            placeholder="例：哥哥閱讀單沒帶回，已影印一份完成"
          />
        </Field>
        {c.homework && (
          <button type="button" className="text-xs text-muted-foreground underline" onClick={() => set({ homework: null })}>
            清除這一區
          </button>
        )}
      </Section>

      <Section title="社會、自然" filled={c.reviews.length ? `${c.reviews.length} 項` : undefined}>
        <Repeater
          items={c.reviews}
          onChange={(reviews) => set({ reviews })}
          make={() => ({ subject: "社會", unit: "", method: "", absorption: perStudent(70), observation: "" })}
          addLabel="新增一科"
          render={(r, put) => (
            <>
              <Choice options={["社會", "自然"]} value={r.subject} onChange={(subject) => put({ ...r, subject })} />
              <Field label="單元" required>
                <Text value={r.unit} onChange={(unit) => put({ ...r, unit })} placeholder="例：U1–2" />
              </Field>
              <Field label="複習方式">
                <Text value={r.method} onChange={(method) => put({ ...r, method })} placeholder="例：用關鍵字複習、一起討論題目" />
              </Field>
              {students.map((s) => (
                <Field key={s.id} label={`${s.name} 吸收程度`} required>
                  <Percent
                    value={r.absorption[s.id] ?? 70}
                    onChange={(v) => put({ ...r, absorption: { ...r.absorption, [s.id]: v } })}
                  />
                </Field>
              ))}
              <Field label="觀察">
                <Text value={r.observation} onChange={(observation) => put({ ...r, observation })} placeholder="例：兩人專注力都很好" />
              </Field>
            </>
          )}
        />
      </Section>

      <Section title="英文 CET／FET 督促" filled={c.english.length ? `${c.english.length} 項` : undefined}>
        <Repeater
          items={c.english}
          onChange={(english) => set({ english })}
          make={() => ({ course: "CET", range: "", items: [], hwDone: "", mastery: perStudent(70), note: "" })}
          addLabel="新增一門"
          render={(e, put) => (
            <>
              <Choice options={["CET", "FET"]} value={e.course} onChange={(course) => put({ ...e, course })} />
              <Field label="範圍" required>
                <Text value={e.range} onChange={(range) => put({ ...e, range })} placeholder="例：Wk 4–9" />
              </Field>
              <Field label="項目" required>
                <Chips options={ENGLISH_ITEMS} value={e.items} onChange={(items) => put({ ...e, items })} />
              </Field>
              <Field label="補習班作業">
                <Choice options={["已完成", "未完成"]} value={e.hwDone} onChange={(hwDone) => put({ ...e, hwDone })} allowEmpty />
              </Field>
              {students.map((s) => (
                <Field key={s.id} label={`${s.name} 掌握程度`} required>
                  <Percent
                    value={e.mastery[s.id] ?? 70}
                    onChange={(v) => put({ ...e, mastery: { ...e.mastery, [s.id]: v } })}
                  />
                </Field>
              ))}
              <Field label="說明">
                <Text multiline value={e.note} onChange={(note) => put({ ...e, note })} placeholder="例：哥哥不熟的單字請他多念後再測，已較熟" />
              </Field>
            </>
          )}
        />
      </Section>

      <Section title="學校專題報告" filled={c.project?.name || undefined}>
        <Field label="專題名稱" required>
          <Text
            value={c.project?.name ?? ""}
            onChange={(name) => set({ project: { progress: "", due: "", next: "", ...c.project, name } })}
            placeholder={lastProjectName ? `上次：${lastProjectName}` : "例：青山 time 探究單"}
          />
          {!c.project?.name && lastProjectName && (
            <button
              type="button"
              className="text-xs text-primary underline"
              onClick={() => set({ project: { progress: "", due: "", next: "", ...c.project, name: lastProjectName } })}
            >
              沿用「{lastProjectName}」
            </button>
          )}
        </Field>
        <Field label="目前進度" required hint="選階段或填百分比，擇一即可">
          <Choice
            options={PROJECT_STAGES}
            value={c.project?.progress ?? ""}
            onChange={(progress) => set({ project: { name: "", due: "", next: "", ...c.project, progress } })}
            allowEmpty
          />
          {c.project?.percent == null ? (
            <button
              type="button"
              className="text-xs text-primary underline"
              onClick={() => set({ project: { name: "", progress: "", due: "", next: "", ...c.project, percent: 50 } })}
            >
              改用百分比
            </button>
          ) : (
            <div className="space-y-1">
              <Percent
                value={c.project.percent}
                onChange={(percent) => set({ project: { ...c.project!, percent } })}
              />
              <button
                type="button"
                className="text-xs text-muted-foreground underline"
                onClick={() => set({ project: { ...c.project!, percent: null } })}
              >
                不填百分比
              </button>
            </div>
          )}
        </Field>
        <Field label="截止日">
          <Input
            type="date"
            value={c.project?.due ?? ""}
            onChange={(e) => set({ project: { name: "", progress: "", next: "", ...c.project, due: e.target.value } })}
            className="h-11 text-base"
          />
        </Field>
        <Field label="下一步">
          <Text
            value={c.project?.next ?? ""}
            onChange={(next) => set({ project: { name: "", progress: "", due: "", ...c.project, next } })}
            placeholder="例：週日幫他們檢查"
          />
        </Field>
        {c.project && (
          <button type="button" className="text-xs text-muted-foreground underline" onClick={() => set({ project: null })}>
            清除這一區
          </button>
        )}
      </Section>

      <div className="px-1 pt-1 text-sm font-semibold text-muted-foreground">事務（沒有就略過）</div>

      <Section title="學校老師聯繫" filled={c.contacts.length ? `${c.contacts.length} 項` : undefined}>
        <Repeater
          items={c.contacts}
          onChange={(contacts) => set({ contacts })}
          make={() => ({ who: "", matter: "", needsParent: false })}
          addLabel="新增一筆聯繫"
          render={(k, put) => (
            <>
              <Field label="聯繫對象" required>
                <Text value={k.who} onChange={(who) => put({ ...k, who })} placeholder="例：班導、英文老師" />
              </Field>
              <Field label="事由與結果" required>
                <Text multiline value={k.matter} onChange={(matter) => put({ ...k, matter })} placeholder="例：提醒妹妹到校找 My View，請她問老師" />
              </Field>
              <label className="flex min-h-10 items-center gap-2 text-sm">
                <Switch checked={k.needsParent} onCheckedChange={(needsParent) => put({ ...k, needsParent })} />
                需要家長處理（家長端會標示提醒）
              </label>
            </>
          )}
        />
      </Section>

      <Section title="採購與報名" filled={c.purchases.length ? `${c.purchases.length} 項` : undefined}>
        <Repeater
          items={c.purchases}
          onChange={(purchases) => set({ purchases })}
          make={() => ({ category: "雜項", item: "", amount: "", status: "待處理" })}
          addLabel="新增一筆"
          render={(p, put) => (
            <>
              <Choice options={PURCHASE_CATEGORIES} value={p.category} onChange={(category) => put({ ...p, category })} />
              <Field label="品項" required>
                <Text value={p.item} onChange={(item) => put({ ...p, item })} />
              </Field>
              <Field label="金額">
                <Input
                  inputMode="numeric"
                  value={p.amount}
                  onChange={(e) => put({ ...p, amount: e.target.value })}
                  className="h-11 w-36 text-base"
                />
              </Field>
              <Field label="狀態" required>
                <Choice options={PURCHASE_STATUS} value={p.status} onChange={(status) => put({ ...p, status })} />
              </Field>
            </>
          )}
        />
      </Section>

      <Section
        title="給家長的話"
        filled={
          c.toParent || photos.added.length || photos.kept.length > photos.removed.length ? "已填" : undefined
        }
      >
        <Text multiline value={c.toParent} onChange={(toParent) => set({ toParent })} placeholder="例：週末出的小任務、整體觀察" />
        <PhotoField state={photos} onChange={setPhotos} />
      </Section>

      <div className="sticky bottom-0 flex gap-2 bg-background/95 py-3 backdrop-blur">
        <Button variant="outline" className="h-12 flex-1" onClick={onDone} disabled={saving}>
          取消
        </Button>
        <Button className="h-12 flex-[2] text-base" onClick={() => void submit()} disabled={saving}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          {report ? "儲存修改" : "送出今日回報"}
        </Button>
      </div>
    </div>
  );
}
