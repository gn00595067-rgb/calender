"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Mic, Loader2, Sparkles, Square } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useSpeech } from "@/lib/voice/use-speech";
import { useAppData } from "@/components/app/app-data";
import { can } from "@/lib/permissions";
import { EventModal, type EventDraft } from "@/components/calendar/event-modal";
import { VoiceTargetDialog, type VoiceTargetRequest } from "./voice-target-dialog";
import type { CalEvent } from "@/lib/client/events";
import { taipeiNowWall, taipeiNowHuman } from "@/lib/date";
import { cn } from "@/lib/utils";

/** API 回傳的一筆行程（route.ts normalizeEvent） */
interface ParsedEvent {
  calendarId: string;
  title: string;
  allDay: boolean;
  startWall: string | null;
  endWall: string | null;
  location: string | null;
  isImportant: boolean;
  subjectIds: string[];
  participantIds: string[];
  tagNames: string[];
  needsDriver: boolean;
  isLesson: boolean;
  recurrence: NonNullable<EventDraft["recurrence"]>;
  weekdays: number[];
  recurrenceUntil: string | null;
  extraDates: string[];
  fromHabit: string[];
  assumptions: string[];
  warnings: string[];
  note: string;
}

/**
 * 語音助理：說（或用鍵盤麥克風／打字輸入）一句話，交給 Claude 先判斷意圖：
 *   - 新增：解析成結構化欄位，開啟「新增行程」對話框讓使用者確認後送出；
 *     一句話講了多件事會拆成多筆，存好一筆自動帶下一筆。
 *     助理有疑問時，可在表單上「用語音回答」直接更新，不必手動改選單。
 *   - 搜尋：抽出關鍵字後導到搜尋頁。
 * spec：docs/specs/語音-多筆行程與追問.md
 */
