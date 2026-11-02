"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Copy, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ListSkeleton } from "@/components/app/states";
import { Choice, Field, Text, TimeRange } from "./fields";
import { PhotoGrid } from "./photos";
import {
  copyScheduleWeek,
  deleteScheduleItem,
  removeFiles,
  saveScheduleItem,
  uploadFile,
  useSchedule,
  useScheduleImages,
  type ScheduleDraft,
  type ScheduleItem,
} from "@/lib/client/tutor";
import { SCHEDULE_RESPONSIBLE, addDays, mondayOf, spanMinutes } from "@/lib/tutor";
import { taipeiTodayStr } from "@/lib/date";
import { cn } from "@/lib/utils";

const WD = "一二三四五六日";
const md = (ds: string) => `${Number(ds.slice(5, 7))}/${Number(ds.slice(8, 10))}`;

/**
 * 家庭老師週課表（§五）：一週 7 天，每天的時段、項目、負責老師、重點標籤；
 * 考試日醒目、請假／停課紅字。可複製上週、上傳課表圖片（過渡期）。
 * 家長與家庭老師都能編輯。
 */
export function ScheduleView({ ownerId, userId }: { ownerId: string; userId: string }) {
  const qc = useQueryClient();
  const today = taipeiTodayStr();
  const [monday, setMonday] = useState(mondayOf(today));
  const sunday = addDays(monday, 6);
  const { data: items = [], isLoading, isError, error } = useSchedule(ownerId, monday, sunday);
  const prevQ = useSchedule(ownerId, addDays(monday, -7), addDays(monday, -1));
  const imagesQ = useScheduleImages(ownerId, monday);
  const [editing, setEditing] = useState<{ id?: string; draft: ScheduleDraft } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: ["tutor"] });
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));

  async function copyLastWeek() {
    if (items.length && !confirm("這週已經有課表，還要把上週的再複製一份進來嗎？")) return;
    setBusy(true);
    const err = await copyScheduleWeek(ownerId, userId, prevQ.data ?? [], 7);
    setBusy(false);
    if (err) return void toast.error(err);
    toast.success("已複製上週課表，請檢查本週有沒有異動");
    await refresh();
  }

  async function uploadImages(files: FileList | null) {
    if (!files?.length || busy) return;
    setBusy(true);
    let failed = 0;
    for (const f of Array.from(files)) {
      const err = await uploadFile(`s/${ownerId}/${monday}/${crypto.randomUUID()}.jpg`, f);
      if (err) failed++;
    }
    setBusy(false);
    if (failed) toast.error(`${failed} 張沒有上傳成功`);
    else toast.success("已上傳課表圖片");
    await refresh();
  }

  if (isError) return <div className="rounded-xl border p-4 text-sm text-red-600">{(error as Error).message}</div>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" onClick={() => setMonday(addDays(monday, -7))} aria-label="上一週">
          <ChevronLeft className="size-4" />
        </Button>
        <span className="font-semibold">
          {md(monday)}（一）– {md(sunday)}（日）
        </span>
        <Button variant="outline" size="icon" onClick={() => setMonday(addDays(monday, 7))} aria-label="下一週">
          <ChevronRight className="size-4" />
        </Button>
        {monday !== mondayOf(today) && (
          <Button variant="ghost" size="sm" onClick={() => setMonday(mondayOf(today))}>
            本週
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => void copyLastWeek()}
          disabled={busy || prevQ.isLoading}
        >
          <Copy className="size-4" />
          複製上週
        </Button>
      </div>

      {isLoading ? (
        <ListSkeleton rows={4} />
      ) : (
        <div className="space-y-2">
          {days.map((ds, i) => {
            const list = items.filter((it) => it.item_date === ds);
            const exam = list.some((it) => it.is_exam);
            return (
              <div
                key={ds}
                className={cn(
                  "rounded-xl border bg-card",
                  exam && "border-orange-400 bg-orange-50/60 dark:bg-orange-950/20",
                  ds === today && "ring-2 ring-primary/40",
                )}
              >
                <div className="flex items-center gap-2 border-b px-3 py-2">
                  <span className="font-semibold">
                    週{WD[i]} {md(ds)}
                  </span>
                  {exam && <span className="rounded bg-orange-500 px-1.5 text-xs font-bold text-white">考試日</span>}
                  {list
                    .map((it) => it.tag)
                    .filter(Boolean)
                    .filter((t, j, a) => a.indexOf(t) === j)
                    .map((t) => (
                      <span key={t} className="rounded bg-muted px-1.5 text-xs">
                        {t}
                      </span>
                    ))}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto h-8"
                    onClick={() =>
                      setEditing({
                        draft: {
                          item_date: ds,
                          start_time: "19:00",
                          end_time: "20:30",
                          title: "",
                          responsible: "家庭老師",
                          tag: "",
                          is_exam: false,
                          status: "",
                        },
                      })
                    }
                  >
                    <Plus className="size-4" />
                    新增
                  </Button>
                </div>
                {list.length > 0 && (
                  <ul className="divide-y">
                    {list.map((it) => (
                      <ScheduleRow
                        key={it.id}
                        it={it}
                        onEdit={() =>
                          setEditing({
                            id: it.id,
                            draft: {
                              item_date: it.item_date,
                              start_time: it.start_time.slice(0, 5),
                              end_time: it.end_time.slice(0, 5),
                              title: it.title,
                              responsible: it.responsible,
                              tag: it.tag,
                              is_exam: it.is_exam,
                              status: it.status,
                            },
                          })
                        }
                        onDelete={async () => {
                          if (!confirm(`刪除「${it.title}」？`)) return;
                          const err = await deleteScheduleItem(it.id);
                          if (err) return void toast.error(err);
                          await refresh();
                        }}
                      />
                    ))}
                  </ul>
                )}
                {editing && editing.draft.item_date === ds && (
                  <ScheduleEditor
                    initial={editing.draft}
                    onCancel={() => setEditing(null)}
                    onSave={async (d) => {
                      const err = await saveScheduleItem(ownerId, userId, d, editing.id);
                      if (err) {
                        toast.error(err);
                        return false;
                      }
                      setEditing(null);
                      await refresh();
                      return true;
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="space-y-2 rounded-xl border bg-card p-3">
        <div className="font-semibold">
          課表圖片 <span className="text-xs font-normal text-muted-foreground">過渡期可直接上傳 Excel 截圖</span>
        </div>
        <PhotoGrid paths={imagesQ.data ?? []} />
        {(imagesQ.data ?? []).length > 0 && (
          <button
            type="button"
            className="text-xs text-muted-foreground underline"
            onClick={async () => {
              if (!confirm("刪除這週所有課表圖片？")) return;
              const err = await removeFiles(imagesQ.data ?? []);
              if (err) toast.error(`刪除失敗：${err}`);
              await refresh();
            }}
          >
            刪除這週的圖片
          </button>
        )}
        <label className="flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed text-sm hover:bg-accent">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          上傳這週的課表圖片
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              void uploadImages(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
      </div>
    </div>
  );
}

function ScheduleRow({ it, onEdit, onDelete }: { it: ScheduleItem; onEdit: () => void; onDelete: () => void }) {
  const off = !!it.status;
  return (
    <li className="flex items-start gap-2 px-3 py-2">
      <span className={cn("w-24 shrink-0 tabular-nums text-sm", off && "text-red-600 line-through")}>
        {it.start_time.slice(0, 5)}–{it.end_time.slice(0, 5)}
      </span>
      <div className="min-w-0 flex-1">
        <div className={cn("text-sm", off && "text-red-600 line-through", it.is_exam && "font-bold text-orange-700")}>
          {it.title}
        </div>
        <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
          {it.responsible && <span>{it.responsible}</span>}
          {off && <span className="font-bold text-red-600 no-underline">{it.status}</span>}
        </div>
      </div>
      <button type="button" onClick={onEdit} aria-label="修改" className="inline-flex size-8 items-center justify-center rounded-md hover:bg-accent">
        <Pencil className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label="刪除"
        className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-red-600"
      >
        <Trash2 className="size-3.5" />
      </button>
    </li>
  );
}

function ScheduleEditor({
  initial,
  onCancel,
  onSave,
}: {
  initial: ScheduleDraft;
  onCancel: () => void;
  onSave: (d: ScheduleDraft) => Promise<boolean>;
}) {
  const [d, setD] = useState(initial);
  const [saving, setSaving] = useState(false);
  return (
    <div className="space-y-3 border-t bg-muted/30 p-3">
      <Field label="日期" required>
        <Input type="date" value={d.item_date} onChange={(e) => setD({ ...d, item_date: e.target.value })} className="h-11 text-base" />
      </Field>
      <Field label="時段" required>
        <TimeRange start={d.start_time} end={d.end_time} onChange={(start_time, end_time) => setD({ ...d, start_time, end_time })} />
      </Field>
      <Field label="項目" required>
        <Text value={d.title} onChange={(title) => setD({ ...d, title })} placeholder="例：作業／複習 FET wk1–6；洗澡晚餐" />
      </Field>
      <Field label="負責老師">
        <Choice options={SCHEDULE_RESPONSIBLE} value={d.responsible} onChange={(responsible) => setD({ ...d, responsible })} allowEmpty />
      </Field>
      <Field label="當日重點標籤">
        <Text value={d.tag} onChange={(tag) => setD({ ...d, tag })} placeholder="例：社會總複習、期中考 FET" />
      </Field>
      <label className="flex min-h-10 items-center gap-2 text-sm">
        <Switch checked={d.is_exam} onCheckedChange={(is_exam) => setD({ ...d, is_exam })} />
        這天考試（整天醒目顯示）
      </label>
      <Field label="異動註記">
        <Choice options={["請假", "停課"]} value={d.status} onChange={(status) => setD({ ...d, status: status as ScheduleDraft["status"] })} allowEmpty />
      </Field>
      <div className="flex gap-2">
        <Button variant="outline" className="h-11 flex-1" onClick={onCancel} disabled={saving}>
          取消
        </Button>
        <Button
          className="h-11 flex-[2]"
          disabled={saving}
          onClick={async () => {
            if (!d.title.trim()) return void toast.error("請填項目");
            if (!spanMinutes(d.start_time, d.end_time)) return void toast.error("結束時間要晚於開始");
            setSaving(true);
            await onSave({ ...d, title: d.title.trim(), tag: d.tag.trim() });
            setSaving(false);
          }}
        >
          {saving && <Loader2 className="size-4 animate-spin" />}
          儲存
        </Button>
      </div>
    </div>
  );
}
