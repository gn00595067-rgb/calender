"use client";

import { useEffect, useMemo, useRef, useTransition } from "react";
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
import { TimeDurationField } from "./time-duration-field";
import { CategorySelect } from "./category-select";
import { useAppData } from "@/components/app/app-data";
import {
  useEventEditData,
  useContactsBilling,
  useCategories,
} from "@/lib/client/lookups";
import { usePrepaidAccounts } from "@/lib/client/prepaid";
import { can } from "@/lib/permissions";
import {
  RECURRENCE_OPTIONS,
  FINANCE_DIRECTIONS,
  WEEKDAY_CHIPS,
  PAYMENT_METHODS,
  REMINDER_OPTIONS,
  type PaymentMethod,
} from "@/lib/constants";
import { createEventAction, updateEventAction } from "@/lib/actions/events";
import { utcToTaipeiWall, twd } from "@/lib/date";
import { addMinutesToWall, wallWeekday, diffMinutes } from "@/lib/wall-time";
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
  recurrenceWeekdays: number[];
  reminderMinutes: number | null;
  scope: "this" | "following";
  contactIds: string[];
  tagNames: string[];
  financeEnabled: boolean;
  financeDirection: "expense" | "income";
  financeAmount: string;
  financeCategory: string;
  financeCategoryId: string | null;
  financePaymentMethod: PaymentMethod | "";
  financePrepaidAccountId: string | null;
  financeSettled: boolean;
}

function plusMonths(dateStr: string, m: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + m);
  return d.toISOString().slice(0, 10);
}

/** 建立新行程時可預先帶入的欄位（供語音新增等情境）。 */
export interface EventDraft {
  calendarId?: string;
  title?: string;
  location?: string;
  allDay?: boolean;
  startWall?: string;
  endWall?: string;
  isImportant?: boolean;
}

