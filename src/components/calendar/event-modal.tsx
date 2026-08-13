"use client";

import { useEffect, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Star } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ContactMultiSelect } from "./contact-multi-select";
import { TagInput } from "./tag-input";
import { useAppData } from "@/components/app/app-data";
import { useEventEditData } from "@/lib/client/lookups";
import { can } from "@/lib/permissions";
import { RECURRENCE_OPTIONS, FINANCE_DIRECTIONS } from "@/lib/constants";
import { createEventAction, updateEventAction } from "@/lib/actions/events";
import { utcToTaipeiWall } from "@/lib/date";
import type { CalEvent } from "@/lib/client/events";

interface FormValues {
  calendarId: string;
  title: string;
  description: string;
  location: string;
  allDay: boolean;
  startWall: string;
  endWall: string;
  isImportant: boolean;
  recurrence: "none" | "daily" | "weekly" | "biweekly" | "monthly";
  recurrenceUntil: string;
  scope: "this" | "following";
  contactIds: string[];
  tagNames: string[];
  financeEnabled: boolean;
  financeDirection: "expense" | "income";
  financeAmount: string;
  financeCategory: string;
  financeSettled: boolean;
}

function plusMonths(dateStr: string, m: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + m);
  return d.toISOString().slice(0, 10);
}