export function VoiceAddButton({
  variant = "icon",
  className,
  onSaved,
}: {
  /** icon：只顯示麥克風圖示（給頂部列用）；full：圖示＋文字。 */
  variant?: "icon" | "full";
  className?: string;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const { ownedCalendars, sharedCalendars } = useAppData();
  const editable = [...ownedCalendars, ...sharedCalendars].filter((c) =>
    can.editEvents(c.effectiveRole),
  );
  const canCreate = editable.length > 0;

  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  /** 還沒帶入的後續幾筆 */
  const [queue, setQueue] = useState<EventDraft[]>([]);
  /** 語音改／刪：要找的行程 */
  const [target, setTarget] = useState<VoiceTargetRequest | null>(null);
  /** 語音修改：選好行程後開編輯表單 */
  const [editing, setEditing] = useState<{ event: CalEvent; draft: EventDraft } | null>(null);
  /** 這次關閉表單是因為存檔成功（表單先關閉、後呼叫 onSaved） */
  const savedRef = useRef(false);
  /** 使用者自己按停止（要再改字）→ 不自動送出 */
  const manualStopRef = useRef(false);

  // 語音：按下語音助理就開始聽；停頓 4 秒沒講話自動結束並送出解析
  const speech = useSpeech({
    silenceMs: 4000,
    onInterim: (t) => setText(t),
    onFinal: (t) => {
      setText(t);
      if (!manualStopRef.current) void submit(t);
    },
    onError: (code) => {
      if (code === "not-allowed" || code === "service-not-allowed") {
        toast.error("麥克風被拒絕，請在瀏覽器允許麥克風權限");
      } else if (code === "audio-capture") {
        toast.error("抓不到麥克風，可能被其他 App 占用，請再按一次麥克風");
      } else if (code === "network") {
        toast.error("語音辨識需要網路，請確認連線後再試");
      }
    },
  });

  if (!canCreate) return null;

  /** 開語音助理並直接開始聽（在點擊當下啟動，手機瀏覽器才允許收音） */
  function openVoice() {
    setText("");
    setOpen(true);
    if (speech.supported) {
      manualStopRef.current = false;
      speech.start("");
    }
  }

  function toggleListen() {
    if (speech.listening) {
      manualStopRef.current = true;
      speech.stop();
    } else {
      manualStopRef.current = false;
      speech.start(text);
    }
  }

  function closeVoice(o: boolean) {
    if (!o) {
      manualStopRef.current = true;
      speech.stop();
    }
    setOpen(o);
  }

  const calendars = editable.map((c) => ({ id: c.id, name: c.name }));

  async function callParse(body: Record<string, unknown>) {
    const res = await fetch("/api/voice/parse-event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        calendars,
        nowWall: taipeiNowWall(),
        nowHuman: taipeiNowHuman(),
        ...body,
      }),
    });
    const data = await res.json();
    return { ok: res.ok, data };
  }

  /** API 的一筆 → 表單草稿；transcript 用原句，追問時也保留 */
  function toDraft(
    ev: ParsedEvent,
    transcript: string,
    position: { index: number; total: number },
  ): EventDraft {
    const d: EventDraft = {
      calendarId: ev.calendarId,
      title: ev.title,
      location: ev.location ?? undefined,
      allDay: ev.allDay,
      startWall: ev.startWall ?? undefined,
      endWall: ev.endWall ?? undefined,
      isImportant: ev.isImportant,
      subjectIds: ev.subjectIds,
      participantIds: ev.participantIds,
      tagNames: ev.tagNames,
      needsDriver: ev.needsDriver,
      isLesson: ev.isLesson,
      recurrence: ev.recurrence,
      recurrenceWeekdays: ev.weekdays,
      recurrenceUntil: ev.recurrenceUntil ?? undefined,
      recurrenceDates: ev.extraDates ?? [],
      voice: {
        transcript,
        warnings: ev.warnings ?? [],
        fromHabit: ev.fromHabit ?? [],
        assumptions: [...(ev.assumptions ?? []), ...(ev.note ? [ev.note] : [])],
        position,
      },
    };
    // 用語音回答問題：以表單現值＋回答請 AI 更新這一筆，換上新草稿（表單會重新帶入）
    d.voice!.onAnswer = async (answer, current) => {
      try {
        const { ok, data } = await callParse({
          transcript: answer,
          followUp: { original: transcript, current, questions: d.voice!.warnings },
        });
        if (!ok) return data?.error ?? "更新失敗，請再說一次";
        setDraft(toDraft(data.events[0], transcript, position));
        return null;
      } catch {
        return "網路錯誤，請再試一次";
      }
    };
    return d;
  }

  function openNext(list: EventDraft[]) {
    const [next, ...rest] = list;
    if (!next) return;
    setDraft(next);
    setQueue(rest);
    setModalOpen(true);
  }

  function handleModalOpenChange(o: boolean) {
    setModalOpen(o);
    if (o) return;
    // 等 onSaved（在關閉之後才被呼叫）再判斷
    setTimeout(() => {
      const saved = savedRef.current;
      savedRef.current = false;
      if (queue.length === 0) {
        // 存好最後一筆：給一顆「再說一筆」，按了直接開始聽
        if (saved) {
          toast.success("已新增，要再說一筆嗎？", {
            duration: 10000,
            action: { label: "🎤 再說一筆", onClick: openVoice },
          });
        }
        return;
      }
      if (saved) {
        openNext(queue);
        return;
      }
      // 沒存就關掉：不自動跳下一筆，但給一顆按鈕可以繼續
      const rest = queue;
      toast.message(`還有 ${rest.length} 筆語音行程沒建立`, {
        description: rest.map((d) => d.title).join("、"),
        duration: 15000,
        action: { label: "建立下一筆", onClick: () => openNext(rest) },
      });
    }, 300);
  }

  async function submit(spoken?: string) {
    const transcript = (spoken ?? text).trim();
    if (!transcript || loading) return;
    setLoading(true);
    try {
      const { ok, data } = await callParse({ transcript });
      if (!ok) {
        toast.error(data?.error ?? "解析失敗，請再試一次");
        return;
      }

      // 搜尋意圖：關掉對話框、導到搜尋頁（有講日期就帶範圍）
      if (data.intent === "search") {
        setOpen(false);
        setText("");
        if (data.note) toast.message(data.note);
        const range = `${data.rangeStart ? `&from=${data.rangeStart}` : ""}${data.rangeEnd ? `&to=${data.rangeEnd}` : ""}`;
        router.push(`/search?q=${encodeURIComponent(data.query)}${range}`);
        return;
      }

      // 改／刪既有行程：先找出候選讓使用者點選確認
      if (data.intent === "modify" || data.intent === "delete") {
        setOpen(false);
        setText("");
        setTarget({ ...data, transcript });
        return;
      }

      // 新增意圖：逐筆帶入「新增行程」對話框；提示顯示在表單頂端的語音面板
      const events: ParsedEvent[] = data.events ?? [];
      const drafts = events.map((ev, i) =>
        toDraft(ev, transcript, { index: i + 1, total: events.length }),
      );
      if (drafts.length > 1) toast.message(`聽到 ${drafts.length} 個行程，會一筆一筆讓你確認`);
      setOpen(false);
      setText("");
      savedRef.current = false;
      openNext(drafts);
    } catch {
      toast.error("網路錯誤，請再試一次");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {variant === "icon" ? (
        <Button
          variant="outline"
          size="icon"
          className={cn("h-9 w-9 touch:size-11", className)}
          onClick={openVoice}
          aria-label="語音助理（搜尋或新增行程）"
          title="語音助理（搜尋或新增行程）"
        >
          <Mic className="size-4" />
        </Button>
      ) : (
        <Button
          variant="outline"
          className={cn("gap-2", className)}
          onClick={openVoice}
        >
          <Mic className="size-4" />
          語音助理
        </Button>
      )}

      {/* 語音／文字輸入對話框 */}
      <Dialog open={open} onOpenChange={closeVoice}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              語音助理
            </DialogTitle>
            <DialogDescription>
              直接講，停頓 4 秒會自動送出。講得越完整越準：誰、什麼時間、做什麼、跟誰、在哪、要不要司機。
              例如「週二晚上六點哥哥桌球，郭老師，要司機接送」。也可以修改、刪除或搜尋行程。
            </DialogDescription>
          </DialogHeader>

          {speech.supported && (
            <div className="flex flex-col items-center gap-2 py-1">
              <button
                type="button"
                onClick={toggleListen}
                disabled={loading}
                aria-pressed={speech.listening}
                aria-label={speech.listening ? "停止收音" : "開始講話"}
                className={cn(
                  "flex size-20 items-center justify-center rounded-full border-2 transition disabled:opacity-40",
                  speech.listening
                    ? "animate-pulse border-red-500 bg-red-500 text-white"
                    : "border-primary bg-primary/10 text-primary hover:bg-primary/20",
                )}
              >
                {speech.listening ? <Square className="size-7 fill-current" /> : <Mic className="size-9" />}
              </button>
              <p className="text-sm text-muted-foreground">
                {loading
                  ? "解析中…"
                  : speech.listening
                    ? "正在聽…講完停一下就會送出（點紅鈕改成手動）"
                    : text
                      ? "點麥克風可以接著補充"
                      : "點麥克風開始講"}
              </p>
            </div>
          )}

          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder="也可以打字：週二晚上六點哥哥桌球，要司機接送"
            rows={3}
            // 支援語音時不自動聚焦：手機鍵盤彈出會蓋住麥克風
            autoFocus={!speech.supported}
          />

          <DialogFooter>
            <Button variant="outline" onClick={() => closeVoice(false)} disabled={loading}>
              取消
            </Button>
            <Button
              onClick={() => {
                manualStopRef.current = true;
                speech.stop();
                void submit();
              }}
              disabled={loading || !text.trim()}
            >
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  解析中…
                </>
              ) : (
                "解析並帶入"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <VoiceTargetDialog
        request={target}
        onClose={() => setTarget(null)}
        onEdit={(event, d) => setEditing({ event, draft: d })}
        onDone={onSaved}
      />
      <EventModal
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        mode="edit"
        event={editing?.event}
        draft={editing?.draft}
        onSaved={onSaved}
      />

      {/* 帶入解析結果的「新增行程」對話框，供確認後送出 */}
      <EventModal
        open={modalOpen}
        onOpenChange={handleModalOpenChange}
        mode="create"
        draft={draft ?? undefined}
        onSaved={() => {
          savedRef.current = true;
          onSaved?.();
        }}
      />
    </>
  );
}