export function EventModal({
  open,
  onOpenChange,
  mode,
  event,
  defaultCalendarId,
  defaultStartWall,
  draft,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  event?: CalEvent;
  defaultCalendarId?: string;
  defaultStartWall?: string;
  /** create 模式下預先帶入的欄位（語音解析結果）。 */
  draft?: EventDraft;
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

  const { register, handleSubmit, control, watch, reset, setValue, getValues, formState } =
    useForm<FormValues>({
      defaultValues: buildDefaults(),
    });
  const contactsBilling = useContactsBilling();

  function buildDefaults(): FormValues {
    const start = draft?.startWall ?? defaultStart;
    return {
      calendarId: draft?.calendarId ?? defaultCalendarId ?? editableCalendars[0]?.id ?? "",
      title: draft?.title ?? "",
      description: "",
      location: draft?.location ?? "",
      allDay: draft?.allDay ?? false,
      startWall: start,
      endWall: draft?.endWall ?? addMinutesToWall(start, 60),
      isImportant: draft?.isImportant ?? false,
      recurrence: "none",
      recurrenceUntil: plusMonths(start.slice(0, 10), 3),
      recurrenceWeekdays: [wallWeekday(start)],
      reminderMinutes: null,
      scope: "this",
      contactIds: [],
      tagNames: [],
      financeEnabled: false,
      financeDirection: "expense",
      financeAmount: "",
      financeCategory: "",
      financeCategoryId: null,
      financePaymentMethod: "",
      financePrepaidAccountId: null,
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
        recurrenceWeekdays: [],
        reminderMinutes: event.reminder_minutes ?? null,
        scope: "this",
        contactIds: [],
        tagNames: event.tagNames,
        financeEnabled: false,
        financeDirection: "expense",
        financeAmount: "",
        financeCategory: "",
        financeCategoryId: null,
        financePaymentMethod: "",
        financePrepaidAccountId: null,
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
      setValue("financeCategoryId", editData.data.finance.category_id ?? null);
      setValue(
        "financePaymentMethod",
        editData.data.finance.payment_method ?? "",
      );
      setValue(
        "financePrepaidAccountId",
        editData.data.finance.prepaid_account_id ?? null,
      );
      setValue("financeSettled", editData.data.finance.is_settled);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editData.data]);

  const allDay = watch("allDay");
  const recurrence = watch("recurrence");
  const calendarId = watch("calendarId");
  const startWall = watch("startWall");
  const endWall = watch("endWall");
  const contactIds = watch("contactIds");

  const canFinance = useMemo(() => {
    const cal = calendarById.get(calendarId);
    return cal ? can.viewFinance(cal.effectiveRole) : false;
  }, [calendarId, calendarById]);

  const categories = useCategories();
  const prepaid = usePrepaidAccounts({ activeOnly: true });

  // 目前選到、且有預設收費的老師（供顯示帶入提示）
  const autoBillingContact = (contactsBilling.data ?? []).find(
    (b) => contactIds.includes(b.id) && b.default_rate != null,
  );

  const financePaymentMethod = watch("financePaymentMethod");
  const usesPrepaid =
    financePaymentMethod === "prepaid_deduct" ||
    financePaymentMethod === "prepaid_term";
  // 可扣抵帳戶：屬於所選老師或通用（未指定老師）者
  const firstContactId = contactIds[0] ?? null;
  const prepaidChoices = (prepaid.data ?? []).filter(
    (a) =>
      !a.contact_id ||
      a.contact_id === firstContactId ||
      a.id === watch("financePrepaidAccountId"),
  );

  // 選到「有預設收費」的老師 → 自動帶入財務（金額/類別/付款方式）。
  // 每位老師只自動套用一次，且不覆蓋使用者已輸入的金額。
  const autoContactRef = useRef<string | null>(null);
  useEffect(() => {
    if (!canFinance) return;
    const billing = contactsBilling.data ?? [];
    const c = contactIds
      .map((id) => billing.find((b) => b.id === id))
      .find((b) => b && b.default_rate != null);
    if (!c) return;
    if (autoContactRef.current === c.id) return;
    // 使用者已自行輸入金額 → 記住這位、但不覆蓋
    if (getValues("financeEnabled") && getValues("financeAmount")) {
      autoContactRef.current = c.id;
      return;
    }
    autoContactRef.current = c.id;

    const mins = diffMinutes(getValues("startWall"), getValues("endWall"));
    const hours = Math.max(mins, 0) / 60;
    const amount =
      c.billing_mode === "hourly"
        ? Math.round((c.default_rate ?? 0) * hours)
        : (c.default_rate ?? 0);

    setValue("financeEnabled", true);
    setValue("financeDirection", c.default_direction ?? "expense");
    setValue("financeAmount", String(amount));
    if (c.default_category_id) {
      setValue("financeCategoryId", c.default_category_id);
      const name = (categories.data ?? []).find(
        (cat) => cat.id === c.default_category_id,
      )?.name;
      if (name) setValue("financeCategory", name);
    }
    const pm = c.default_payment_method ?? "";
    setValue("financePaymentMethod", pm);
    if (pm) {
      const meta = PAYMENT_METHODS.find((p) => p.value === pm);
      if (meta) setValue("financeSettled", meta.defaultSettled);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactIds, contactsBilling.data, canFinance]);

  const onSubmit = handleSubmit((v) => {
    if (v.endWall < v.startWall) {
      toast.error("結束時間不可早於開始時間");
      return;
    }
    const pmMeta = PAYMENT_METHODS.find(
      (p) => p.value === v.financePaymentMethod,
    );
    const usesPrepaidMethod = pmMeta?.usesPrepaid ?? false;
    const prepaidAccountId = usesPrepaidMethod ? v.financePrepaidAccountId : null;
    const finance =
      v.financeEnabled && canFinance && Number(v.financeAmount) > 0
        ? {
            direction: v.financeDirection,
            amount: Math.round(Number(v.financeAmount)),
            categoryLabel: v.financeCategory || null,
            categoryId: v.financeCategoryId,
            paymentMethod: v.financePaymentMethod || null,
            prepaidAccountId,
            // 有實際扣抵帳戶才算「已由預繳支付」，否則當一般支出計入
            coveredByPrepaid: usesPrepaidMethod && !!prepaidAccountId,
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
              weekdays:
                v.recurrence === "weekly" && v.recurrenceWeekdays.length
                  ? v.recurrenceWeekdays
                  : null,
              reminderMinutes: v.reminderMinutes,
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
              reminderMinutes: v.reminderMinutes,
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

            {allDay ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="ev-start">開始日期</Label>
                  <Input
                    id="ev-start"
                    type="date"
                    value={startWall.slice(0, 10)}
                    onChange={(e) =>
                      setValue("startWall", `${e.target.value}T00:00`)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ev-end">結束日期</Label>
                  <Input
                    id="ev-end"
                    type="date"
                    value={endWall.slice(0, 10)}
                    onChange={(e) =>
                      setValue("endWall", `${e.target.value}T23:59`)
                    }
                  />
                </div>
              </div>
            ) : (
              <TimeDurationField
                startWall={startWall}
                endWall={endWall}
                onChange={(s, e) => {
                  setValue("startWall", s);
                  setValue("endWall", e);
                }}
              />
            )}

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

            {!allDay && (
              <div className="space-y-2">
                <Label>提醒</Label>
                <Controller
                  control={control}
                  name="reminderMinutes"
                  render={({ field }) => (
                    <Select
                      value={field.value == null ? "none" : String(field.value)}
                      onValueChange={(v) =>
                        field.onChange(v === "none" ? null : Number(v))
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {REMINDER_OPTIONS.map((o) => (
                          <SelectItem
                            key={o.label}
                            value={o.value == null ? "none" : String(o.value)}
                          >
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                <p className="text-xs text-muted-foreground">
                  可提前提醒；桌面通知需開啟瀏覽器通知權限，Email 提醒依帳號設定寄送。
                </p>
              </div>
            )}

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
                {recurrence === "weekly" && (
                  <div className="space-y-2 sm:col-span-2">
                    <Label>重複的星期（可多選，如每週二、四）</Label>
                    <Controller
                      control={control}
                      name="recurrenceWeekdays"
                      render={({ field }) => (
                        <div className="flex flex-wrap gap-1.5">
                          {WEEKDAY_CHIPS.map((w) => {
                            const on = field.value.includes(w.value);
                            return (
                              <button
                                key={w.value}
                                type="button"
                                aria-pressed={on}
                                onClick={() =>
                                  field.onChange(
                                    on
                                      ? field.value.filter((d) => d !== w.value)
                                      : [...field.value, w.value],
                                  )
                                }
                                className={
                                  "flex size-9 items-center justify-center rounded-full border text-sm font-medium transition " +
                                  (on
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : "hover:border-primary hover:bg-accent")
                                }
                              >
                                {w.label}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    />
                    <p className="text-xs text-muted-foreground">
                      未選任何星期時，預設每週的同一天重複。
                    </p>
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
                    {autoBillingContact && (
                      <p className="rounded bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground">
                        已依〔{autoBillingContact.name}〕預設收費帶入，可直接修改；不影響老師設定。
                      </p>
                    )}
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
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs">費用類別</Label>
                        <Controller
                          control={control}
                          name="financeCategoryId"
                          render={({ field }) => (
                            <CategorySelect
                              value={field.value}
                              label={watch("financeCategory")}
                              onChange={(id, name) => {
                                field.onChange(id);
                                setValue("financeCategory", name ?? "");
                              }}
                            />
                          )}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">付款方式</Label>
                        <Controller
                          control={control}
                          name="financePaymentMethod"
                          render={({ field }) => (
                            <Select
                              value={field.value || undefined}
                              onValueChange={(v) => {
                                field.onChange(v);
                                const meta = PAYMENT_METHODS.find(
                                  (p) => p.value === v,
                                );
                                if (meta)
                                  setValue("financeSettled", meta.defaultSettled);
                              }}
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="選擇（選填）" />
                              </SelectTrigger>
                              <SelectContent>
                                {PAYMENT_METHODS.map((p) => (
                                  <SelectItem key={p.value} value={p.value}>
                                    {p.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        />
                      </div>
                    </div>

                    {/* 預繳/預付：選擇要扣抵的帳戶 */}
                    {usesPrepaid && (
                      <div className="space-y-1.5 rounded-lg border bg-muted/30 p-2.5">
                        <Label className="text-xs">從預繳帳戶扣抵</Label>
                        <Controller
                          control={control}
                          name="financePrepaidAccountId"
                          render={({ field }) => (
                            <Select
                              value={field.value || undefined}
                              onValueChange={field.onChange}
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="選擇帳戶" />
                              </SelectTrigger>
                              <SelectContent>
                                {prepaidChoices.length === 0 ? (
                                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                                    尚無帳戶，請至「設定 → 預繳帳戶」建立
                                  </div>
                                ) : (
                                  prepaidChoices.map((a) => (
                                    <SelectItem key={a.id} value={a.id}>
                                      {a.label}（餘 {twd(a.balance)}
                                      {a.remainingSessions != null
                                        ? ` · 剩 ${a.remainingSessions} 堂`
                                        : ""}
                                      ）
                                    </SelectItem>
                                  ))
                                )}
                              </SelectContent>
                            </Select>
                          )}
                        />
                        {watch("financePrepaidAccountId") ? (
                          <p className="text-xs text-muted-foreground">
                            此堂金額會從帳戶餘額扣抵，不重複計入支出。
                          </p>
                        ) : (
                          <p className="text-xs text-amber-600">
                            未選帳戶時，此堂會當成一般支出計入。
                          </p>
                        )}
                      </div>
                    )}

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
