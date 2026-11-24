"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { deleteScore, saveScore, type ScoreDraft } from "@/lib/client/scores";
import { cn } from "@/lib/utils";

/** 登記／修改一筆成績（家長、家庭老師、老師共用） */
export function ScoreDialog({
  draft,
  ownerId,
  userId,
  students,
  subjects,
  onClose,
  onSaved,
}: {
  draft: ScoreDraft | null;
  ownerId: string;
  userId: string;
  students: { id: string; name: string }[];
  /** 科目建議（點了帶入，也可以自己打） */
  subjects: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [v, setV] = useState<ScoreDraft | null>(draft);
  const [pending, startTransition] = useTransition();
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 每次打開帶入
  useEffect(() => setV(draft), [draft]);
  const set = <K extends keyof ScoreDraft>(k: K, val: ScoreDraft[K]) => setV((p) => (p ? { ...p, [k]: val } : p));

  const save = () =>
    startTransition(async () => {
      if (!v) return;
      const err = await saveScore(ownerId, userId, v);
      if (err) return void toast.error(err);
      toast.success("已登記成績");
      onSaved();
    });
  const remove = () =>
    startTransition(async () => {
      if (!v?.id || !window.confirm("確定刪除這筆成績？")) return;
      const err = await deleteScore(v.id);
      if (err) return void toast.error(err);
      toast.success("已刪除");
      onSaved();
    });

  return (
    <Dialog open={!!draft} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{v?.id ? "修改成績" : "登記成績"}</DialogTitle>
          <DialogDescription>小考、週考、期中考、學校評分都可以記，儀表板會畫出趨勢。</DialogDescription>
        </DialogHeader>
        {v && (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">學生</Label>
              <div className="flex flex-wrap gap-2">
                {students.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={v.studentId === s.id}
                    onClick={() => set("studentId", s.id)}
                    className={cn(
                      "rounded-full border px-4 py-1.5 text-sm",
                      v.studentId === s.id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
                    )}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="sc-subject" className="text-xs">科目</Label>
              <Input id="sc-subject" value={v.subject} onChange={(e) => set("subject", e.target.value)} placeholder="例：數學" />
              {subjects.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {subjects.map((s) => (
                    <button key={s} type="button" onClick={() => set("subject", s)} className="rounded-full border px-2 py-0.5 text-xs hover:bg-accent">
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="sc-date" className="text-xs">日期</Label>
                <Input id="sc-date" type="date" value={v.testDate} onChange={(e) => set("testDate", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sc-label" className="text-xs">名稱</Label>
                <Input id="sc-label" value={v.label} onChange={(e) => set("label", e.target.value)} placeholder="例：U3 小考、期中考" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sc-score" className="text-xs">分數</Label>
                <Input id="sc-score" inputMode="decimal" value={v.score} onChange={(e) => set("score", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sc-full" className="text-xs">滿分</Label>
                <Input id="sc-full" inputMode="decimal" value={v.fullScore} onChange={(e) => set("fullScore", e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="sc-note" className="text-xs">備註（選填）</Label>
              <Input id="sc-note" value={v.note} onChange={(e) => set("note", e.target.value)} placeholder="例：計算粗心扣 6 分" />
            </div>
          </div>
        )}
        <DialogFooter>
          {v?.id && (
            <Button variant="ghost" className="mr-auto text-destructive" disabled={pending} onClick={remove}>
              刪除
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button disabled={pending} onClick={save}>
            儲存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
