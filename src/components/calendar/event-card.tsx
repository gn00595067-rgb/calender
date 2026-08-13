"use client";

import { Star, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { D, twd } from "@/lib/date";
import { eventStyle, chipStyle } from "./event-visuals";
import type { CalEvent } from "@/lib/client/events";

/** 組出卡片第二行：地點 · 人物 · 金額 */
export function secondLine(event: CalEvent): string {
  const parts: string[] = [];
  if (event.location) parts.push(event.location);
  if (event.contactNames.length) parts.push(event.contactNames.join("、"));
  const sum = event.finance.reduce(
    (acc, f) => acc + (f.direction === "expense" ? f.amount : -f.amount),
    0,
  );
  if (event.finance.length) {
    const total = event.finance.reduce((a, f) => a + f.amount, 0);
    const dir = sum >= 0 ? "支" : "收";
    parts.push(`${dir} ${twd(total)}`);
  }
  return parts.join(" · ");
}

function timeLabel(event: CalEvent): string {
  if (event.all_day) return "整日";
  return D.time(event.starts_at);
}

/** 兩行卡片：agenda / 總覽 / 搜尋通用 */
export function EventTwoLineCard({
  event,
  color,
  conflict = false,
  onClick,
  emphasize = false,
}: {
  event: CalEvent;
  color: string;
  conflict?: boolean;
  onClick?: () => void;
  emphasize?: boolean;
}) {
  const line2 = secondLine(event);
  const big = emphasize || event.is_important;
  return (
    <button
      type="button"
      onClick={onClick}
      style={eventStyle(color, conflict)}
      className={cn(
        "flex w-full items-start gap-2 rounded-md px-2.5 py-1.5 text-left transition hover:brightness-95",
        big && "py-2",
      )}
    >
      {event.is_important && (
        <Star className="mt-0.5 size-4 shrink-0 fill-amber-400 text-amber-500" />
      )}
      <div className="min-w-0 flex-1">
        <div className={cn("flex items-baseline gap-2", big ? "text-[15px]" : "text-sm")}>
          <span className="font-bold tabular-nums">{timeLabel(event)}</span>
          <span className="truncate font-medium">{event.title}</span>
          {event.noteCount > 0 && (
            <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground">
              <MessageSquare className="size-3" />
              {event.noteCount}
            </span>
          )}
        </div>
        {line2 && (
          <div className="truncate text-xs text-muted-foreground">{line2}</div>
        )}
      </div>
    </button>
  );
}

/** 月視圖單行 chip */
export function MonthChip({
  event,
  color,
  conflict = false,
  onClick,
}: {
  event: CalEvent;
  color: string;
  conflict?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      style={chipStyle(color, conflict)}
      className="flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[11px] leading-tight hover:brightness-95"
    >
      {event.is_important && <Star className="size-2.5 shrink-0 fill-amber-400 text-amber-500" />}
      {!event.all_day && (
        <span className="shrink-0 font-semibold tabular-nums">{D.time(event.starts_at)}</span>
      )}
      <span className="truncate">{event.title}</span>
    </button>
  );
}
