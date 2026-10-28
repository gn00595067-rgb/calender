"use client";

import { useMemo, useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, CircleAlert, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { D } from "@/lib/date";
import { cn } from "@/lib/utils";

interface Lesson {
  event_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  location: string | null;
  subject_names: string[];
  my_note_count: number;
  note_count: number;
}

interface MyNote {
  id: string;
  event_id: string;
  content: string;
  progress_label: string | null;
  created_at: string;
}

const DAY = 86400000;

/**
 * 老師的課：過去 31 天到未來 7 天。上完還沒寫的排最上面。
 * 只透過 teacher_lessons() 讀課（沒有費用），回饋只讀得到自己寫的。
 */
export function TeachView({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const lessonsQ = useQuery({
    queryKey: ["teach", "lessons"],
    queryFn: async (): Promise<Lesson[]> => {
      const supabase = createClient();
      const now = Date.now();
      const { data, error } = await supabase.rpc("teacher_lessons", {
        p_from: new Date(now - 31 * DAY).toISOString(),
        p_to: new Date(now + 7 * DAY).toISOString(),
      });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
  const ids = (lessonsQ.data ?? []).map((l) => l.event_id);
  const notesQ = useQuery({
    queryKey: ["teach", "notes", ids],
    enabled: ids.length > 0,
    queryFn: async (): Promise<MyNote[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("event_notes")
        .select("id, event_id, content, progress_label, created_at")
        .eq("author_id", userId)
        .in("event_id", ids)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const groups = useMemo(() => {
    const now = new Date().toISOString();
    const all = lessonsQ.data ?? [];
    const ended = (l: Lesson) => l.ends_at <= now;
    return {
      todo: all.filter((l) => ended(l) && l.my_note_count === 0 && l.note_count === 0).reverse(),
      upcoming: all.filter((l) => !ended(l)),
      done: all.filter((l) => ended(l) && (l.my_note_count > 0 || l.note_count > 0)).reverse(),
    };
  }, [lessonsQ.data]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["teach"] });
  const notesOf = (id: string) => (notesQ.data ?? []).filter((n) => n.event_id === id);

  if (lessonsQ.isLoading) return <p className="py-8 text-center text-sm text-muted-foreground">載入中…</p>;
  if (lessonsQ.error)
    return (
      <p className="py-8 text-center text-sm text-destructive">
        讀取失敗：{(lessonsQ.error as Error).message}
      </p>
    );
  if ((lessonsQ.data ?? []).length === 0)
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        最近 31 天與未來 7 天沒有您的課。如果應該有，請跟家長確認行程的「相關人物」有選到您。
      </p>
    );

  return (
    <div className="space-y-6">
      <Section
        title={`還沒寫回饋（${groups.todo.length}）`}
        empty="都寫好了，謝謝老師！"
        lessons={groups.todo}
        tone="todo"
        notesOf={notesOf}
        userId={userId}
        onChanged={refresh}
      />
      <Section
        title="即將上課"
        empty="未來 7 天沒有課"
        lessons={groups.upcoming}
        tone="upcoming"
        notesOf={notesOf}
        userId={userId}
        onChanged={refresh}
      />
      <Section
        title="已有回饋"
        empty="還沒有"
        lessons={groups.done}
        tone="done"
        notesOf={notesOf}
        userId={userId}
        onChanged={refresh}
      />
    </div>
  );
}

function Section({
  title,
  empty,
  lessons,
  tone,
  notesOf,
  userId,
  onChanged,
}: {
  title: string;
  empty: string;
  lessons: Lesson[];
  tone: "todo" | "upcoming" | "done";
  notesOf: (id: string) => MyNote[];
  userId: string;
  onChanged: () => void;
}) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{title}</h2>
      {lessons.length === 0 ? (
        <p className="rounded-lg border bg-card p-3 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-3">
          {lessons.map((l) => (
            <LessonCard
              key={l.event_id}
              lesson={l}
              tone={tone}
              notes={notesOf(l.event_id)}
              userId={userId}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function LessonCard({
  lesson: l,
  tone,
  notes,
  userId,
  onChanged,
}: {
  lesson: Lesson;
  tone: "todo" | "upcoming" | "done";
  notes: MyNote[];
  userId: string;
  onChanged: () => void;
}) {
  const [content, setContent] = useState("");
  const [progress, setProgress] = useState("");
  const [pending, startTransition] = useTransition();
  const when = `${D.dateShort(l.starts_at)}（${D.weekday(l.starts_at).replace("週", "")}）${
    l.all_day ? "整日" : ` ${D.time(l.starts_at)}–${D.time(l.ends_at)}`
  }`;

  const submit = () =>
    startTransition(async () => {
      const text = content.trim();
      if (!text) return void toast.error("請先寫回饋內容");
      const supabase = createClient();
      const { error } = await supabase.from("event_notes").insert({
        event_id: l.event_id,
        author_id: userId,
        content: text,
        progress_label: progress.trim() || null,
      });
      if (error) return void toast.error(`送出失敗：${error.message}`);
      setContent("");
      setProgress("");
      toast.success("已送出回饋，謝謝老師");
      onChanged();
    });

  const remove = (id: string) =>
    startTransition(async () => {
      const supabase = createClient();
      const { error } = await supabase.from("event_notes").delete().eq("id", id);
      if (error) return void toast.error(`刪除失敗：${error.message}`);
      toast.success("已刪除");
      onChanged();
    });

  return (
    <li
      className={cn(
        "rounded-lg border bg-card p-3",
        tone === "todo" && "border-amber-300 dark:border-amber-800",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold tabular-nums">{when}</div>
          <div className="text-sm">{l.title}</div>
          <div className="text-xs text-muted-foreground">
            {l.subject_names.length ? `學生：${l.subject_names.join("、")}` : ""}
            {l.location ? ` · ${l.location}` : ""}
          </div>
        </div>
        {tone === "todo" ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
            <CircleAlert className="size-3.5" />
            還沒寫
          </span>
        ) : tone === "done" ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
            <CheckCircle2 className="size-3.5" />
            {l.my_note_count > 0 ? "已寫" : "已有回饋"}
          </span>
        ) : null}
      </div>

      {notes.length > 0 && (
        <div className="mt-2 space-y-2">
          {notes.map((n) => (
            <div key={n.id} className="rounded-md bg-muted/50 p-2 text-sm">
              {n.progress_label && (
                <div className="mb-1 whitespace-pre-wrap text-xs text-muted-foreground">
                  課程進度：{n.progress_label}
                </div>
              )}
              <div className="whitespace-pre-wrap">{n.content}</div>
              <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{D.dateShort(n.created_at)} {D.time(n.created_at)} 送出</span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => remove(n.id)}
                  className="inline-flex items-center gap-0.5 hover:text-destructive"
                >
                  <Trash2 className="size-3" />
                  刪除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 還沒上的課也可以先寫（例如課前就排好進度），但主要是課後填 */}
      {tone !== "upcoming" || notes.length > 0 ? (
        <div className="mt-2 space-y-2">
          <Textarea
            value={progress}
            onChange={(e) => setProgress(e.target.value)}
            rows={1}
            placeholder="課程進度（選填）：例：數學 ch3 第 2 節"
          />
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={3}
            placeholder={
              l.subject_names.length >= 2
                ? `回饋：可以分開寫 ${l.subject_names.join("、")} 各自的狀況`
                : "回饋：今天上課狀況、作業、要加強的地方"
            }
          />
          <Button type="button" size="sm" disabled={pending || !content.trim()} onClick={submit}>
            {pending ? "送出中…" : notes.length ? "再補一則回饋" : "送出回饋"}
          </Button>
        </div>
      ) : null}
    </li>
  );
}
