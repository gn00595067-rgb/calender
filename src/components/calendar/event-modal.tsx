"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm, Controller } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Star, Mic, AlertTriangle, History, Info } from "lucide-react";
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
  useContacts,
  isLegacyPlanId,
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
import { createEventAction, updateEventAction, deleteEventAction } from "@/lib/actions/events";
import { utcToTaipeiWall, taipeiWallToUtcISO, twd } from "@/lib/date";
import { addMinutesToWall, wallWeekday, diffMinutes } from "@/lib/wall-time";
import { fetchEventsInRange, type CalEvent } from "@/lib/client/events";
import { ConflictPrompt } from "./conflict-prompt";
import {
  extraLabel,
  isMonthlyPlan,
  pickPlan,
  planAmount,
  planSummary,
  splitAmount,
  type RatePlan,
} from "@/lib/rate-plans";
import { cn } from "@/lib/utils";
import {
  DRIVER_TRIPS,
  DRIVER_PICKUP_OPTIONS,
  DEFAULT_PICKUP_MINUTES,
  DEFAULT_PICKUP_PLACE,
  type DriverTrip,
} from "@/lib/driver";

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
  subjectIds: string[];
  participantIds: string[];
  tagNames: string[];
  financeEnabled: boolean;
  financeDirection: "expense" | "income";
  financeAmount: string;
  financeCategory: string;
  financeCategoryId: string | null;
  financePaymentMethod: PaymentMethod | "";
  financePrepaidAccountId: string | null;
  financeSettled: boolean;
  /** 收費方案（1對1／1對2…）；老師沒設方案時為 null */
  financePlanId: string | null;
  /** 司機接送 */
  driverEnabled: boolean;
  driverTrip: DriverTrip;
  driverPickupMinutes: number;
  driverPickupLocation: string;
  driverNote: string;
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
  subjectIds?: string[];
  participantIds?: string[];
  tagNames?: string[];
  needsDriver?: boolean;
  recurrence?: FormValues["recurrence"];
  recurrenceWeekdays?: number[];
  recurrenceUntil?: string;
  /** 語音解析結果的說明（原句與提示），顯示在表單頂端供確認 */
  voice?: VoiceHints;
}

/** 語音解析提示：待確認／依過去紀錄帶入／假設 */
export interface VoiceHints {
  transcript: string;
  warnings: string[];
  fromHabit: string[];
  assumptions: string[];
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
  const { calendars, ownedCalendars, sharedCalendars, calendarById } = useAppData();
  const editableCalendars = [...ownedCalendars, ...sharedCalendars].filter((c) =>
    can.editEvents(c.effectiveRole),
  );
  const router = useRouter();
  const qc = useQueryClient();
  const [pending, startTransition] = useTransition();
  /** 儲存前偵測到的同時段行程；有值時表單換成衝突面板 */
  const [conflictList, setConflictList] = useState<CalEvent[] | null>(null);
  const [checking, setChecking] = useState(false);
  const pendingValues = useRef<FormValues | null>(null);
  /** 使用者手動改過金額 → 不再自動覆蓋，改顯示［套用］ */
  const amountTouchedRef = useRef(false);
  /** 使用者手動選過方案 → 改主角人數時不自動換方案 */
  const planManualRef = useRef(false);
  /** 上一次處理過的收費老師（偵測換老師） */
  const billingContactRef = useRef<string | null>(null);

  const editData = useEventEditData(mode === "edit" && open ? (event?.id ?? null) : null);

  const defaultStart = defaultStartWall ?? nowWall();
  const isRecurringEdit = mode === "edit" && !!event?.recurrence_group_id;

