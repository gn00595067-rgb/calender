"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Mic, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAppData } from "@/components/app/app-data";
import { useContacts } from "@/lib/client/lookups";
import { searchEvents } from "@/lib/client/search";
import type { CalEvent } from "@/lib/client/events";
import { deleteEventAction } from "@/lib/actions/events";
import { eventSentence, summaryFromEvents } from "@/lib/event-summary";
import { addMinutesToWall } from "@/lib/wall-time";
import { taipeiTodayStr, utcToTaipeiWall } from "@/lib/date";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { EventDraft } from "@/components/calendar/event-modal";

/** 語音「修改／刪除」的解析結果（route.ts） */
export interface VoiceTargetRequest {
  intent: "modify" | "delete";
  transcript: string;
  query: string;
  rangeStart: string | null;
  rangeEnd: string | null;
  scope: "one" | "series";
  changes: {
    title: string | null;
    date: string | null;
    startTime: string | null;
    endTime: string | null;
    shiftMinutes: number | null;
    location: string | null;
  } | null;
}

/** 候選：同系列合成一個，anchor＝範圍內第一筆（刪除／修改「之後全部」從這筆算起） */
interface Candidate {
  key: string;
  anchor: CalEvent;
  /** 範圍內的同系列行程 */
  inRange: CalEvent[];
}

/**
 * 語音改／刪行程：依關鍵字＋日期範圍找出候選，使用者點選要哪一筆（重複行程可選只這次或之後全部），
 * 刪除在這裡直接確認；修改則帶入新時間／地點後開「編輯行程」讓使用者按儲存。
 * 不會在沒確認的情況下改動資料。spec：docs/specs/語音-修改與刪除行程.md
 */
