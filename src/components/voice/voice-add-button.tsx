"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Mic, Loader2, Sparkles } from "lucide-react";
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
import { MicButton } from "./mic-button";
import { useAppData } from "@/components/app/app-data";
import { can } from "@/lib/permissions";
import { EventModal, type EventDraft } from "@/components/calendar/event-modal";
import { taipeiNowWall, taipeiNowHuman } from "@/lib/date";
import { cn } from "@/lib/utils";

/**
 * 語音新增行程：說（或用鍵盤麥克風／打字輸入）一句話，交給 Claude 解析成
 * 結構化欄位，再開啟「新增行程」對話框讓使用者確認後送出。
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

  if (!canCreate) return null;

  async function submit() {
    const transcript = text.trim();
    if (!transcript || loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/voice/parse-event", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          transcript,
          calendars: editable.map((c) => ({ id: c.id, name: c.name })),
          nowWall: taipeiNowWall(),
          nowHuman: taipeiNowHuman(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error ?? "解析失敗，請再試一次");
        return;
      }
      setDraft({
        calendarId: data.calendarId,
        title: data.title,
        location: data.location ?? undefined,
        allDay: data.allDay,
        startWall: data.startWall,
        endWall: data.endWall,
        isImportant: data.isImportant,
      });
      setOpen(false);
      setText("");
      setModalOpen(true);
      if (data.note) toast.message(data.note);
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
          onClick={() => setOpen(true)}
          aria-label="語音新增行程"
          title="語音新增行程"
        >
          <Mic className="size-4" />
        </Button>
      ) : (
        <Button
          variant="outline"
          className={cn("gap-2", className)}
          onClick={() => setOpen(true)}
        >
          <Mic className="size-4" />
          語音新增
        </Button>
      )}

      {/* 語音／文字輸入對話框 */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              語音新增行程
            </DialogTitle>
            <DialogDescription>
              說一句話，例如「明天下午三點跟客戶開會兩小時」。也可直接用鍵盤上的
              🎤 聽寫，或手動打字。解析後會帶入「新增行程」讓你確認。
            </DialogDescription>
          </DialogHeader>

          <div className="relative">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder="例：下週一早上十點在公司開產品會議一小時"
              rows={3}
              autoFocus
              className="pr-11"
            />
            <div className="absolute right-2 top-2">
              <MicButton
                title="開始語音辨識"
                onInterim={(t) => setText(t)}
                onFinal={(t) => setText(t)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
              取消
            </Button>
            <Button onClick={() => void submit()} disabled={loading || !text.trim()}>
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

      {/* 帶入解析結果的「新增行程」對話框，供確認後送出 */}
      <EventModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        mode="create"
        draft={draft ?? undefined}
        onSaved={onSaved}
      />
    </>
  );
}
