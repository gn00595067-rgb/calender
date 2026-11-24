"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LearningEntry } from "@/lib/client/learning";
import { D } from "@/lib/date";

interface Summary {
  progress: string;
  perChild: { child: string; strengths: string; improve: string }[];
  todos: { who: string; item: string }[];
}

/**
 * 某位老師這個月回饋的 AI 總結：進度、各小孩好／要加強、要做的事（誰做）（Peggy 11/24）。
 * 按了才產生（用 AI 額度），不存資料庫；換月份或小孩要重新按。
 */
export function AiSummary({
  teacher,
  items,
}: {
  teacher: string;
  /** 各小孩的回饋 */
  items: { child: string; entry: LearningEntry }[];
}) {
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    try {
      const res = await fetch("/api/learning/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teacher,
          children: [...new Set(items.map((i) => i.child))],
          entries: items.slice(0, 80).map(({ child, entry }) => ({
            date: D.date(entry.eventStart),
            title: entry.eventTitle,
            progress: entry.progressLabel,
            child,
            content: [entry.shared, entry.content].filter(Boolean).join("\n"),
          })),
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "AI 總結失敗");
      setData(j);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI 總結失敗");
    } finally {
      setLoading(false);
    }
  }

  if (!data)
    return (
      <Button size="sm" variant="outline" className="h-7 print:hidden" disabled={loading || items.length === 0} onClick={run}>
        {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
        {loading ? "整理中…" : "AI 本月總結"}
      </Button>
    );

  return (
    <div className="mt-2 w-full space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm font-normal print:break-inside-avoid">
      <div className="flex items-center gap-1.5 font-semibold">
        <Sparkles className="size-3.5" />
        AI 本月總結
        <span className="text-xs font-normal text-muted-foreground">（依回饋原文整理，請以原文為準）</span>
      </div>
      <p>
        <b>進度：</b>
        {data.progress}
      </p>
      {data.perChild.map((c) => (
        <div key={c.child}>
          <b>{c.child}</b>
          {c.strengths && <div>👍 {c.strengths}</div>}
          {c.improve && <div className="text-amber-800 dark:text-amber-300">⚠ 要加強：{c.improve}</div>}
        </div>
      ))}
      <div>
        <b>要做的事</b>
        {data.todos.length === 0 ? (
          <span className="ml-1 text-muted-foreground">回饋裡沒有提到要做的事（都是上課紀錄）</span>
        ) : (
          <ul className="mt-1 space-y-0.5">
            {data.todos.map((t, i) => (
              <li key={i} className="flex gap-2">
                <span className="shrink-0 rounded bg-background px-1.5 text-xs leading-5">{t.who}</span>
                {t.item}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
