"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/states";
import { ColorPicker } from "@/components/app/color-picker";
import { useAppData } from "@/components/app/app-data";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  CALENDAR_KINDS,
  CALENDAR_KIND_LABEL,
  KIND_DEFAULT_COLOR,
  type CalendarKind,
} from "@/lib/constants";
import {
  createCalendarAction,
  updateCalendarAction,
  deleteCalendarAction,
  moveCalendarAction,
} from "@/lib/actions/calendars";
import type { AccessibleCalendar } from "@/types/domain";

export default function CalendarsSettingsPage() {
  const { ownedCalendars } = useAppData();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [editing, setEditing] = useState<AccessibleCalendar | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<AccessibleCalendar | null>(null);

  const refresh = () => router.refresh();

  const onMove = (id: string, direction: "up" | "down") => {
    startTransition(async () => {
      const res = await moveCalendarAction(id, direction);
      if (!res.ok) toast.error(res.error);
      else refresh();
    });
  };

  const onDelete = () => {
    if (!deleting) return;
    const target = deleting;
    startTransition(async () => {
      const res = await deleteCalendarAction(target.id);
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(`已刪除「${target.name}」`);
        refresh();
      }
      setDeleting(null);
    });
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="分類管理"
        description="新增、改名、改色、排序與刪除行事曆分類。"
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            新增分類
          </Button>
        }
      />

      {ownedCalendars.length === 0 ? (
        <EmptyState
          title="尚無分類"
          description="建立第一個行事曆分類，開始安排行程。"
          action={<Button onClick={() => setCreating(true)}>新增分類</Button>}
        />
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {ownedCalendars.map((c, i) => (
            <li key={c.id} className="flex items-center gap-3 p-3">
              <span
                className="size-5 shrink-0 rounded-md"
                style={{ backgroundColor: c.color }}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{c.name}</div>
                <div className="text-xs text-muted-foreground">
                  {CALENDAR_KIND_LABEL[c.kind]}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  disabled={i === 0 || pending}
                  onClick={() => onMove(c.id, "up")}
                  aria-label="上移"
                >
                  <ChevronUp className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  disabled={i === ownedCalendars.length - 1 || pending}
                  onClick={() => onMove(c.id, "down")}
                  aria-label="下移"
                >
                  <ChevronDown className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={() => setEditing(c)}
                  aria-label="編輯"
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-destructive hover:text-destructive"
                  onClick={() => setDeleting(c)}
                  aria-label="刪除"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* 新增 */}
      <CalendarFormDialog
        open={creating}
        mode="create"
        onOpenChange={setCreating}
        onDone={refresh}
      />

      {/* 編輯 */}
      <CalendarFormDialog
        open={!!editing}
        mode="edit"
        calendar={editing ?? undefined}
        onOpenChange={(o) => !o && setEditing(null)}
        onDone={refresh}
      />

      {/* 刪除確認 */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>刪除「{deleting?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              這會一併刪除此分類底下的所有行程與相關回饋，且無法復原。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDelete}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              確定刪除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CalendarFormDialog({
  open,
  mode,
  calendar,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  mode: "create" | "edit";
  calendar?: AccessibleCalendar;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<CalendarKind>("other");
  const [color, setColor] = useState(KIND_DEFAULT_COLOR.other);
  const [pending, startTransition] = useTransition();
  const [initialized, setInitialized] = useState(false);

  // 開啟時載入預設值（以 open + calendar 為依據）
  if (open && !initialized) {
    if (mode === "edit" && calendar) {
      setName(calendar.name);
      setKind(calendar.kind);
      setColor(calendar.color);
    } else {
      setName("");
      setKind("other");
      setColor(KIND_DEFAULT_COLOR.other);
    }
    setInitialized(true);
  }
  if (!open && initialized) setInitialized(false);

  const submit = () => {
    startTransition(async () => {
      const res =
        mode === "create"
          ? await createCalendarAction({ name, kind, color })
          : await updateCalendarAction({ id: calendar!.id, name, color });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(mode === "create" ? "已新增分類" : "已更新分類");
      onOpenChange(false);
      onDone();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "新增分類" : "編輯分類"}</DialogTitle>
          <DialogDescription>
            分類的顏色會作為所有視圖中的色條與識別。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="cal-name">名稱</Label>
            <Input
              id="cal-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例：小美（女兒）"
              autoFocus
            />
          </div>
          {mode === "create" && (
            <div className="space-y-2">
              <Label>種類</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as CalendarKind)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CALENDAR_KINDS.map((k) => (
                    <SelectItem key={k.value} value={k.value}>
                      {k.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label>顏色</Label>
            <ColorPicker value={color} onChange={setColor} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={submit} disabled={pending || !name.trim()}>
            {pending ? "儲存中…" : "儲存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
