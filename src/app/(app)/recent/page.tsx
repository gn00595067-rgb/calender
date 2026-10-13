"use client";

import { useMemo, useState } from "react";
import { ClipboardCheck } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/app/states";
import { EventDetailDialog } from "@/components/calendar/event-detail-dialog";
import { EventModal } from "@/components/calendar/event-modal";
import { useAppData } from "@/components/app/app-data";
import { useContacts } from "@/lib/client/lookups";
import { useRecentlyAdded, type RecentItem } from "@/lib/client/recent";
import type { CalEvent } from "@/lib/client/events";
import { eventSentence, summaryFromEvents } from "@/lib/event-summary";
import { fmt, taipeiDateStartUtcISO, taipeiTodayStr } from "@/lib/date";
import { cn } from "@/lib/utils";

type Range = "today" | "week";

/** 本週一（台北）yyyy-MM-dd */
function mondayOf(today: string): string {
  const d = new Date(`${today}T12:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - back * 86400000).toISOString().slice(0, 10);
}

/**
 * 新增紀錄：依「輸入日」（不是行程日）列出今天／本週新增的行程，
 * 交接期第二個人可以逐筆核對，不會漏掉行程。
 * spec：docs/specs/新增確認與新增紀錄.md
 */
export default function RecentPage() {
  const [range, setRange] = useState<Range>("today");
  const today = taipeiTodayStr();
  const since = taipeiDateStartUtcISO(range === "today" ? today : mondayOf(today));
  const { data, isLoading, error, refetch } = useRecentlyAdded(since);
  const { calendarById } = useAppData();
  const { data: contacts = [] } = useContacts();
  const selfName = contacts.find((c) => c.is_self)?.name ?? null;
  const [detail, setDetail] = useState<CalEvent | null>(null);
  const [editing, setEditing] = useState<CalEvent | null>(null);

  // 依輸入日分組（本週才有多天）
  const byDay = useMemo(() => {
    const m = new Map<string, RecentItem[]>();
    for (const it of data ?? []) {
      const k = fmt(it.createdAt, "M/d（EEE）");
      m.set(k, [...(m.get(k) ?? []), it]);
    }
    return [...m.entries()];
  }, [data]);

  const total = data?.length ?? 0;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="新增紀錄"
        description="依輸入的日期列出新增的行程，方便第二個人核對有沒有漏"
      />

      <div className="mb-3 flex gap-2">
        {(
          [
            { v: "today", l: "今天新增" },
            { v: "week", l: "本週新增" },
          ] as const
        ).map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => setRange(o.v)}
            className={cn(
              "rounded-full border px-4 py-1.5 text-sm",
              range === o.v ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
            )}
          >
            {o.l}
          </button>
        ))}
      </div>

      {isLoading ? (
        <ListSkeleton rows={4} />
      ) : error ? (
        <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
      ) : total === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title={range === "today" ? "今天還沒有新增行程" : "本週還沒有新增行程"}
        />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">共 {total} 筆（重複行程整個系列算一筆）</p>
          {byDay.map(([day, items]) => (
            <section key={day}>
              {range === "week" && (
                <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
                  {day} 輸入 · {items.length} 筆
                </h2>
              )}
              <ul className="space-y-2">
                {items.map((it) => {
                  const color = calendarById.get(it.first.calendar_id)?.color ?? "#64748B";
                  return (
                    <li key={it.first.id}>
                      <button
                        type="button"
                        onClick={() => setDetail(it.first)}
                        className="w-full rounded-lg border bg-card p-3 text-left hover:bg-accent"
                        style={{ borderLeft: `4px solid ${color}` }}
                      >
                        <div className="text-sm font-medium leading-relaxed">
                          {eventSentence(summaryFromEvents(it.all, selfName))}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {fmt(it.createdAt, "M/d HH:mm")} 輸入
                          {it.creatorName ? ` · ${it.creatorName}` : ""}
                          {" · "}
                          {calendarById.get(it.first.calendar_id)?.name ?? ""}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      <EventDetailDialog
        open={!!detail}
        onOpenChange={(o) => !o && setDetail(null)}
        event={detail}
        onEdit={() => {
          setEditing(detail);
          setDetail(null);
        }}
        onChanged={() => refetch()}
      />
      <EventModal
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        mode="edit"
        event={editing ?? undefined}
        onSaved={() => refetch()}
      />
    </div>
  );
}
