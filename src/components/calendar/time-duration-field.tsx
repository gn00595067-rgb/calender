"use client";

import { useMemo } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DURATION_OPTIONS } from "@/lib/constants";
import {
  parseWall,
  makeWall,
  diffMinutes,
  addMinutesToWall,
} from "@/lib/wall-time";

const HOURS = Array.from({ length: 24 }, (_, i) => i); // 0..23（24 小時制）
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5); // 0,5,..,55（每 5 分鐘）
const CUSTOM = "custom";

/** 「隔日」判斷：結束的曆日晚於開始的曆日 */
function crossesDay(startWall: string, endWall: string): boolean {
  return parseWall(endWall).date > parseWall(startWall).date;
}

/**
 * 開始時間 + 長度 的輸入元件。
 * - 時：24 小時制下拉；分：每 5 分鐘。
 * - 選「長度」即由開始時間自動推算結束時間（跨午夜自動進位隔日）。
 * - 也可手動微調結束時間；此時長度切換為「自訂」。
 */
export function TimeDurationField({
  startWall,
  endWall,
  onChange,
}: {
  startWall: string;
  endWall: string;
  /** 回傳更新後的 (開始, 結束) 牆上時間字串 */
  onChange: (startWall: string, endWall: string) => void;
}) {
  const start = parseWall(startWall);
  const end = parseWall(endWall);
  const duration = diffMinutes(startWall, endWall);

  // 目前長度是否命中預設選項；否則顯示「自訂」
  const durationValue = useMemo(
    () =>
      DURATION_OPTIONS.some((o) => o.value === duration)
        ? String(duration)
        : CUSTOM,
    [duration],
  );

  // 更新開始：維持原本長度，結束隨之平移
  function setStart(date: string, h: number, m: number) {
    const nextStart = makeWall(date, h, m);
    const keep = duration > 0 ? duration : 60;
    onChange(nextStart, addMinutesToWall(nextStart, keep));
  }

  // 選長度：結束 = 開始 + 長度
  function setDuration(mins: number) {
    onChange(startWall, addMinutesToWall(startWall, mins));
  }

  // 手動調整結束時間（同日；若早於開始則自動視為隔日）
  function setEnd(h: number, m: number) {
    let candidate = makeWall(start.date, h, m);
    if (diffMinutes(startWall, candidate) <= 0) {
      candidate = addMinutesToWall(candidate, 24 * 60); // 進位到隔日
    }
    onChange(startWall, candidate);
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>開始</Label>
        <div className="flex gap-2">
          <Input
            type="date"
            className="flex-1"
            value={start.date}
            onChange={(e) => setStart(e.target.value, start.h, start.m)}
          />
          <TimeSelect
            hour={start.h}
            minute={start.m}
            onChange={(h, m) => setStart(start.date, h, m)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>長度</Label>
          <Select
            value={durationValue}
            onValueChange={(v) => v !== CUSTOM && setDuration(Number(v))}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DURATION_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={String(o.value)}>
                  {o.label}
                </SelectItem>
              ))}
              <SelectItem value={CUSTOM}>自訂</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="flex items-center gap-1.5">
            結束
            {crossesDay(startWall, endWall) && (
              <span className="rounded bg-amber-100 px-1 text-[11px] font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-400">
                隔日
              </span>
            )}
          </Label>
          <TimeSelect hour={end.h} minute={end.m} onChange={setEnd} />
        </div>
      </div>
    </div>
  );
}

/** 時（24 小時制）＋ 分（每 5 分鐘）兩個下拉 */
function TimeSelect({
  hour,
  minute,
  onChange,
}: {
  hour: number;
  minute: number;
  onChange: (hour: number, minute: number) => void;
}) {
  // 分若非 5 的倍數（既有舊資料），就近向下對齊顯示，避免下拉找不到值
  const minuteValue = MINUTES.includes(minute)
    ? minute
    : Math.floor(minute / 5) * 5;
  return (
    <div className="flex items-center gap-1">
      <Select
        value={String(hour)}
        onValueChange={(v) => onChange(Number(v), minute)}
      >
        <SelectTrigger className="w-[4.5rem] tabular-nums">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-60">
          {HOURS.map((h) => (
            <SelectItem key={h} value={String(h)} className="tabular-nums">
              {String(h).padStart(2, "0")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-muted-foreground">:</span>
      <Select
        value={String(minuteValue)}
        onValueChange={(v) => onChange(hour, Number(v))}
      >
        <SelectTrigger className="w-[4.5rem] tabular-nums">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-60">
          {MINUTES.map((m) => (
            <SelectItem key={m} value={String(m)} className="tabular-nums">
              {String(m).padStart(2, "0")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
