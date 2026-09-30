"use client";

import { useState } from "react";
import { format } from "date-fns";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { zoned } from "@/lib/calendar-utils";
import { D } from "@/lib/date";
import type { CalEvent } from "@/lib/client/events";

/** 行程時間區段文字：同日「9/30 11:00–12:00」，跨日「10/1 11:00 → 10/2 15:00」 */
function spanLabel(e: CalEvent): string {
  const s = zoned(e.starts_at);
  const en = zoned(e.ends_at);
  const sd = format(s, "M/d");
  const ed = format(en, "M/d");
  return sd === ed
    ? `${sd} ${D.time(e.starts_at)}–${D.time(e.ends_at)}`
    : `${sd} ${D.time(e.starts_at)} → ${ed} ${D.time(e.ends_at)}`;
}

/**
 * 儲存前的時間衝突面板：列出同時段既有行程，讓使用者選
 * 返回修改／放棄新行程／儲存（可勾選同時刪除舊行程）。
 */
export function ConflictPrompt({
  conflicts,
  isEdit,
  calendarName,
  colorOf,
  canDelete,
  pending,
  onBack,
  onDiscard,
  onSave,
}: {
  conflicts: CalEvent[];
  /** 編輯既有行程時，「放棄」代表放棄這次修改 */
  isEdit: boolean;
  calendarName: (calendarId: string) => string;
  colorOf: (calendarId: string) => string;
  canDelete: (e: CalEvent) => boolean;
  pending: boolean;
  onBack: () => void;
  onDiscard: () => void;
  onSave: (deleteIds: string[]) => void;
}) {
  // 預設不勾：刪除不可復原，要使用者明確選
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const toggle = (id: string, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <div className="space-y-4">
      <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/30">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
        <div>
          <p className="font-medium">這個時段已經有 {conflicts.length} 筆行程</p>
          <p className="text-xs text-muted-foreground">
            要取消的舊行程請打勾，儲存時會一併刪除；不勾就兩個都保留。
          </p>
        </div>
      </div>

      <ul className="space-y-2">
        {conflicts.map((e) => {
          const deletable = canDelete(e);
          const checked = picked.has(e.id);
          return (
            <li key={e.id}>
              <label
                className={
                  "flex items-start gap-3 rounded-lg border p-3 " +
                  (deletable ? "cursor-pointer" : "opacity-70") +
                  (checked ? " border-destructive bg-destructive/5" : "")
                }
              >
                <Checkbox
                  className="mt-0.5"
                  checked={checked}
                  disabled={!deletable}
                  onCheckedChange={(c) => toggle(e.id, !!c)}
                />
                <div className="min-w-0 flex-1">
                  <div className={"text-sm font-medium" + (checked ? " line-through" : "")}>
                    {e.title}
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    {spanLabel(e)}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <span
                        className="inline-block size-2 rounded-full"
                        style={{ background: colorOf(e.calendar_id) }}
                      />
                      {calendarName(e.calendar_id)}
                    </span>
                    {e.subjectNames.length > 0 && <span>主角：{e.subjectNames.join("、")}</span>}
                    {e.recurrence_group_id && <span>重複行程（只刪這一筆）</span>}
                  </div>
                  {checked && e.finance.length > 0 && (
                    <p className="mt-1 text-xs text-amber-600">財務紀錄會保留，只是不再連到這個行程。</p>
                  )}
                  {!deletable && (
                    <p className="mt-1 text-xs text-muted-foreground">沒有此分類的編輯權限，無法刪除。</p>
                  )}
                </div>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onBack} disabled={pending}>
          返回修改
        </Button>
        <Button type="button" variant="outline" onClick={onDiscard} disabled={pending}>
          {isEdit ? "放棄這次修改" : "放棄新行程"}
        </Button>
        <Button
          type="button"
          variant={picked.size > 0 ? "destructive" : "default"}
          onClick={() => onSave([...picked])}
          disabled={pending}
        >
          {pending
            ? "儲存中…"
            : picked.size > 0
              ? `儲存，並刪除 ${picked.size} 筆舊行程`
              : "兩個都保留，儲存"}
        </Button>
      </div>
    </div>
  );
}
