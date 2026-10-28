"use client";

import { useMemo, useState } from "react";
import { ClipboardCheck } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/app/states";
import { EventDetailDialog } from "@/components/calendar/event-detail-dialog";
import { EventModal } from "@/components/calendar/event-modal";
import { useAppData } from "@/components/app/app-data";
import { useContacts } from "@/lib/client/lookups";
import {
  EditLogUnavailable,
  useRecentEvents,
  type RecentItem,
  type RecentKind,
} from "@/lib/client/recent";
import type { CalEvent } from "@/lib/client/events";
import { eventSentence, summaryFromEvents } from "@/lib/event-summary";
import { fmt, taipeiDateStartUtcISO, taipeiTodayStr } from "@/lib/date";
import { cn } from "@/lib/utils";

type Range = "today" | "week";
/** 排序：輸入／修改時間（新→舊）、行程日期近→遠、遠→近、依分類 */
type Sort = "input" | "dateAsc" | "dateDesc" | "calendar";

/** 本週一（台北）yyyy-MM-dd */
function mondayOf(today: string): string {
  const d = new Date(`${today}T12:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - back * 86400000).toISOString().slice(0, 10);
}

function Chips<T extends string>({
  options,
  value,
  onChange,
  small,
}: {
  options: readonly { v: T; l: string }[];
  value: T;
  onChange: (v: T) => void;
  small?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={cn(
            "rounded-full border",
            small ? "px-3 py-1 text-xs" : "px-4 py-1.5 text-sm",
            value === o.v ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
          )}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}

/**
 * 新增／修改紀錄：依「輸入日」或「修改日」（不是行程日）列出今天／本週的行程，
 * 交接期第二個人可以逐筆核對，不會漏掉行程、也看得到誰改了什麼。
 * spec：docs/specs/新增確認與新增紀錄.md
 */
export default function RecentPage() {
  const [kind, setKind] = useState<RecentKind>("added");
  const [range, setRange] = useState<Range>("today");
  const [sort, setSort] = useState<Sort>("input");
  const today = taipeiTodayStr();
  const since = taipeiDateStartUtcISO(range === "today" ? today : mondayOf(today));
  const { data, isLoading, error, refetch } = useRecentEvents(since, kind);
  const { calendarById } = useAppData();
  const { data: contacts = [] } = useContacts();
  const selfName = contacts.find((c) => c.is_self)?.name ?? null;
  const [detail, setDetail] = useState<CalEvent | null>(null);
  const [editing, setEditing] = useState<CalEvent | null>(null);
  const verb = kind === "added" ? "輸入" : "修改";

  // 分組：依輸入／修改日（本週才有多天）或依分類；其他排序不分組
  const sections = useMemo((): [string, RecentItem[]][] => {
    const items = [...(data ?? [])];
    const calName = (it: RecentItem) => calendarById.get(it.first.calendar_id)?.name ?? "";
    if (sort === "dateAsc" || sort === "dateDesc") {
      items.sort((a, b) =>
        sort === "dateAsc"
          ? a.first.starts_at.localeCompare(b.first.starts_at)
          : b.first.starts_at.localeCompare(a.first.starts_at),
      );
      return [["", items]];
    }
    const m = new Map<string, RecentItem[]>();
    if (sort === "calendar") {
      items.sort(
        (a, b) =>
          calName(a).localeCompare(calName(b), "zh-TW") ||
          a.first.starts_at.localeCompare(b.first.starts_at),
      );
      for (const it of items) m.set(calName(it), [...(m.get(calName(it)) ?? []), it]);
      return [...m.entries()];
    }
    for (const it of items) {
      const k = range === "week" ? `${fmt(it.at, "M/d（EEE）")} ${verb}` : "";
      m.set(k, [...(m.get(k) ?? []), it]);
    }
    return [...m.entries()];
  }, [data, sort, range, verb, calendarById]);

  const total = data?.length ?? 0;
  const unavailable = error instanceof EditLogUnavailable;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="新增紀錄"
        description="依輸入或修改的日期列出行程，方便第二個人核對有沒有漏、有沒有改錯"
      />

      <div className="mb-3 space-y-2">
        <Chips
          options={[
            { v: "added", l: "新增紀錄" },
            { v: "edited", l: "修改紀錄" },
          ]}
          value={kind}
          onChange={setKind}
        />
        <Chips
          options={[
            { v: "today", l: kind === "added" ? "今天新增" : "今天修改" },
            { v: "week", l: kind === "added" ? "本週新增" : "本週修改" },
          ]}
          value={range}
          onChange={setRange}
        />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">排序</span>
          <Chips
            small
            options={[
              { v: "input", l: `${verb}時間` },
              { v: "dateAsc", l: "行程日期 近→遠" },
              { v: "dateDesc", l: "行程日期 遠→近" },
              { v: "calendar", l: "依分類" },
            ]}
            value={sort}
            onChange={setSort}
          />
        </div>
      </div>

      {isLoading ? (
        <ListSkeleton rows={4} />
      ) : unavailable ? (
        <EmptyState icon={ClipboardCheck} title={(error as Error).message} />
      ) : error ? (
        <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
      ) : total === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title={`${range === "today" ? "今天" : "本週"}還沒有${kind === "added" ? "新增" : "修改"}行程`}
        />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            共 {total} 筆（重複行程整個系列算一筆
            {kind === "edited" ? "；只算「編輯」存檔，不含刪除" : ""}）
          </p>
          {sections.map(([title, items]) => (
            <section key={title || "all"}>
              {title && (
                <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
                  {title} · {items.length} 筆
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
                          {fmt(it.at, "M/d HH:mm")} {verb}
                          {it.byName ? ` · ${it.byName}` : ""}
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