  const { register, handleSubmit, control, watch, reset, setValue, getValues, formState } =
    useForm<FormValues>({
      defaultValues: buildDefaults(),
    });
  const contactsBilling = useContactsBilling();
  const { data: allContacts = [] } = useContacts();
  /** 使用者手動改過主角 → 換分類時不再自動帶入 */
  const subjectsTouchedRef = useRef(false);

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
      recurrence: draft?.recurrence ?? "none",
      recurrenceUntil: draft?.recurrenceUntil ?? plusMonths(start.slice(0, 10), 3),
      recurrenceWeekdays: draft?.recurrenceWeekdays?.length
        ? draft.recurrenceWeekdays
        : [wallWeekday(start)],
      reminderMinutes: null,
      scope: "this",
      subjectIds: draft?.subjectIds ?? [],
      participantIds: draft?.participantIds ?? [],
      tagNames: draft?.tagNames ?? [],
      financeEnabled: false,
      financeDirection: "expense",
      financeAmount: "",
      financeCategory: "",
      financeCategoryId: null,
      financePaymentMethod: "",
      financePrepaidAccountId: null,
      financeSettled: false,
      financePlanId: null,
      driverEnabled: draft?.needsDriver ?? false,
      driverTrip: "round",
      driverPickupMinutes: DEFAULT_PICKUP_MINUTES,
      driverPickupLocation: "",
      driverNote: "",
    };
  }

  // 開啟時載入初始值
  useEffect(() => {
    if (!open) return;
    setConflictList(null);
    pendingValues.current = null;
    amountTouchedRef.current = false;
    planManualRef.current = false;
    billingContactRef.current = null;
    // 語音已判斷出主角時以語音為準；編輯舊行程不自動改
    subjectsTouchedRef.current = mode === "edit" || !!draft?.subjectIds?.length;
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
        subjectIds: [],
        participantIds: [],
        tagNames: event.tagNames,
        financeEnabled: false,
        financeDirection: "expense",
        financeAmount: "",
        financeCategory: "",
        financeCategoryId: null,
        financePaymentMethod: "",
        financePrepaidAccountId: null,
        financeSettled: false,
        financePlanId: null,
        driverEnabled: !!event.driver,
        driverTrip: event.driver?.trip ?? "round",
        driverPickupMinutes: event.driver?.pickupMinutes ?? DEFAULT_PICKUP_MINUTES,
        driverPickupLocation: event.driver?.pickupLocation ?? "",
        driverNote: event.driver?.note ?? "",
      });
    } else {
      reset(buildDefaults());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, event?.id, mode]);

  // 編輯：帶入既有人物與財務
  useEffect(() => {
    if (mode !== "edit" || !editData.data) return;
    setValue("subjectIds", editData.data.subjectIds);
    setValue("participantIds", editData.data.participantIds);
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
      // 既有金額是使用者當時確認過的，不自動覆蓋；改了人數／時長只會出現［套用］提示
      amountTouchedRef.current = true;
      const planId = editData.data.finance.rate_plan_id ?? null;
      setValue("financePlanId", planId);
      planManualRef.current = !!planId;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editData.data]);

  const allDay = watch("allDay");
  const recurrence = watch("recurrence");
  const calendarId = watch("calendarId");

  // 依分類名稱自動帶入主角：「哥哥+妹妹」→ 哥哥、妹妹（名稱含家人名字者）
  const inferredSubjects = useMemo(() => {
    const calName = calendarById.get(calendarId)?.name ?? "";
    return allContacts
      .filter((c) => c.is_family && c.name && calName.includes(c.name))
      .map((c) => c.id);
  }, [calendarId, calendarById, allContacts]);
  const [autoSubjectNote, setAutoSubjectNote] = useState<string | null>(null);
  useEffect(() => {
    if (!open || mode !== "create" || subjectsTouchedRef.current) return;
    setValue("subjectIds", inferredSubjects);
    const calName = calendarById.get(calendarId)?.name;
    setAutoSubjectNote(
      inferredSubjects.length && calName
        ? `已依分類「${calName}」帶入主角；只有其中一人參加時，把另一位拿掉即可。`
        : null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, inferredSubjects.join(",")]);
  const startWall = watch("startWall");
  const endWall = watch("endWall");
  // 財務相關（自動帶入、預繳扣抵）一律看「相關人物」＝收費老師
  const participantIds = watch("participantIds");

  const canFinance = useMemo(() => {
    const cal = calendarById.get(calendarId);
    return cal ? can.viewFinance(cal.effectiveRole) : false;
  }, [calendarId, calendarById]);

  const categories = useCategories();
  const prepaid = usePrepaidAccounts({ activeOnly: true });

  // 收費老師：相關人物中（依選取順序）第一位有收費方案者
  const billingContact =
    participantIds
      .map((id) => (contactsBilling.data ?? []).find((b) => b.id === id))
      .find((b) => b && b.plans.length > 0) ?? null;
  const plans = billingContact?.plans ?? [];
  const subjectIds = watch("subjectIds");
  const financePlanId = watch("financePlanId");
  const selectedPlan = plans.find((p) => p.id === financePlanId) ?? null;
  const durationMin = Math.max(diffMinutes(startWall, endWall), 0);
  const suggestedAmount = selectedPlan ? planAmount(selectedPlan, durationMin) : null;
  const maxHeadcount = plans.reduce((m, p) => Math.max(m, p.headcount), 0);

  const financePaymentMethod = watch("financePaymentMethod");
  const usesPrepaid =
    financePaymentMethod === "prepaid_deduct" ||
    financePaymentMethod === "prepaid_term";
  // 可扣抵帳戶：屬於收費老師或通用（未指定老師）者
  const firstContactId = billingContact?.id ?? participantIds[0] ?? null;
  const prepaidChoices = (prepaid.data ?? []).filter(
    (a) =>
      !a.contact_id ||
      a.contact_id === firstContactId ||
      a.id === watch("financePrepaidAccountId"),
  );

  // 選到「有收費方案」的老師 → 帶入財務預設（類別/方向/付款方式）。
  // 每位老師只套用一次；使用者已自行輸入金額時不覆蓋。
  useEffect(() => {
    if (!canFinance) return;
    const c = billingContact;
    const prev = billingContactRef.current;
    if (!c || c.id === prev) return;
    billingContactRef.current = c.id;
    // 從 A 老師換成 B 老師：方案要重挑
    if (prev) planManualRef.current = false;
    if (getValues("financeEnabled") && getValues("financeAmount")) {
      if (!prev) amountTouchedRef.current = true;
      return;
    }
    amountTouchedRef.current = false;
    setValue("financeEnabled", true);
    setValue("financeDirection", c.default_direction ?? "expense");
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
  }, [billingContact?.id, canFinance]);

  // 依主角人數自動挑方案（1 位→1對1、2 位→1對2）；手動選過就不動
  useEffect(() => {
    if (!canFinance || plans.length === 0) return;
    const current = plans.find((p) => p.id === getValues("financePlanId"));
    if (planManualRef.current && current) return;
    const next = pickPlan(plans, getValues("subjectIds"));
    if (next && next.id !== current?.id) setValue("financePlanId", next.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billingContact?.id, subjectIds.join(","), plans.length, canFinance]);

  // 方案／時長變動 → 重算金額（使用者沒手動改過才覆蓋）
  useEffect(() => {
    if (suggestedAmount == null || amountTouchedRef.current) return;
    if (!getValues("financeEnabled")) return;
    setValue("financeAmount", String(suggestedAmount));
    // 月薪制：這堂不用另外付錢，直接算已結清（錢在月底的月薪那筆）
    if (isMonthlyPlan(selectedPlan) && !selectedPlan?.extra_fee) setValue("financeSettled", true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestedAmount]);

  /** 找出與此行程同時段的既有時段行程（全部可存取分類；排除自己與整日行程） */
  async function findConflicts(v: FormValues): Promise<CalEvent[]> {
    // 整日行程不佔時段；新增重複行程先不逐堂比對（MVP 範圍外）
    if (v.allDay || (mode === "create" && v.recurrence !== "none")) return [];
    const startIso = taipeiWallToUtcISO(v.startWall);
    const endIso = taipeiWallToUtcISO(v.endWall);
    if (endIso <= startIso) return [];
    const found = await fetchEventsInRange(
      startIso,
      endIso,
      calendars.map((c) => c.id),
    );
    return found.filter((e) => !e.all_day && e.id !== event?.id);
  }

  const onSubmit = handleSubmit(async (v) => {
    if (v.endWall < v.startWall) {
      toast.error("結束時間不可早於開始時間");
      return;
    }
    setChecking(true);
    let found: CalEvent[] = [];
    try {
      found = await findConflicts(v);
    } catch {
      // 查詢失敗不擋儲存，只是少了提醒
    } finally {
      setChecking(false);
    }
    if (found.length > 0) {
      pendingValues.current = v;
      setConflictList(found);
      return;
    }
    save(v, []);
  });

  /** 實際儲存；成功後刪除使用者在衝突面板勾選的舊行程 */
  function save(v: FormValues, deleteIds: string[]) {
    const driver = v.driverEnabled
      ? {
          trip: v.driverTrip,
          pickupMinutes: v.driverPickupMinutes,
          pickupLocation: v.driverPickupLocation.trim() || null,
          note: v.driverNote.trim() || null,
        }
      : null;
    const pmMeta = PAYMENT_METHODS.find(
      (p) => p.value === v.financePaymentMethod,
    );
    const usesPrepaidMethod = pmMeta?.usesPrepaid ?? false;
    const prepaidAccountId = usesPrepaidMethod ? v.financePrepaidAccountId : null;
    // 月薪制的課金額為 0 仍要記一筆，報表才數得到堂數
    const salaried = isMonthlyPlan(selectedPlan);
    const finance =
      v.financeEnabled && canFinance && (Number(v.financeAmount) > 0 || salaried)
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
            contactId: billingContact?.id ?? null,
            // 方案快照：舊費率暫代的方案（未套 0008）沒有真正 id，只存名稱
            ratePlanId:
              selectedPlan && !isLegacyPlanId(selectedPlan.id) ? selectedPlan.id : null,
            lessonLabel: selectedPlan?.label ?? null,
            headcount: selectedPlan?.headcount ?? null,
            learnerCount: v.subjectIds.length > 0 ? v.subjectIds.length : null,
            salaried,
            extraFee: selectedPlan?.extra_fee || null,
            extraLabel: selectedPlan?.extra_fee ? extraLabel(selectedPlan) : null,
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
              subjectIds: v.subjectIds,
              participantIds: v.participantIds,
              tagNames: v.tagNames,
              finance,
              driver,
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
              subjectIds: v.subjectIds,
              participantIds: v.participantIds,
              tagNames: v.tagNames,
              finance,
              driver,
            });

      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      let deleted = 0;
      for (const id of deleteIds) {
        const r = await deleteEventAction(id, "this");
        if (r.ok) deleted++;
      }
      const base = mode === "create" ? "已新增行程" : "已更新行程";
      if (deleteIds.length === 0) toast.success(base);
      else if (deleted === deleteIds.length) toast.success(`${base}，並刪除 ${deleted} 筆舊行程`);
      else toast.error(`${base}，但有 ${deleteIds.length - deleted} 筆舊行程刪除失敗，請手動處理`);
      await qc.invalidateQueries({ queryKey: ["events"] });
      onOpenChange(false);
      router.refresh();
      onSaved?.();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {conflictList ? "時間衝突" : mode === "create" ? "新增行程" : "編輯行程"}
          </DialogTitle>
        </DialogHeader>

        {conflictList && (
          <ConflictPrompt
            conflicts={conflictList}
            isEdit={mode === "edit"}
            calendarName={(id) => calendarById.get(id)?.name ?? "（未知分類）"}
            colorOf={(id) => calendarById.get(id)?.color ?? "#64748B"}
            canDelete={(e) => {
              const cal = calendarById.get(e.calendar_id);
              return !!cal && can.editEvents(cal.effectiveRole);
            }}
            pending={pending}
            onBack={() => setConflictList(null)}
            onDiscard={() => onOpenChange(false)}
            onSave={(ids) => pendingValues.current && save(pendingValues.current, ids)}
          />
        )}

        {editableCalendars.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            你沒有可新增行程的分類。
          </p>
        ) : (
          <form onSubmit={onSubmit} className={conflictList ? "hidden" : "space-y-4"}>
            {mode === "create" && draft?.voice && <VoicePanel hints={draft.voice} />}
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
              <Label>
                主角
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  誰的行程（小孩／本人）
                </span>
              </Label>
              <Controller
                control={control}
                name="subjectIds"
                render={({ field }) => (
                  <ContactMultiSelect
                    value={field.value}
                    onChange={(ids) => {
                      subjectsTouchedRef.current = true;
                      field.onChange(ids);
                    }}
                    placeholder="選擇主角…（誰的行程）"
                    preferFamily
                    newIsFamily
                  />
                )}
              />
              {autoSubjectNote && (
                <p className="text-xs text-muted-foreground">{autoSubjectNote}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>
                相關人物
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  拜訪／參與／對象（老師、客戶…）
                </span>
              </Label>
              <Controller
                control={control}
                name="participantIds"
                render={({ field }) => (
                  <ContactMultiSelect
                    value={field.value}
                    onChange={field.onChange}
                    placeholder="選擇相關人物…"
                  />
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
              <p className="text-xs text-muted-foreground">
                用於報表「依標籤」統計次數與花費、搜尋篩選。不要的標籤到{" "}
                <Link href="/settings/tags" className="underline underline-offset-2">
                  設定 → 標籤管理
                </Link>{" "}
                刪除或合併。
              </p>
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

            {/* 司機接送：勾選後會出現在「司機行程」時間表 */}
            <div className="rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="ev-driver" className="font-medium">
                  需要司機接送
                </Label>
                <Controller
                  control={control}
                  name="driverEnabled"
                  render={({ field }) => (
                    <Switch
                      id="ev-driver"
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  )}
                />
              </div>
              {watch("driverEnabled") && (
                <div className="mt-3 space-y-3">
                  <Controller
                    control={control}
                    name="driverTrip"
                    render={({ field }) => (
                      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="接送方式">
                        {DRIVER_TRIPS.map((t) => (
                          <button
                            key={t.value}
                            type="button"
                            role="radio"
                            aria-checked={field.value === t.value}
                            onClick={() => field.onChange(t.value)}
                            className={cn(
                              "rounded-full border px-3 py-1 text-sm transition touch:py-2",
                              field.value === t.value
                                ? "border-primary bg-primary text-primary-foreground"
                                : "hover:bg-accent",
                            )}
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>
                    )}
                  />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {watch("driverTrip") !== "from" && !allDay && (
                      <div className="space-y-1.5">
                        <Label className="text-xs">去程提早上車</Label>
                        <Controller
                          control={control}
                          name="driverPickupMinutes"
                          render={({ field }) => (
                            <Select
                              value={String(field.value)}
                              onValueChange={(v) => field.onChange(Number(v))}
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {DRIVER_PICKUP_OPTIONS.map((m) => (
                                  <SelectItem key={m} value={String(m)}>
                                    {m === 0 ? "準時（開始時間）" : `提早 ${m} 分鐘`}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        />
                      </div>
                    )}
                    <div className="space-y-1.5">
                      <Label className="text-xs">上車地點（空白＝{DEFAULT_PICKUP_PLACE}）</Label>
                      <Input
                        {...register("driverPickupLocation")}
                        placeholder={`例：${DEFAULT_PICKUP_PLACE}、公司`}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">給司機的備註</Label>
                    <Input {...register("driverNote")} placeholder="例：在 B1 停車場等、要帶輪椅" />
                  </div>
                  <DriverPreview
                    trip={watch("driverTrip")}
                    allDay={allDay}
                    startWall={startWall}
                    endWall={endWall}
                    pickupMinutes={watch("driverPickupMinutes")}
                    home={watch("driverPickupLocation").trim() || DEFAULT_PICKUP_PLACE}
                    dest={watch("location").trim() || "（地點未填）"}
                  />
                </div>
              )}
            </div>

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
                    {billingContact && plans.length > 0 && (
                      <LessonPlanPicker
                        contactName={billingContact.name}
                        plans={plans}
                        selectedId={financePlanId}
                        subjectCount={subjectIds.length}
                        maxHeadcount={maxHeadcount}
                        onSelect={(id) => {
                          planManualRef.current = true;
                          // 主動換方案＝要用新方案的價錢
                          amountTouchedRef.current = false;
                          setValue("financePlanId", id);
                        }}
                      />
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
                          {...register("financeAmount", {
                            onChange: () => {
                              amountTouchedRef.current = true;
                            },
                          })}
                          placeholder="0"
                        />
                      </div>
                    </div>
                    {selectedPlan && isMonthlyPlan(selectedPlan) && (
                      <p className="text-xs text-muted-foreground">
                        {planSummary(selectedPlan)}：
                        {selectedPlan.extra_fee
                          ? `這堂只付${extraLabel(selectedPlan)} ${twd(selectedPlan.extra_fee)}；`
                          : "這堂不另計費（記為 NT$0、已結清，報表照樣計堂數）；"}
                        月底到「報表 → 月薪結算」記錄當月月薪。
                      </p>
                    )}
                    {selectedPlan && !isMonthlyPlan(selectedPlan) && suggestedAmount != null && (
                      <PlanAmountHint
                        summary={planSummary(selectedPlan)}
                        hourly={selectedPlan.billing_mode === "hourly"}
                        minutes={durationMin}
                        suggested={suggestedAmount}
                        extra={
                          selectedPlan.extra_fee
                            ? { label: extraLabel(selectedPlan), fee: selectedPlan.extra_fee }
                            : null
                        }
                        current={Math.round(Number(watch("financeAmount")) || 0)}
                        subjectCount={subjectIds.length}
                        onApply={() => {
                          amountTouchedRef.current = false;
                          setValue("financeAmount", String(suggestedAmount));
                        }}
                      />
                    )}
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
              <Button type="submit" disabled={pending || checking}>
                {pending ? "儲存中…" : checking ? "檢查時段…" : "儲存"}
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

/** 上課形式：老師的收費方案（1對1／1對2…）切換鈕，附人數不符提示 */
function LessonPlanPicker({
  contactName,
  plans,
  selectedId,
  subjectCount,
  maxHeadcount,
  onSelect,
}: {
  contactName: string;
  plans: RatePlan[];
  selectedId: string | null;
  subjectCount: number;
  maxHeadcount: number;
  onSelect: (id: string) => void;
}) {
  const selected = plans.find((p) => p.id === selectedId) ?? null;
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">上課形式（{contactName}）</Label>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="上課形式">
        {plans.map((p) => {
          const active = p.id === selectedId;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onSelect(p.id)}
              className={cn(
                "rounded-full border px-3 py-1 text-sm transition touch:py-2",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "hover:bg-accent",
              )}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      {selected && selected.headcount > Math.max(subjectCount, 1) && (
        <p className="text-xs text-amber-600">
          {selected.label} 但主角只選了 {subjectCount} 位小孩，要不要補上另一位？
        </p>
      )}
      {subjectCount > maxHeadcount && (
        <p className="text-xs text-amber-600">
          {contactName} 沒有 1對{subjectCount} 的方案，金額先用 {selected?.label ?? "現有方案"} 計算；
          可到「設定 → 人物」新增。
        </p>
      )}
    </div>
  );
}

/** 依方案算出的建議金額；與目前金額不同時提供［套用］ */
function PlanAmountHint({
  summary,
  hourly,
  minutes,
  suggested,
  extra,
  current,
  subjectCount,
  onApply,
}: {
  summary: string;
  hourly: boolean;
  minutes: number;
  suggested: number;
  /** 每次加收（如交通費 100） */
  extra: { label: string; fee: number } | null;
  current: number;
  subjectCount: number;
  onApply: () => void;
}) {
  const hours = Math.round((minutes / 60) * 100) / 100;
  const each = subjectCount >= 2 ? splitAmount(current || suggested, subjectCount) : null;
  return (
    <div className="space-y-0.5 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-x-2">
        <span>
          依方案：{summary}
          {hourly ? ` × ${hours} 小時` : ""}
          {extra ? ` ＋ ${extra.label} ${twd(extra.fee)}` : ""} = {twd(suggested)}
        </span>
        {current !== suggested && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={onApply}
          >
            套用 {twd(suggested)}
          </Button>
        )}
      </div>
      {each && (
        <div>
          統計時 {subjectCount} 位小孩各分 {each.map((n) => twd(n)).join("／")}
        </div>
      )}
    </div>
  );
}

/** 司機接送預覽：讓使用者確認上車時間與起訖點 */
function DriverPreview({
  trip,
  allDay,
  startWall,
  endWall,
  pickupMinutes,
  home,
  dest,
}: {
  trip: DriverTrip;
  allDay: boolean;
  startWall: string;
  endWall: string;
  pickupMinutes: number;
  home: string;
  dest: string;
}) {
  const lines: string[] = [];
  if (trip !== "from") {
    const t = allDay ? "整日" : addMinutesToWall(startWall, -pickupMinutes).slice(11);
    lines.push(`去程 ${t} 上車：${home} → ${dest}`);
  }
  if (trip !== "to") {
    const t = allDay ? "整日" : endWall.slice(11);
    lines.push(`回程 ${t} 上車：${dest} → ${home}`);
  }
  return (
    <div className="rounded bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground">
      {lines.map((l) => (
        <div key={l}>{l}</div>
      ))}
    </div>
  );
}

const HABIT_FIELD_LABEL: Record<string, string> = {
  time: "時間",
  calendar: "分類",
  subjects: "主角",
  participants: "相關人物",
  tags: "標籤",
  location: "地點",
  driver: "司機接送",
};

/** 語音解析面板：原句＋待確認／依過去紀錄帶入／假設，讓使用者一眼知道要補什麼 */
function VoicePanel({ hints }: { hints: VoiceHints }) {
  const habit = hints.fromHabit.map((f) => HABIT_FIELD_LABEL[f] ?? f);
  return (
    <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
      <div className="flex items-start gap-2">
        <Mic className="mt-0.5 size-4 shrink-0 text-primary" />
        <span className="text-muted-foreground">「{hints.transcript}」</span>
      </div>
      {hints.warnings.length > 0 && (
        <ul className="space-y-1">
          {hints.warnings.map((w) => (
            <li key={w} className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {w}
            </li>
          ))}
        </ul>
      )}
      {habit.length > 0 && (
        <div className="flex items-start gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
          <History className="mt-0.5 size-3.5 shrink-0" />
          依過去紀錄帶入：{habit.join("、")}（請確認是否相同）
        </div>
      )}
      {hints.assumptions.map((a) => (
        <div key={a} className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          {a}
        </div>
      ))}
      {hints.warnings.length === 0 && (
        <div className="text-xs text-muted-foreground">資訊看起來完整，確認無誤即可儲存。</div>
      )}
    </div>
  );
}
