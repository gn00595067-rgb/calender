"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { useAppData } from "@/components/app/app-data";
import { fetchActivity, fetchSeenAt, markActivitySeen, type ActivityItem } from "@/lib/client/activity";
import { fmt } from "@/lib/date";
import { cn } from "@/lib/utils";

const KIND = {
  added: { label: "新增", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  edited: { label: "修改", cls: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300" },
  note: { label: "回饋", cls: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
} as const;

/**
 * 新增紀錄頁最上面：上次看過之後，別人新增／修改的行程與寫的回饋，逐筆列出是誰（Peggy 11/24）。
 * 打開這頁就算看過（紅點數字歸零），這次打開的清單仍照上次查看的時間列。
 */
export function ActivityFeed({ onOpen }: { onOpen: (eventId: string) => void }) {
  const { me } = useAppData();
  const qc = useQueryClient();
  const sinceRef = useRef<string | null | undefined>(undefined);
  const [since, setSince] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (sinceRef.current !== undefined) return;
    sinceRef.current = null;
    void fetchSeenAt(me.id).then(async (s) => {
      setSince(s);
      if (s) {
        await markActivitySeen(me.id);
        qc.invalidateQueries({ queryKey: ["activity", "count"] });
      }
    });
  }, [me.id, qc]);

  const q = useQuery({
    queryKey: ["activity", "feed", me.id, since],
    enabled: !!since,
    queryFn: () => fetchActivity(me.id, since!),
  });
  if (since === undefined || since === null) return null;
  const items: ActivityItem[] = q.data ?? [];

  return (
    <section className="mb-6 rounded-xl border bg-card p-3">
      <h2 className="mb-2 flex items-center gap-2 font-bold">
        <Bell className="size-4" />
        上次查看後的更新
        <span className="text-sm font-normal text-muted-foreground">
          （{fmt(since, "M/d HH:mm")} 之後，{q.isLoading ? "…" : `${items.length} 則`}）
        </span>
      </h2>
      {q.isLoading ? null : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">沒有新的更新。</p>
      ) : (
        <ul className="divide-y">
          {items.map((it, i) => (
            <li key={`${it.kind}-${it.eventId}-${i}`}>
              <button
                type="button"
                onClick={() => onOpen(it.eventId)}
                className="flex w-full items-start gap-2 py-2 text-left text-sm hover:bg-accent/50"
              >
                <span className={cn("mt-0.5 shrink-0 rounded px-1.5 text-xs font-medium", KIND[it.kind].cls)}>
                  {KIND[it.kind].label}
                </span>
                <span className="min-w-0 flex-1">
                  <b>{it.byName}</b>
                  {it.kind === "note" ? " 寫了回饋：" : it.kind === "added" ? " 新增：" : " 修改：" }
                  {fmt(it.startsAt, "M/d")} {it.title}
                  {it.text && (
                    <span className="block truncate text-muted-foreground">{it.text.replace(/\s+/g, " ")}</span>
                  )}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{fmt(it.at, "M/d HH:mm")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
