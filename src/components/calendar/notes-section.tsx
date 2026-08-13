"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MessageSquare, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useAppData } from "@/components/app/app-data";
import { useEventNotes } from "@/lib/client/notes";
import { createNoteAction, deleteNoteAction } from "@/lib/actions/notes";
import { D } from "@/lib/date";

export function NotesSection({
  eventId,
  canAdd,
}: {
  eventId: string;
  canAdd: boolean;
}) {
  const { me } = useAppData();
  const { data: notes = [], isLoading } = useEventNotes(eventId);
  const qc = useQueryClient();
  const router = useRouter();
  const [content, setContent] = useState("");
  const [progress, setProgress] = useState("");
  const [pending, startTransition] = useTransition();

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["notes", eventId] }),
      qc.invalidateQueries({ queryKey: ["events"] }),
    ]);
    router.refresh();
  };

  const submit = () => {
    if (!content.trim()) return;
    startTransition(async () => {
      const res = await createNoteAction({
        eventId,
        content: content.trim(),
        progressLabel: progress.trim() || null,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setContent("");
      setProgress("");
      toast.success("已新增回饋");
      await refresh();
    });
  };

  const remove = (id: string) => {
    startTransition(async () => {
      const res = await deleteNoteAction(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      await refresh();
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-sm font-semibold">
        <MessageSquare className="size-4" />
        回饋與筆記
        {notes.length > 0 && (
          <span className="text-muted-foreground">（{notes.length}）</span>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">載入中…</p>
      ) : notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">尚無回饋。</p>
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-lg border bg-card p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{n.authorName}</span>
                <span>{D.full(n.created_at)}</span>
                {n.progress_label && (
                  <Badge variant="outline" className="ml-auto">
                    {n.progress_label}
                  </Badge>
                )}
                {n.author_id === me.id && (
                  <button
                    type="button"
                    onClick={() => remove(n.id)}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="刪除回饋"
                    disabled={pending}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-sm">{n.content}</p>
            </li>
          ))}
        </ul>
      )}

      {canAdd && (
        <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="填寫本次回饋（例：三角函數 ch3 完成，作業正確率 8 成）"
            rows={2}
          />
          <div className="flex gap-2">
            <Input
              value={progress}
              onChange={(e) => setProgress(e.target.value)}
              placeholder="進度摘要（選填）"
              className="h-9"
            />
            <Button onClick={submit} disabled={pending || !content.trim()} className="shrink-0">
              送出回饋
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