export function EventModal({
  open,
  onOpenChange,
  mode,
  event,
  defaultCalendarId,
  defaultStartWall,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  event?: CalEvent;
  defaultCalendarId?: string;
  defaultStartWall?: string;
  onSaved?: () => void;
}) {
  const { ownedCalendars, sharedCalendars, calendarById } = useAppData();
  const editableCalendars = [...ownedCalendars, ...sharedCalendars].filter((c) =>
    can.editEvents(c.effectiveRole),
  );
  const router = useRouter();
  const qc = useQueryClient();
  const [pending, startTransition] = useTransition();

  const editData = useEventEditData(mode === "edit" && open ? (event?.id ?? null) : null);

  const defaultStart = defaultStartWall ?? nowWall();
  const isRecurringEdit = mode === "edit" && !!event?.recurrence_group_id;

  const { register, handleSubmit, control, watch, reset, setValue, formState } =
    useForm<FormValues>({
      defaultValues: buildDefaults(),
    });

  function buildDefaults(): FormValues {
    return {
      calendarId: defaultCalendarId ?? editableCalendars[0]?.id ?? "",
      title: "",
      description: "",
      location: "",
      allDay: false,
      startWall: defaultStart,
      endWall: addHour(defaultStart),
      isImportant: false,
      recurrence: "none",
      recurrenceUntil: plusMonths(defaultStart.slice(0, 10), 3),
      scope: "this",
      contactIds: [],
      tagNames: [],
      financeEnabled: false,
      financeDirection: "expense",
      financeAmount: "",
      financeCategory: "",
      financeSettled: false,
    };
  }

  // 開啟時載入初始值
  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && event) {
      reset({
        calendarId: event.calendar_id,
        title: event.title,
        description: event.description ?? "",
        location: event.location ?? "",
        allDay: event.all_day,
        startWall: utcToTaipeiWall(event.starts_at),
        endWall: utcToTaipeiWall(event.ends_at),
        isImportant: event.is_important,
        recurrence: "none",
        recurrenceUntil: "",
        scope: "this",
        contactIds: [],
        tagNames: event.tagNames,
        financeEnabled: false,
        financeDirection: "expense",
        financeAmount: "",
        financeCategory: "",
        financeSettled: false,
      });
    } else {
      reset(buildDefaults());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, event?.id, mode]);

  // 編輯：帶入既有人物與財務
  useEffect(() => {
    if (mode !== "edit" || !editData.data) return;
    setValue("contactIds", editData.data.contactIds);
    if (editData.data.finance) {
      setValue("financeEnabled", true);
      setValue("financeDirection", editData.data.finance.direction);
      setValue("financeAmount", String(editData.data.finance.amount));
      setValue("financeCategory", editData.data.finance.category_label ?? "");
      setValue("financeSettled", editData.data.finance.is_settled);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editData.data]);

  const allDay = watch("allDay");
  const recurrence = watch("recurrence");
  const calendarId = watch("calendarId");
  const startWall = watch("startWall");

  const canFinance = useMemo(() => {
    const cal = calendarById.get(calendarId);
    return cal ? can.viewFinance(cal.effectiveRole) : false;
  }, [calendarId, calendarById]);

  const onSubmit = handleSubmit((v) => {
    if (v.endWall < v.startWall) {
      toast.error("結束時間不可早於開始時間");
      return;
    }
    const finance =
      v.financeEnabled && canFinance && Number(v.financeAmount) > 0
        ? {
            direction: v.financeDirection,
            amount: Math.round(Number(v.financeAmount)),
            categoryLabel: v.financeCategory || null,
            isSettled: v.financeSettled,
          }
        : null;

    startTransition(async () => {
      const res =
        mode === "create"
          ? await createEventAction({
              calendarId: v.calendarId,
              title: v.title,
              description: v.description || null,
              location: v.location || null,
              allDay: v.allDay,
              startWall: v.startWall,
              endWall: v.endWall,
              isImportant: v.isImportant,
              recurrence: v.recurrence,
              recurrenceUntil: v.recurrence === "none" ? null : v.recurrenceUntil,
              contactIds: v.contactIds,
              tagNames: v.tagNames,
              finance,
            })
          : await updateEventAction({
              id: event!.id,
              calendarId: v.calendarId,
              title: v.title,
              description: v.description || null,
              location: v.location || null,
              allDay: v.allDay,
              startWall: v.startWall,
              endWall: v.endWall,
              isImportant: v.isImportant,
              scope: v.scope,
              contactIds: v.contactIds,
              tagNames: v.tagNames,
              finance,
            });

      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(mode === "create" ? "已新增行程" : "已更新行程");
      await qc.invalidateQueries({ queryKey: ["events"] });
      onOpenChange(false);
      router.refresh();
      onSaved?.();
    });
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "新增行程" : "編輯行程"}</DialogTitle>
        </DialogHeader>

        {editableCalendars.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            你沒有可新增行程的分類。
          </p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            {isRecurringEdit && (
              <div className="rounded-lg border bg-muted/40 p-3">
                <Label className="mb-2 block text-xs text-muted-foreground">
                  這是重複行程，變更套用範圍：
                </Label>
                <Controller
                  control={control}
                  name="scope"
                  render={({ field }) => (
                    <div className="flex gap-4 text-sm">
                      {[
                        { v: "this", l: "僅此筆" },
                        { v: "following", l: "此筆與之後全部" },
                      ].map((o) => (
                        <label key={o.v} className="flex items-center gap-1.5">
                          <input
                            type="radio"
                            checked={field.value === o.v}
                            onChange={() => field.onChange(o.v)}
                          />
                          {o.l}
                        </label>
                      ))}
                    </div>
                  )}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="ev-title">標題</Label>
              <Input
                id="ev-title"
                {...register("title", { required: true })}
                placeholder="例：數學家教課"
                autoFocus
                aria-invalid={!!formState.errors.title}
              />
            </div>

            <div className="space-y-2">
              <Label>分類</Label>
              <Controller
                control={control}
                name="calendarId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="選擇分類" />
                    </SelectTrigger>
                    <SelectContent>
                      {editableCalendars.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          <span className="flex items-center gap-2">
                            <span
                              className="size-2.5 rounded-full"
                              style={{ backgroundColor: c.color }}
                            />
                            {c.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label htmlFor="ev-allday">整日行程</Label>
              <Controller
                control={control}
                name="allDay"
                render={({ field }) => (
                  <Switch
                    id="ev-allday"
                    checked={field.value}
                    onCheckedChange={(c) => {
                      field.onChange(c);
                      if (c) {
                        const d = startWall.slice(0, 10);
                        setValue("startWall", `${d}T00:00`);
                        setValue("endWall", `${d}T23:59`);
                      }
                    }}
                  />
                )}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ev-start">開始{allDay ? "日期" : "時間"}</Label>
                <Input
                  id="ev-start"
                  type={allDay ? "date" : "datetime-local"}
                  value={allDay ? startWall.slice(0, 10) : startWall}
                  onChange={(e) =>
                    setValue(
                      "startWall",
                      allDay ? `${e.target.value}T00:00` : e.target.value,
                    )
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ev-end">結束{allDay ? "日期" : "時間"}</Label>
                <Input
                  id="ev-end"
                  type={allDay ? "date" : "datetime-local"}
                  value={allDay ? watch("endWall").slice(0, 10) : watch("endWall")}
                  onChange={(e) =>
                    setValue(
                      "endWall",
                      allDay ? `${e.target.value}T23:59` : e.target.value,
                    )
                  }
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ev-location">地點</Label>
              <Input id="ev-location" {...register("location")} placeholder="選填" />
            </div>

            <div className="space-y-2">
              <Label>人物</Label>
              <Controller
                control={control}
                name="contactIds"
                render={({ field }) => (
                  <ContactMultiSelect value={field.value} onChange={field.onChange} />
                )}
              />
            </div>

            <div className="space-y-2">
              <Label>標籤</Label>
              <Controller
                control={control}
                name="tagNames"
                render={({ field }) => (
                  <TagInput value={field.value} onChange={field.onChange} />
                )}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ev-desc">描述</Label>
              <Textarea id="ev-desc" {...register("description")} rows={2} placeholder="選填" />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label htmlFor="ev-important" className="flex items-center gap-1.5">
                <Star className="size-4 text-amber-500" />
                重點行程（在總覽放大顯示）
              </Label>
              <Controller
                control={control}
                name="isImportant"
                render={({ field }) => (
                  <Switch
                    id="ev-important"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
            </div>

            {mode === "create" && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>重複</Label>
                  <Controller
                    control={control}
                    name="recurrence"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {RECURRENCE_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
                {recurrence !== "none" && (
                  <div className="space-y-2">
                    <Label htmlFor="ev-until">重複至</Label>
                    <Input id="ev-until" type="date" {...register("recurrenceUntil")} />
                  </div>
                )}
              </div>
            )}

            {/* 財務區塊：僅 owner/editor 可見 */}
            {canFinance && (
              <div className="rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="ev-fin" className="font-medium">
                    財務（收支）
                  </Label>
                  <Controller
                    control={control}
                    name="financeEnabled"
                    render={({ field }) => (
                      <Switch
                        id="ev-fin"
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    )}
                  />
                </div>
                {watch("financeEnabled") && (
                  <div className="mt-3 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">收／支</Label>
                        <Controller
                          control={control}
                          name="financeDirection"
                          render={({ field }) => (
                            <Select value={field.value} onValueChange={field.onChange}>
                              <SelectTrigger className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {FINANCE_DIRECTIONS.map((d) => (
                                  <SelectItem key={d.value} value={d.value}>
                                    {d.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">金額（TWD）</Label>
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          {...register("financeAmount")}
                          placeholder="0"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">費用類別</Label>
                      <Input
                        {...register("financeCategory")}
                        placeholder="例：家教費、餐敘"
                      />
                    </div>
                    <Controller
                      control={control}
                      name="financeSettled"
                      render={({ field }) => (
                        <label className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={(c) => field.onChange(!!c)}
                          />
                          已結清（款項已收／付）
                        </label>
                      )}
                    />
                    {recurrence !== "none" && mode === "create" && (
                      <p className="text-xs text-muted-foreground">
                        重複行程：每一堂都會各自產生一筆此金額的財務紀錄。
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "儲存中…" : "儲存"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function nowWall(): string {
  return utcToTaipeiWall(new Date().toISOString()).slice(0, 11) + "09:00";
}

function addHour(wall: string): string {
  const [date, time] = wall.split("T");
  const [h, m] = time.split(":").map(Number);
  const d = new Date(Date.UTC(2000, 0, 1, h, m));
  d.setUTCHours(d.getUTCHours() + 1);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${date}T${hh}:${mm}`;
}
