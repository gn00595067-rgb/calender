"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useTutorProfile } from "@/lib/client/tutor";
import { teacherAddLessonAction } from "@/lib/actions/teacher-lesson";
import { taipeiTodayStr } from "@/lib/date";
import { cn } from "@/lib/utils";

/**
 * 老師補登一堂課：行事曆上沒排到這堂（家庭老師漏排），老師一樣可以登記並寫回饋（Peggy 11/24）。
 */
export function AddLesson({ onAdded }: { onAdded: () => void }) {
  const { data: profile } = useTutorProfile();
  const students = profile?.students ?? [];
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(taipeiTodayStr());
  const [start, setStart] = useState("19:00");
  const [end, setEnd] = useState("20:30");
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [progress, setProgress] = useState("");
  const [content, setContent] = useState("");
  const [pending, startTransition] = useTransition();

  if (!open)
    return (
      <Button variant="outline" className="w-full" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        列表裡沒有今天的課？補登一堂
      </Button>
    );

  const submit = () =>
    startTransition(async () => {
      const res = await teacherAddLessonAction({ date, start, end, title, studentIds: picked, progress, content });
      if (!res.ok) return void toast.error(res.error);
      toast.success(content.trim() ? "已補登並送出回饋，謝謝老師" : "已補登，家長會收到通知");
      setOpen(false);
      setTitle("");
      setPicked([]);
      setProgress("");
      setContent("");
      onAdded();
    });

  return (
    <div className="space-y-3 rounded-xl border border-primary/40 bg-card p-3">
      <p className="text-sm font-medium">補登一堂課（家長那邊沒有排到的課）</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="col-span-2 space-y-1 sm:col-span-1">
          <Label className="text-xs">日期</Label>
          <Input type="date" value={date} max={taipeiTodayStr()} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">開始</Label>
          <Input type="time" step={300} value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">結束</Label>
          <Input type="time" step={300} value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">課名</Label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例：數學" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">學生</Label>
        <div className="flex flex-wrap gap-2">
          {students.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={picked.includes(s.id)}
              onClick={() => setPicked((p) => (p.includes(s.id) ? p.filter((x) => x !== s.id) : [...p, s.id]))}
              className={cn(
                "rounded-full border px-4 py-1.5 text-sm",
                picked.includes(s.id) ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
              )}
            >
              {s.name}
            </button>
          ))}
          {students.length === 0 && <span className="text-sm text-muted-foreground">家長還沒設定學生，請通知家長</span>}
        </div>
      </div>
      <Textarea rows={2} value={progress} onChange={(e) => setProgress(e.target.value)} placeholder="課程進度（選填）" />
      <Textarea rows={3} value={content} onChange={(e) => setContent(e.target.value)} placeholder="回饋（可以現在寫，也可以之後在這堂課下面寫）" />
      <div className="flex gap-2">
        <Button disabled={pending || !title.trim() || picked.length === 0} onClick={submit}>
          {pending ? "送出中…" : "補登"}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          取消
        </Button>
      </div>
    </div>
  );
}
