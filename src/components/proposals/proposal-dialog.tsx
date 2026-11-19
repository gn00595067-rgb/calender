"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { submitProposalAction } from "@/lib/actions/proposals";
import type { BusyBlock, FreebusyCalendar } from "@/lib/client/proposals";
import { travelPadding } from "@/lib/availability";
import { taipeiWallToUtcISO } from "@/lib/date";
import { cn } from "@/lib/utils";

export interface ProposalForm {
  /** 修改自己待審核的那筆 */
  id?: string;
  calendarId: string;
  title: string;
  date: string;
  start: string;
  end: string;
  location: string;
  note: string;
}

/** 提議行程表單（只看空檔的人用）：送出後等擁有者審核 */
export function ProposalDialog({
  form,
  calendars,
  ownerName,
  busy = [],
  onClose,
  onSaved,
}: {
  form: ProposalForm | null;
  calendars: FreebusyCalendar[];
  ownerName: string;
  /** 忙碌時段：撞到時提醒（仍可送，由擁有者決定） */
  busy?: BusyBlock[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [v, setV] = useState<ProposalForm | null>(form);
  const [pending, startTransition] = useTransition();
  /** 伺服器說撞到（畫面上的忙碌時段可能過期），再按一次就照送 */
  const [forceBusy, setForceBusy] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 每次打開帶入新的空檔
    setV(form);
    setForceBusy(false);
  }, [form]);

  // 撞到忙碌時段（含司機車程）：只提醒「已有行程」，不說是什麼事
  const clash = (() => {
    if (!v || !v.date || v.end <= v.start) return false;
    const s = Date.parse(taipeiWallToUtcISO(`${v.date}T${v.start}`));
    const e = Date.parse(taipeiWallToUtcISO(`${v.date}T${v.end}`));
    return busy.some((b) => {
      if (b.all_day) return false;
      const pad = travelPadding(b);
      return Date.parse(b.starts_at) - pad.before * 60000 < e && Date.parse(b.ends_at) + pad.after * 60000 > s;
    });
  })();
  const allowBusy = clash || forceBusy;

  const set = <K extends keyof ProposalForm>(k: K, val: ProposalForm[K]) =>
    setV((prev) => (prev ? { ...prev, [k]: val } : prev));

  function submit() {
    if (!v) return;
    if (!v.title.trim()) return toast.error("請填標題");
    if (v.end <= v.start) return toast.error("結束時間要晚於開始時間");
    startTransition(async () => {
      const res = await submitProposalAction({ ...v, allowBusy });
      if (!res.ok) {
        if (res.error.includes("仍要送出")) setForceBusy(true);
        toast.error(res.error);
        return;
      }
      toast.success(
        res.data.notified ? `已送出，已通知 ${ownerName} 審核` : `已送出，等 ${ownerName} 審核`,
      );
      onSaved();
    });
  }

  return (
    <Dialog open={!!form} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{v?.id ? "修改提議" : "提議行程"}</DialogTitle>
          <DialogDescription>送出後要等 {ownerName} 審核，核准了才會變成正式行程。</DialogDescription>
        </DialogHeader>
        {v && (
          <div className="space-y-3">
            {calendars.length > 1 && (
              <div className="space-y-1.5">
                <Label>放在哪個分類</Label>
                <div className="flex flex-wrap gap-2">
                  {calendars.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => set("calendarId", c.id)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm",
                        v.calendarId === c.id && "border-primary bg-primary text-primary-foreground",
                      )}
                    >
                      <span className="size-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="pp-title">標題</Label>
              <Input id="pp-title" value={v.title} onChange={(e) => set("title", e.target.value)} placeholder="例：和王董午餐" />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div className="col-span-2 space-y-1.5 sm:col-span-1">
                <Label htmlFor="pp-date">日期</Label>
                <Input id="pp-date" type="date" value={v.date} onChange={(e) => set("date", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pp-start">開始</Label>
                <Input id="pp-start" type="time" step={300} value={v.start} onChange={(e) => set("start", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pp-end">結束</Label>
                <Input id="pp-end" type="time" step={300} value={v.end} onChange={(e) => set("end", e.target.value)} />
              </div>
            </div>
            {allowBusy && (
              <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                此時段 {ownerName} 已有行程（看不到是什麼事）。仍可送出，由 {ownerName} 決定要不要挪。
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="pp-loc">地點（選填）</Label>
              <Input id="pp-loc" value={v.location} onChange={(e) => set("location", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pp-note">給 {ownerName} 的備註（選填）</Label>
              <Textarea id="pp-note" rows={3} value={v.note} onChange={(e) => set("note", e.target.value)} placeholder="例：對方希望這週見面，可以改時間" />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            取消
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? "送出中…" : allowBusy ? "仍要送出" : "送出提議"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
