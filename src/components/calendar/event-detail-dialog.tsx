"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Calendar as CalIcon,
  MapPin,
  Users,
  Tag as TagIcon,
  Repeat,
  Star,
  Pencil,
  Trash2,
  Wallet,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAppData } from "@/components/app/app-data";
import { can } from "@/lib/permissions";
import { D, twd } from "@/lib/date";
import { RECURRENCE_OPTIONS } from "@/lib/constants";
import { deleteEventAction } from "@/lib/actions/events";
import { NotesSection } from "./notes-section";
import type { CalEvent } from "@/lib/client/events";

export function EventDetailDialog({
  open,
  onOpenChange,
  event,
  onEdit,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: CalEvent | null;
  onEdit: () => void;
  onChanged?: () => void;
}) {
  const { calendarById } = useAppData();
  const router = useRouter();
  const qc = useQueryClient();
  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!event) return null;
  const cal = calendarById.get(event.calendar_id);
  const role = cal?.effectiveRole ?? "viewer";
  const editable = can.editEvents(role);
  const financeVisible = can.viewFinance(role) && event.finance.length > 0;
  const isRecurring = !!event.recurrence_group_id;

  const sameDay = D.date(event.starts_at) === D.date(event.ends_at);
  const timeText = event.all_day
    ? `${D.date(event.starts_at)}${sameDay ? "" : ` – ${D.date(event.ends_at)}`}（整日）`
    : sameDay
      ? `${D.full(event.starts_at)} – ${D.time(event.ends_at)}`
      : `${D.full(event.starts_at)} – ${D.full(event.ends_at)}`;

  const doDelete = (scope: "this" | "following") => {
    startTransition(async () => {
      const res = await deleteEventAction(event.id, scope);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("已刪除行程");
      await qc.invalidateQueries({ queryKey: ["events"] });
      setConfirmDelete(false);
      onOpenChange(false);
      router.refresh();
      onChanged?.();
    });
  };

  const recurrenceLabel = RECURRENCE_OPTIONS.find(
    (o) => o.value === event.recurrence_rule,
  )?.label;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <div className="flex items-start gap-2">
              {cal && (
                <span
                  className="mt-1 h-5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: cal.color }}
                />
              )}
              <div className="min-w-0 flex-1">
                <DialogTitle className="flex items-center gap-2 pr-6 text-left">
                  {event.is_important && (
                    <Star className="size-4 shrink-0 fill-amber-400 text-amber-500" />
                  )}
                  {event.title}
                </DialogTitle>
                {cal && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{cal.name}</p>
                )}
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            <Row icon={CalIcon}>{timeText}</Row>
            {isRecurring && recurrenceLabel && (
              <Row icon={Repeat}>重複行程（{recurrenceLabel}）</Row>
            )}
            {event.location && <Row icon={MapPin}>{event.location}</Row>}
            {event.contactNames.length > 0 && (
              <Row icon={Users}>{event.contactNames.join("、")}</Row>
            )}
            {event.tagNames.length > 0 && (
              <Row icon={TagIcon}>
                <div className="flex flex-wrap gap-1">
                  {event.tagNames.map((t) => (
                    <Badge key={t} variant="secondary">
                      {t}
                    </Badge>
                  ))}
                </div>
              </Row>
            )}
            {event.description && (
              <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-sm">
                {event.description}
              </p>
            )}
            {financeVisible && (
              <Row icon={Wallet}>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {event.finance.map((f, i) => (
                    <span key={i}>
                      {f.direction === "expense" ? "支出" : "收入"} {twd(f.amount)}
                      <span
                        className={
                          f.is_settled ? "text-emerald-600" : "text-amber-600"
                        }
                      >
                        （{f.is_settled ? "已結清" : "未結清"}）
                      </span>
                    </span>
                  ))}
                </div>
              </Row>
            )}
          </div>

          <Separator className="my-1" />

          <NotesSection eventId={event.id} canAdd={can.addNotes(role)} />

          {editable && (
            <div className="mt-2 flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => setConfirmDelete(true)}
                disabled={pending}
              >
                <Trash2 className="size-4" />
                刪除
              </Button>
              <Button size="sm" onClick={onEdit}>
                <Pencil className="size-4" />
                編輯
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>刪除「{event.title}」？</AlertDialogTitle>
            <AlertDialogDescription>
              {isRecurring
                ? "這是重複行程，請選擇刪除範圍。此操作無法復原。"
                : "此操作無法復原。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
            <AlertDialogCancel>取消</AlertDialogCancel>
            {isRecurring ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => doDelete("this")}
                  disabled={pending}
                >
                  僅此筆
                </Button>
                <Button
                  className="bg-destructive text-white hover:bg-destructive/90"
                  onClick={() => doDelete("following")}
                  disabled={pending}
                >
                  此筆與之後全部
                </Button>
              </>
            ) : (
              <Button
                className="bg-destructive text-white hover:bg-destructive/90"
                onClick={() => doDelete("this")}
                disabled={pending}
              >
                確定刪除
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Row({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