export function VoiceTargetDialog({
  request,
  onClose,
  onEdit,
  onDone,
}: {
  request: VoiceTargetRequest | null;
  onClose: () => void;
  /** 修改：開編輯表單（event＝要改的那筆，draft＝要改的欄位） */
  onEdit: (event: CalEvent, draft: EventDraft) => void;
  onDone?: () => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const { calendars, calendarById } = useAppData();
  const { data: contacts = [] } = useContacts();
  const selfName = contacts.find((c) => c.is_self)?.name ?? null;
  const editableIds = calendars.filter((c) => can.editEvents(c.effectiveRole)).map((c) => c.id);
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const [scopePick, setScopePick] = useState<"one" | "series" | null>(null);
  const [pending, startTransition] = useTransition();

  // 沒講日期時只找今天以後的（要改／刪的通常是還沒發生的行程）
  const startDate = request?.rangeStart ?? taipeiTodayStr();
  const { data: results = [], isLoading } = useQuery({
    queryKey: ["voice-target", request?.query, startDate, request?.rangeEnd, editableIds],
    queryFn: () =>
      searchEvents({
        q: request!.query,
        calendarIds: editableIds,
        startDate,
        endDate: request!.rangeEnd,
      }),
    enabled: !!request && !!request.query.trim(),
  });

  const candidates: Candidate[] = [];
  const byKey = new Map<string, Candidate>();
  for (const e of results) {
    const key = e.recurrence_group_id ?? e.id;
    const c = byKey.get(key);
    if (c) c.inRange.push(e);
    else {
      const nc = { key, anchor: e, inRange: [e] };
      byKey.set(key, nc);
      candidates.push(nc);
    }
  }
  const shown = candidates.slice(0, 8);
  const picked =
    shown.find((c) => c.key === pickedKey) ?? (shown.length === 1 ? shown[0] : null);
  const isSeries = !!picked?.anchor.recurrence_group_id;
  const scope = scopePick ?? request?.scope ?? "one";
  const isDelete = request?.intent === "delete";

  function close() {
    setPickedKey(null);
    setScopePick(null);
    onClose();
  }

  function doDelete() {
    if (!picked) return;
    const s = isSeries && scope === "series" ? "following" : "this";
    const sentence = eventSentence(
      summaryFromEvents(s === "following" ? picked.inRange : [picked.anchor], selfName),
    );
    startTransition(async () => {
      const res = await deleteEventAction(picked.anchor.id, s);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(s === "following" ? "已刪除這次與之後全部" : "已刪除行程", {
        description: sentence,
        duration: 10000,
      });
      await qc.invalidateQueries({ queryKey: ["events"] });
      router.refresh();
      onDone?.();
      close();
    });
  }

  function doEdit() {
    if (!picked || !request) return;
    const ev = picked.anchor;
    const c = request.changes;
    const oldStart = utcToTaipeiWall(ev.starts_at);
    const oldEnd = utcToTaipeiWall(ev.ends_at);
    const durMin = Math.round((+new Date(ev.ends_at) - +new Date(ev.starts_at)) / 60000);
    let startWall = oldStart;
    let endWall = oldEnd;
    if (c?.date || c?.startTime || c?.endTime || c?.shiftMinutes) {
      const date = c.date ?? oldStart.slice(0, 10);
      if (c.startTime) startWall = `${date}T${c.startTime}`;
      else if (c.shiftMinutes) startWall = addMinutesToWall(`${date}T${oldStart.slice(11)}`, c.shiftMinutes);
      else startWall = `${date}T${oldStart.slice(11)}`;
      endWall = c.endTime
        ? `${startWall.slice(0, 10)}T${c.endTime}`
        : addMinutesToWall(startWall, durMin);
    }
    onEdit(ev, {
      title: c?.title ?? undefined,
      location: c?.location ?? undefined,
      startWall,
      endWall,
      scope: isSeries && scope === "series" ? "following" : "this",
      voice: { transcript: request.transcript, warnings: [], fromHabit: [], assumptions: [] },
    });
    close();
  }

  const searchHref = `/search?q=${encodeURIComponent(request?.query ?? "")}${
    request?.rangeStart ? `&from=${request.rangeStart}` : ""
  }${request?.rangeEnd ? `&to=${request.rangeEnd}` : ""}`;

  return (
    <Dialog open={!!request} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isDelete ? "要刪除哪一個行程？" : "要修改哪一個行程？"}</DialogTitle>
          <DialogDescription className="flex items-start gap-1.5">
            <Mic className="mt-0.5 size-3.5 shrink-0" />「{request?.transcript}」
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> 找行程中…
          </div>
        ) : shown.length === 0 ? (
          <div className="space-y-3 py-2 text-sm">
            <p>
              找不到符合「{request?.query}」
              {request?.rangeStart ? `（${request.rangeStart}${request.rangeEnd ? ` ~ ${request.rangeEnd}` : " 之後"}）` : "（今天之後）"}
              的行程。
            </p>
            <Button variant="outline" onClick={() => { close(); router.push(searchHref); }}>
              <Search className="size-4" /> 到搜尋頁自己找
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {shown.length > 1 && (
              <p className="text-xs text-muted-foreground">找到 {shown.length} 個，點選要{isDelete ? "刪除" : "修改"}的那一個：</p>
            )}
            <ul className="space-y-2">
              {shown.map((c) => {
                const active = picked?.key === c.key;
                const color = calendarById.get(c.anchor.calendar_id)?.color ?? "#64748B";
                return (
                  <li key={c.key}>
                    <button
                      type="button"
                      onClick={() => setPickedKey(c.key)}
                      className={cn(
                        "w-full rounded-lg border p-3 text-left text-sm",
                        active ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-accent",
                      )}
                      style={{ borderLeft: `4px solid ${color}` }}
                    >
                      <div className="font-medium leading-relaxed">
                        {eventSentence(summaryFromEvents(c.inRange, selfName))}
                      </div>
                      {c.anchor.recurrence_group_id && (
                        <div className="mt-0.5 text-xs text-muted-foreground">重複行程</div>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            {candidates.length > shown.length && (
              <p className="text-xs text-muted-foreground">
                還有 {candidates.length - shown.length} 個沒列出，請講得更明確（例如加日期）。
              </p>
            )}

            {picked && isSeries && (
              <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                <div className="mb-2 text-xs text-muted-foreground">這是重複行程，要{isDelete ? "刪除" : "修改"}：</div>
                <div className="flex flex-col gap-2">
                  {(
                    [
                      { v: "one", l: `只有 ${utcToTaipeiWall(picked.anchor.starts_at).slice(5, 10).replace("-", "/")} 這一次` },
                      { v: "series", l: `${utcToTaipeiWall(picked.anchor.starts_at).slice(5, 10).replace("-", "/")} 起之後全部` },
                    ] as const
                  ).map((o) => (
                    <label key={o.v} className="flex items-center gap-2">
                      <input type="radio" checked={scope === o.v} onChange={() => setScopePick(o.v)} />
                      {o.l}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={pending}>
            取消
          </Button>
          {shown.length > 0 && (
            <Button
              variant={isDelete ? "destructive" : "default"}
              disabled={!picked || pending}
              onClick={isDelete ? doDelete : doEdit}
            >
              {pending ? "處理中…" : isDelete ? "確認刪除" : "帶入修改"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
