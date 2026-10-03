"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Car, Copy, Printer } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState, ListSkeleton } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useAppData } from "@/components/app/app-data";
import { fetchEventsInRange } from "@/lib/client/events";
import {
  taipeiDateEndExclusiveUtcISO,
  taipeiDateStartUtcISO,
  taipeiTodayStr,
} from "@/lib/date";
import {
  dayLabel,
  driverLegs,
  driverScheduleText,
  groupLegsByDay,
  legLine,
} from "@/lib/driver";
import { cn } from "@/lib/utils";

type Preset = "7" | "14" | "month" | "custom";

const PRESETS: { value: Preset; label: string }[] = [
  { value: "7", label: "未來 7 天" },
  { value: "14", label: "未來 14 天" },
  { value: "month", label: "本月" },
  { value: "custom", label: "自訂" },
];

/** yyyy-MM-dd 加 n 天 */
function addDaysStr(ds: string, n: number): string {
  const d = new Date(`${ds}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function monthEndStr(ds: string): string {
  const [y, m] = ds.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${ds.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

/**
 * 司機行程：把區間內「需要司機」的行程整理成時間表，
 * 一鍵複製貼到 LINE，或列印／存 PDF 給司機。
 */
export default function DriverSchedulePage() {
  const { calendars } = useAppData();
  const today = taipeiTodayStr();
  const [preset, setPreset] = useState<Preset>("7");
  const [customStart, setCustomStart] = useState(today);
  const [customEnd, setCustomEnd] = useState(addDaysStr(today, 6));
  // 不想讓司機知道行程內容（如看醫生）時可關掉
  const [showTitle, setShowTitle] = useState(true);

  const { start, end } = useMemo(() => {
    if (preset === "7") return { start: today, end: addDaysStr(today, 6) };
    if (preset === "14") return { start: today, end: addDaysStr(today, 13) };
    if (preset === "month") return { start: today, end: monthEndStr(today) };
    return customStart <= customEnd
      ? { start: customStart, end: customEnd }
      : { start: customEnd, end: customStart };
  }, [preset, today, customStart, customEnd]);

  // 全部可存取分類（不受行事曆顯示篩選影響，避免藏起來的分類漏交代）
  const ids = useMemo(() => calendars.map((c) => c.id).sort(), [calendars]);
  const { data: events = [], isLoading } = useQuery({
    queryKey: ["driver-schedule", start, end, ids],
    enabled: ids.length > 0,
    queryFn: () =>
      fetchEventsInRange(
        taipeiDateStartUtcISO(start),
        taipeiDateEndExclusiveUtcISO(end),
        ids,
      ),
  });

  const startIso = taipeiDateStartUtcISO(start);
  const endIso = taipeiDateEndExclusiveUtcISO(end);
  const legs = events
    .filter((e) => e.driver)
    .flatMap(driverLegs)
    // 只列上車時間落在區間內的趟次（跨區間行程的另一趟不重複列）
    .filter((l) => l.at >= startIso && l.at < endIso);
  const groups = groupLegsByDay(legs);
  const rangeLabel = `${dayLabel(startIso)}～${dayLabel(
    new Date(new Date(endIso).getTime() - 1).toISOString(),
  )}`;
  const text = driverScheduleText(legs, rangeLabel, showTitle);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("已複製，可直接貼到 LINE 給司機");
    } catch {
      toast.error("複製失敗，請改用列印或手動選取文字");
    }
  };

  const print = () => {
    const w = window.open("", "_blank");
    if (!w) {
      toast.error("瀏覽器擋住了彈出視窗，請允許後再試");
      return;
    }
    w.document.write(printHtml(text));
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="司機行程"
        description="整理需要司機接送的行程，一鍵複製貼到 LINE，或列印給司機。"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={print} disabled={legs.length === 0}>
              <Printer className="size-4" />
              列印／PDF
            </Button>
            <Button onClick={copy} disabled={legs.length === 0}>
              <Copy className="size-4" />
              複製文字
            </Button>
          </div>
        }
      />

      <div className="mb-4 space-y-3 rounded-xl border bg-card p-3">
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="期間">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              role="radio"
              aria-checked={preset === p.value}
              onClick={() => setPreset(p.value)}
              className={cn(
                "rounded-full border px-3 py-1 text-sm transition touch:py-2",
                preset === p.value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "hover:bg-accent",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">開始</Label>
              <Input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">結束</Label>
              <Input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
              />
            </div>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={showTitle} onCheckedChange={(c) => setShowTitle(!!c)} />
          顯示行程名稱
          <span className="text-xs text-muted-foreground">（不想讓司機知道內容時可關掉）</span>
        </label>
      </div>

      {isLoading ? (
        <ListSkeleton rows={4} />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={Car}
          title="這段期間沒有需要接送的行程"
          description="在新增／編輯行程時打開「需要司機接送」，就會出現在這裡。"
        />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {rangeLabel}，共 {legs.length} 趟
          </p>
          {groups.map((g) => (
            <section key={g.day}>
              <h2 className="mb-1.5 text-sm font-semibold">{g.label}</h2>
              <ul className="divide-y rounded-xl border bg-card">
                {g.legs.map((l) => (
                  <li key={`${l.eventId}-${l.kind}`} className="px-3 py-2 text-sm">
                    {legLine(l, showTitle)}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/** 列印用的極簡頁面：只印時間表文字 */
function printHtml(text: string): string {
  const esc = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>司機行程</title>
<style>body{font-family:system-ui,"Noto Sans TC",sans-serif;font-size:16px;line-height:1.8;padding:24px;white-space:pre-wrap}</style>
</head><body>${esc}</body></html>`;
}
