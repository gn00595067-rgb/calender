"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm, Controller } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Star, Mic, AlertTriangle, History, Info, Loader2, Plus, X, ChevronUp } from "lucide-react";
import { MicButton } from "@/components/voice/mic-button";
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
import { Calendar } from "@/components/ui/calendar";
import { zhTW } from "react-day-picker/locale";
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
  DEFAULT_REMINDER_MINUTES,
  DEFAULT_REMINDER2_MINUTES,
  type PaymentMethod,
} from "@/lib/constants";
import { createEventAction, updateEventAction, deleteEventAction } from "@/lib/actions/events";
import { utcToTaipeiWall, taipeiWallToUtcISO, twd } from "@/lib/date";
import { addMinutesToWall, wallWeekday, diffMinutes } from "@/lib/wall-time";
import { fetchEventsInRange, useSeriesStarts, type CalEvent } from "@/lib/client/events";
import { ConflictPrompt } from "./conflict-prompt";
import { generateDates, occurrenceDates } from "@/lib/recurrence";
import { applySubjectTitle, stripSubjectSuffix } from "@/lib/subject-title";
import { eventSentence } from "@/lib/event-summary";
import {
  extraLabel,
  isMonthlyPlan,
  pickPlan,
  planAmount,
  planSummary,
  splitAmount,
  looksNonLesson,
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
  recurrence: "none" | "daily" | "weekly" | "biweekly" | "monthly" | "dates";
  recurrenceUntil: string;
  recurrenceWeekdays: number[];
  /** 指定日期（多選）：開始日以外的其他日期 yyyy-MM-dd */
  recurrenceDates: string[];
  reminderMinutes: number | null;
  /** 再提醒一次（例如 1 天前） */
  reminder2Minutes: number | null;
  scope: "this" | "following";
  subjectIds: string[];
  participantIds: string[];
  /** 標題後面加「-主角名」（取消＝只留原標題，如「0730小游」） */
  suffixSubjects: boolean;
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
  /** 回程送到哪；空白＝家 */
  driverDropoffLocation: string;
  driverNote: string;
  /** 編輯重複行程：延長重複到哪天（空＝不延長） */
  extendUntil: string;
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
  recurrenceDates?: string[];
  /** 編輯模式（語音修改）：重複行程預設的套用範圍 */
  scope?: "this" | "following";
  /** 語音判斷這是不是上課；false（談話、開會…）→ 不自動帶上課費 */
  isLesson?: boolean;
  /** 語音解析結果的說明（原句與提示），顯示在表單頂端供確認 */
  voice?: VoiceHints;
}

/** 語音解析提示：待確認／依過去紀錄帶入／假設 */
export interface VoiceHints {
  transcript: string;
  warnings: string[];
  fromHabit: string[];
  assumptions: string[];
  /** 一句話拆成多筆時：目前第幾筆／共幾筆 */
  position?: { index: number; total: number };
  /** 用語音回答助理的問題：送出回答與表單現值，成功回 null、失敗回錯誤訊息 */
  onAnswer?: (answer: string, current: Record<string, unknown>) => Promise<string | null>;
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
  /** 已套用過「排行程預設」的人物（每位只套一次） */
  const templateRef = useRef<string | null>(null);
  /** 不是上課而沒有自動帶入上課費時的說明（顯示在財務區） */
  const [feeSkipNote, setFeeSkipNote] = useState<string | null>(null);
  /** 語音帶入時先只看一句話摘要，全部欄位收起來；要改再展開 */
  const isVoiceDraft = mode === "create" && !!draft?.voice;
  const [detailsOpen, setDetailsOpen] = useState(!isVoiceDraft);

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
  /** 使用者手動改過提醒 → 切整日時不再自動改 */
  const reminderTouchedRef = useRef(false);

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
      recurrenceDates: draft?.recurrenceDates ?? [],
      reminderMinutes: DEFAULT_REMINDER_MINUTES,
      reminder2Minutes: DEFAULT_REMINDER2_MINUTES,
      scope: "this",
      subjectIds: draft?.subjectIds ?? [],
      participantIds: draft?.participantIds ?? [],
      suffixSubjects: true,
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
      driverDropoffLocation: "",
      driverNote: "",
      extendUntil: "",
    };
  }

  // 開啟時載入初始值
  useEffect(() => {
    if (!open) return;
    setConflictList(null);
    pendingValues.current = null;
    amountTouchedRef.current = false;
    reminderTouchedRef.current = false;
    planManualRef.current = false;
    billingContactRef.current = null;
    templateRef.current = null;
    setFeeSkipNote(null);
    setDetailsOpen(!(mode === "create" && !!draft?.voice));
    // 語音已判斷出主角時以語音為準；編輯舊行程不自動改
    subjectsTouchedRef.current = mode === "edit" || !!draft?.subjectIds?.length;
    if (mode === "edit" && event) {
      // 語音修改：draft 帶著要改的欄位（新時間、地點…），其餘照原本
      reset({
        calendarId: event.calendar_id,
        title: draft?.title ?? event.title,
        description: event.description ?? "",
        location: draft?.location ?? event.location ?? "",
        allDay: event.all_day,
        startWall: draft?.startWall ?? utcToTaipeiWall(event.starts_at),
        endWall: draft?.endWall ?? utcToTaipeiWall(event.ends_at),
        isImportant: event.is_important,
        // 單筆行程編輯時也能改成重複（Peggy 回饋：編輯時重複欄位不見了）
        recurrence: "none",
        recurrenceUntil: plusMonths(utcToTaipeiWall(event.starts_at).slice(0, 10), 3),
        recurrenceWeekdays: [wallWeekday(utcToTaipeiWall(event.starts_at))],
        recurrenceDates: [],
        reminderMinutes: event.reminder_minutes ?? null,
        reminder2Minutes: event.reminder2_minutes ?? null,
        scope: draft?.scope ?? "this",
        subjectIds: [],
        participantIds: [],
        suffixSubjects: true,
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
        driverDropoffLocation: event.driver?.dropoffLocation ?? "",
        driverNote: event.driver?.note ?? "",
        extendUntil: "",
      });
    } else {
      reset(buildDefaults());
    }
    // draft：語音追問回答後會換一份新的 draft，要重新帶入
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, event?.id, mode, draft]);

  // 編輯：帶入既有人物與財務
  useEffect(() => {
    if (mode !== "edit" || !editData.data) return;
    setValue("subjectIds", editData.data.subjectIds);
    setValue("participantIds", editData.data.participantIds);
    // 有主角但標題沒有「-主角名」＝之前刻意拿掉，維持不加
    if (event && allContacts.length) {
      const names = editData.data.subjectIds
        .map((id) => allContacts.find((c) => c.id === id))
        .filter((c) => c && !c.is_self)
        .map((c) => c!.name);
      const family = allContacts.filter((c) => c.is_family).map((c) => c.name);
      setValue(
        "suffixSubjects",
        names.length === 0 || stripSubjectSuffix(event.title, family) !== event.title,
      );
    }
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
  }, [editData.data, allContacts.length]);

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
  // 新增時預設 2 小時前＋1 天前提醒；整日行程改為不提醒（否則前一晚會跳通知）
  useEffect(() => {
    if (!open || mode !== "create" || reminderTouchedRef.current) return;
    setValue("reminderMinutes", allDay ? null : DEFAULT_REMINDER_MINUTES);
    setValue("reminder2Minutes", allDay ? null : DEFAULT_REMINDER2_MINUTES);
  }, [open, mode, allDay, setValue]);
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
  // 這次編輯改了時長或上課形式 → 金額要重算（Peggy 回饋：灰字提示很容易沒看到）
  const origDuration = event
    ? diffMinutes(utcToTaipeiWall(event.starts_at), utcToTaipeiWall(event.ends_at))
    : null;
  const priceInputsChanged =
    mode === "create" ||
    durationMin !== origDuration ||
    (!!editData.data?.finance && financePlanId !== (editData.data.finance.rate_plan_id ?? null));

  // 編輯重複行程：系列共幾次、到哪天，可延長
  const series = useSeriesStarts(isRecurringEdit && open ? (event?.recurrence_group_id ?? null) : null);
  const seriesDates = (series.data ?? []).map((iso) => utcToTaipeiWall(iso).slice(0, 10));
  const seriesLast = seriesDates.at(-1) ?? null;
  const seriesRule = (event?.recurrence_rule ?? null) as
    | "daily"
    | "weekly"
    | "biweekly"
    | "monthly"
    | null;

  /** 存檔時要多建的日期：單筆改成重複，或延長重複系列 */
  function addDatesOf(v: FormValues): string[] {
    const start = v.startWall.slice(0, 10);
    if (mode !== "edit") return [];
    if (!isRecurringEdit) {
      if (v.recurrence === "none") return [];
      return occurrenceDates({
        startDate: start,
        recurrence: v.recurrence,
        until: v.recurrenceUntil || null,
        weekdays: v.recurrence === "weekly" ? v.recurrenceWeekdays : null,
        dates: v.recurrenceDates,
      }).filter((d) => d !== start);
    }
    if (!seriesRule || !seriesLast || !v.extendUntil || v.extendUntil <= seriesLast) return [];
    // 每週：沿用系列裡出現過的星期（每週二、四）
    const weekdays =
      seriesRule === "weekly" ? [...new Set(seriesDates.map((d) => wallWeekday(`${d}T12:00`)))] : null;
    return generateDates(seriesLast, seriesRule, v.extendUntil, weekdays).filter(
      (d) => d > seriesLast,
    );
  }

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

  // 排行程預設：相關人物中第一位有設預設分類／標籤的人（回饋 23：采婕＝哥哥+妹妹、家教）
  const templateContact =
    participantIds
      .map((id) => (contactsBilling.data ?? []).find((b) => b.id === id))
      .find((b) => b && (b.default_calendar_id || b.default_tag_names.length > 0)) ?? null;
  const templateCalendar =
    templateContact?.default_calendar_id &&
    editableCalendars.some((c) => c.id === templateContact.default_calendar_id)
      ? templateContact.default_calendar_id
      : null;
  useEffect(() => {
    if (!open || mode !== "create" || !templateContact) return;
    if (templateRef.current === templateContact.id) return;
    templateRef.current = templateContact.id;
    if (templateCalendar) setValue("calendarId", templateCalendar);
    const tags = getValues("tagNames");
    const add = templateContact.default_tag_names.filter((t) => !tags.includes(t));
    if (add.length) setValue("tagNames", [...tags, ...add]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, templateContact?.id]);

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
    // 談話、開會等不是上課：預設值照帶，但財務先不打開（要算錢再手動打開）
    const nonLesson =
      mode === "create" && (draft?.isLesson === false || looksNonLesson(getValues("title")));
    setFeeSkipNote(
      nonLesson
        ? `這看起來不是上課，沒有自動算 ${c.name} 的上課費；如果要記這筆費用（例如算在上班時間的行政工作），把財務打開即可。`
        : null,
    );
    setValue("financeEnabled", !nonLesson);
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

  // 方案／時長變動、或手動打開財務 → 重算金額（使用者沒手動改過才覆蓋）
  const financeOn = watch("financeEnabled");
  useEffect(() => {
    if (suggestedAmount == null || amountTouchedRef.current) return;
    if (!financeOn) return;
    setValue("financeAmount", String(suggestedAmount));
    // 月薪制：這堂不用另外付錢，直接算已結清（錢在月底的月薪那筆）
    if (isMonthlyPlan(selectedPlan) && !selectedPlan?.extra_fee) setValue("financeSettled", true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestedAmount, financeOn]);

  /**
   * 找出與此行程同時段的既有時段行程（全部可存取分類；排除自己與整日行程）。
   * 新增重複／指定日期時，逐一比對每個日期的同一時段。
   */
  async function findConflicts(v: FormValues): Promise<CalEvent[]> {
    if (v.allDay) return [];
    const startIso = taipeiWallToUtcISO(v.startWall);
    const endIso = taipeiWallToUtcISO(v.endWall);
    if (endIso <= startIso) return [];
    const durationMs = +new Date(endIso) - +new Date(startIso);
    const time = v.startWall.slice(11);
    const dates =
      mode === "create"
        ? occurrenceDates({
            startDate: v.startWall.slice(0, 10),
            recurrence: v.recurrence,
            until: v.recurrenceUntil || null,
            weekdays: v.recurrence === "weekly" ? v.recurrenceWeekdays : null,
            dates: v.recurrenceDates,
          })
        : [v.startWall.slice(0, 10), ...addDatesOf(v)];
    const slots = dates.map((ds) => {
      const s = +new Date(taipeiWallToUtcISO(`${ds}T${time}`));
      return [s, s + durationMs] as const;
    });
    const found = await fetchEventsInRange(
      new Date(slots[0][0]).toISOString(),
      new Date(slots[slots.length - 1][1]).toISOString(),
      calendars.map((c) => c.id),
    );
    return found.filter((e) => {
      if (e.all_day || e.id === event?.id) return false;
      const es = +new Date(e.starts_at);
      const ee = +new Date(e.ends_at);
      return slots.some(([s, en]) => es < en && ee > s);
    });
  }

  /** 一句話描述（時　人　事（地）），給語音快速確認與存好後的確認訊息 */
  function sentenceOf(v: FormValues): string {
    const nameOf = (id: string) => allContacts.find((c) => c.id === id)?.name;
    return eventSentence({
      title: v.title,
      startWall: v.startWall,
      endWall: v.endWall,
      allDay: v.allDay,
      recurrence: mode === "create" ? v.recurrence : "none",
      weekdays: v.recurrenceWeekdays,
      until: v.recurrenceUntil || null,
      dates:
        mode === "create" && v.recurrence !== "none"
          ? occurrenceDates({
              startDate: v.startWall.slice(0, 10),
              recurrence: v.recurrence,
              until: v.recurrenceUntil || null,
              weekdays: v.recurrence === "weekly" ? v.recurrenceWeekdays : null,
              dates: v.recurrenceDates,
            })
          : undefined,
      subjects: v.subjectIds.map(nameOf).filter((n): n is string => !!n),
      selfName: allContacts.find((c) => c.is_self)?.name ?? null,
      participants: v.participantIds.map(nameOf).filter((n): n is string => !!n),
      location: v.location,
    });
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
  }, () => setDetailsOpen(true));

  /** 實際儲存；成功後刪除使用者在衝突面板勾選的舊行程 */
  function save(v: FormValues, deleteIds: string[]) {
    const driver = v.driverEnabled
      ? {
          trip: v.driverTrip,
          pickupMinutes: v.driverPickupMinutes,
          // 只有回程沒有上車地點、只有去程沒有回程地點
          pickupLocation: v.driverTrip !== "from" ? v.driverPickupLocation.trim() || null : null,
          dropoffLocation: v.driverTrip !== "to" ? v.driverDropoffLocation.trim() || null : null,
          note: v.driverNote.trim() || null,
        }
      : null;
    const addDates = addDatesOf(v);
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
              recurrenceUntil:
                v.recurrence === "none" || v.recurrence === "dates" ? null : v.recurrenceUntil,
              dates: v.recurrence === "dates" ? v.recurrenceDates : null,
              weekdays:
                v.recurrence === "weekly" && v.recurrenceWeekdays.length
                  ? v.recurrenceWeekdays
                  : null,
              reminderMinutes: v.reminderMinutes,
              reminder2Minutes: v.reminder2Minutes,
              subjectIds: v.subjectIds,
              participantIds: v.participantIds,
              suffixSubjects: v.suffixSubjects,
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
              reminder2Minutes: v.reminder2Minutes,
              scope: v.scope,
              subjectIds: v.subjectIds,
              participantIds: v.participantIds,
              suffixSubjects: v.suffixSubjects,
              tagNames: v.tagNames,
              finance,
              driver,
              addDates,
              recurrenceRule:
                !isRecurringEdit && v.recurrence !== "none" && v.recurrence !== "dates"
                  ? v.recurrence
                  : null,
            });

      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      // 部分設定沒存到（如資料庫未更新）：明確提醒，不要讓人以為都存好了
      if (res.data?.warning) toast.warning(res.data.warning, { duration: 10000 });
      let deleted = 0;
      for (const id of deleteIds) {
        const r = await deleteEventAction(id, "this");
        if (r.ok) deleted++;
      }
      const added = mode === "edit" && res.data && "added" in res.data ? (res.data.added ?? 0) : 0;
      const base =
        mode === "create"
          ? "已新增行程"
          : added
            ? `已更新行程，並新增 ${added} 筆重複`
            : "已更新行程";
      // 一句話把人事時地念一次，讓輸入的人（或第二個人）一眼核對
      const sentence = sentenceOf(v);
      const confirm = {
        description: sentence,
        duration: 12000,
        closeButton: true,
        action: { label: "新增紀錄", onClick: () => router.push("/recent") },
      };
      if (deleteIds.length === 0) toast.success(base, confirm);
      else if (deleted === deleteIds.length)
        toast.success(`${base}，並刪除 ${deleted} 筆舊行程`, confirm);
      else toast.error(`${base}，但有 ${deleteIds.length - deleted} 筆舊行程刪除失敗，請手動處理`);
      await qc.invalidateQueries({ queryKey: ["events"] });
      onOpenChange(false);
      router.refresh();
      onSaved?.();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-lg"
        // 手機上點到外面（或鍵盤／下拉選單邊緣）不要關閉，否則語音帶入的行程全沒了；
        // 要關請按右上角 X 或「取消」
        onInteractOutside={(e) => e.preventDefault()}
      >
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
            {mode === "create" && draft?.voice && (
              <VoicePanel
                hints={draft.voice}
                summary={sentenceOf(watch())}
                facts={[
                  ...(watch("driverEnabled") ? ["要司機接送"] : []),
                  ...(watch("financeEnabled") && watch("financeAmount")
                    ? [`費用 NT$${Number(watch("financeAmount")).toLocaleString("zh-TW")}`]
                    : []),
                  ...(watch("isImportant") ? ["重點行程"] : []),
                ]}
                detailsOpen={detailsOpen}
                onToggleDetails={() => setDetailsOpen((o) => !o)}
                getCurrent={() => {
                  const v = getValues();
                  return {
                    title: v.title,
                    calendarId: v.calendarId,
                    allDay: v.allDay,
                    startWall: v.startWall,
                    endWall: v.endWall,
                    location: v.location,
                    isImportant: v.isImportant,
                    subjectIds: v.subjectIds,
                    participantIds: v.participantIds,
                    tagNames: v.tagNames,
                    needsDriver: v.driverEnabled,
                    recurrence: v.recurrence,
                    weekdays: v.recurrenceWeekdays,
                    extraDates: v.recurrenceDates,
                  };
                }}
              />
            )}
            {mode === "edit" && draft?.voice && (
              <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
                <Mic className="mt-0.5 size-4 shrink-0 text-primary" />
                <div>
                  <div className="text-muted-foreground">「{draft.voice.transcript}」</div>
                  <div className="mt-1 text-xs">已帶入要修改的內容，確認無誤後按「儲存」。</div>
                </div>
              </div>
            )}
            <div className={detailsOpen ? "space-y-4" : "hidden"}>
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
              <SubjectSuffixToggle
                control={control}
                title={watch("title")}
                subjectNames={subjectIds
                  .map((id) => allContacts.find((c) => c.id === id))
                  .filter((c) => c && !c.is_self)
                  .map((c) => c!.name)}
                familyNames={allContacts.filter((c) => c.is_family).map((c) => c.name)}
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
              {/* 防呆：分類跟老師的預設不同（同一位老師分類常選錯） */}
              {templateContact && templateCalendar && calendarId !== templateCalendar && (
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-amber-700 dark:text-amber-400">
                  <span>
                    {templateContact.name} 的行程平常用「{calendarById.get(templateCalendar)?.name}」分類
                  </span>
                  <button
                    type="button"
                    className="underline underline-offset-2"
                    onClick={() => setValue("calendarId", templateCalendar)}
                  >
                    改用
                  </button>
                </p>
              )}
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
                誰的行程（主角）
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  本人或哪個小孩
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
                    usageRole="subject"
                  />
                )}
              />
              {autoSubjectNote ? (
                <p className="text-xs text-muted-foreground">{autoSubjectNote}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  分類名稱有人名（如「哥哥+妹妹」）會自動帶入；用來算每個人的空檔、費用分攤與報表。
                </p>
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
                    usageRole="participant"
                    // 依目前主角排「常一起的人」：本人→客戶同事、小孩→他的老師
                    context={{
                      subjectIds,
                      label:
                        subjectIds
                          .map((id) => allContacts.find((c) => c.id === id))
                          .filter((c) => c && !c.is_self)
                          .map((c) => c!.name)
                          .join("、") || "本人",
                    }}
                  />
                )}
              />
              {/* 回饋 20：會不會通知對方？能不能在這裡新增？ */}
              <p className="text-xs text-muted-foreground">
                只是記錄是跟誰，不會通知對方。清單裡沒有的人，在選單最下面輸入姓名按「＋」就能新增。
              </p>
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
                {/* 開新分頁，避免離開表單而遺失正在填的行程 */}
                <Link
                  href="/settings/tags"
                  target="_blank"
                  className="underline underline-offset-2"
                >
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
                {/* 兩個提醒並排：預設 2 小時前＋1 天前 */}
                <div className="grid grid-cols-2 gap-2">
                  {(["reminderMinutes", "reminder2Minutes"] as const).map((name) => (
                    <Controller
                      key={name}
                      control={control}
                      name={name}
                      render={({ field }) => (
                        <Select
                          value={field.value == null ? "none" : String(field.value)}
                          onValueChange={(v) => {
                            reminderTouchedRef.current = true;
                            field.onChange(v === "none" ? null : Number(v));
                          }}
                        >
                          <SelectTrigger className="w-full" aria-label={name === "reminderMinutes" ? "提醒" : "再提醒一次"}>
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
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  可提前提醒；桌面通知需開啟瀏覽器通知權限，Email 提醒依帳號設定寄送。
                </p>
              </div>
            )}

            {isRecurringEdit && (
              <SeriesExtendField
                rule={seriesRule}
                count={seriesDates.length}
                last={seriesLast}
                register={register("extendUntil")}
                adding={addDatesOf(watch()).length}
              />
            )}
            {!isRecurringEdit && (
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
                {recurrence === "dates" && (
                  <div className="space-y-2 sm:col-span-2">
                    <Label>日期（同一時間，可加多個）</Label>
                    <Controller
                      control={control}
                      name="recurrenceDates"
                      render={({ field }) => (
                        <RecurrenceDatesField
                          startDate={startWall.slice(0, 10)}
                          value={field.value}
                          onChange={field.onChange}
                        />
                      )}
                    />
                  </div>
                )}
                {recurrence !== "none" && recurrence !== "dates" && (
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
                {mode === "edit" && recurrence !== "none" && (
                  <p className="text-xs text-muted-foreground sm:col-span-2">
                    存檔後這筆會變成重複行程，另外新增 {addDatesOf(watch()).length} 筆（內容、時間照這筆）。
                  </p>
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
                    {!allDay && (
                      <div className="space-y-1.5">
                        <Label className="text-xs">單程車程（空檔會扣掉）</Label>
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
                                    {m === 0 ? "不算車程" : `約 ${m} 分鐘`}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        />
                      </div>
                    )}
                    {watch("driverTrip") !== "from" && (
                      <div className="space-y-1.5">
                        <Label className="text-xs">上車地點（空白＝{DEFAULT_PICKUP_PLACE}）</Label>
                        <Input
                          {...register("driverPickupLocation")}
                          placeholder={`例：${DEFAULT_PICKUP_PLACE}、公司`}
                        />
                      </div>
                    )}
                    {watch("driverTrip") !== "to" && (
                      <div className="space-y-1.5">
                        <Label className="text-xs">回程送到（空白＝{DEFAULT_PICKUP_PLACE}）</Label>
                        <Input
                          {...register("driverDropoffLocation")}
                          placeholder={`例：${DEFAULT_PICKUP_PLACE}、公司`}
                        />
                      </div>
                    )}
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
                    back={watch("driverDropoffLocation").trim() || DEFAULT_PICKUP_PLACE}
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
                {!financeOn && feeSkipNote && (
                  <p className="mt-2 text-xs text-muted-foreground">{feeSkipNote}</p>
                )}
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
                        alert={priceInputsChanged}
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
                        重複／多個日期：每一堂都會各自產生一筆此金額的財務紀錄。
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button type="submit" disabled={pending || checking}>
                {pending
                  ? "儲存中…"
                  : checking
                    ? "檢查時段…"
                    : isVoiceDraft && !detailsOpen
                      ? "沒問題，新增"
                      : "儲存"}
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
  alert,
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
  /** 這次改了時間／上課形式：金額不符時用紅字提醒，不然很容易沒看到 */
  alert: boolean;
  subjectCount: number;
  onApply: () => void;
}) {
  const hours = Math.round((minutes / 60) * 100) / 100;
  const each = subjectCount >= 2 ? splitAmount(current || suggested, subjectCount) : null;
  if (alert && current !== suggested) {
    return (
      <div
        role="alert"
        className="space-y-1.5 rounded-md border border-red-300 bg-red-50 p-2.5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
      >
        <div className="flex items-start gap-1.5 font-semibold">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            金額要重算：依方案應為 {twd(suggested)}，目前填 {twd(current)}
          </span>
        </div>
        <div className="text-xs">
          {summary}
          {hourly ? ` × ${hours} 小時` : ""}
          {extra ? ` ＋ ${extra.label} ${twd(extra.fee)}` : ""} = {twd(suggested)}
        </div>
        <Button type="button" size="sm" className="h-7" onClick={onApply}>
          改成 {twd(suggested)}
        </Button>
      </div>
    );
  }
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
  back: backTo,
  dest,
}: {
  trip: DriverTrip;
  allDay: boolean;
  startWall: string;
  endWall: string;
  pickupMinutes: number;
  home: string;
  /** 回程送到 */
  back: string;
  dest: string;
}) {
  const lines: string[] = [];
  const leave = allDay ? "整日" : addMinutesToWall(startWall, -pickupMinutes).slice(11);
  const back = allDay ? "整日" : addMinutesToWall(endWall, pickupMinutes).slice(11);
  if (trip !== "from") {
    lines.push(`去程 ${leave} 上車：${home} → ${dest}`);
  }
  if (trip !== "to") {
    const t = allDay ? "整日" : endWall.slice(11);
    lines.push(`回程 ${t} 上車：${dest} → ${backTo}${pickupMinutes > 0 && !allDay ? `，約 ${back} 到` : ""}`);
  }
  // 車程也算沒空：讓使用者知道空檔會從哪裡算起
  if (!allDay && pickupMinutes > 0) {
    const from = trip === "from" ? startWall.slice(11) : leave;
    const to = trip === "to" ? endWall.slice(11) : back;
    lines.push(`含車程 ${from}–${to} 都不算空檔`);
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
function VoicePanel({
  hints,
  summary,
  facts,
  detailsOpen,
  onToggleDetails,
  getCurrent,
}: {
  hints: VoiceHints;
  /** 目前表單的一句話摘要（時　人　事（地）），隨修改即時更新 */
  summary: string;
  /** 摘要外值得一眼看到的設定：要司機、費用、重點 */
  facts: string[];
  detailsOpen: boolean;
  onToggleDetails: () => void;
  getCurrent: () => Record<string, unknown>;
}) {
  const habit = hints.fromHabit.map((f) => HABIT_FIELD_LABEL[f] ?? f);
  const [answering, setAnswering] = useState(false);
  const [answer, setAnswer] = useState("");
  const [sending, setSending] = useState(false);

  const send = async () => {
    const text = answer.trim();
    if (!text || !hints.onAnswer || sending) return;
    setSending(true);
    const err = await hints.onAnswer(text, getCurrent());
    setSending(false);
    if (err) {
      toast.error(err);
      return;
    }
    setAnswer("");
    setAnswering(false);
    toast.success("已依你的回答更新，請再確認一次");
  };

  return (
    <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
      {hints.position && hints.position.total > 1 && (
        <div className="text-xs font-semibold text-primary">
          第 {hints.position.index} / {hints.position.total} 筆（存好後自動帶下一筆）
        </div>
      )}
      {/* 一眼確認：一句話把時間、誰、做什麼、在哪念出來 */}
      <div className="rounded-md bg-background p-2.5">
        <div className="text-base font-semibold leading-relaxed">{summary}</div>
        {facts.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {facts.map((f) => (
              <span key={f} className="rounded-full bg-muted px-2 py-0.5 text-xs">
                {f}
              </span>
            ))}
          </div>
        )}
      </div>
      {hints.warnings.length > 0 ? (
        <ul className="space-y-1">
          {hints.warnings.map((w) => (
            <li key={w} className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {w}
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-xs text-muted-foreground">看起來沒問題，確認上面這句話對就按「沒問題，新增」。</div>
      )}
      {detailsOpen && (
        <>
          <div className="flex items-start gap-2 text-xs">
            <Mic className="mt-0.5 size-3.5 shrink-0 text-primary" />
            <span className="text-muted-foreground">你說：「{hints.transcript}」</span>
          </div>
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
        </>
      )}

      {/* 用語音回答／補充：不必手動改選單 */}
      {hints.onAnswer &&
        (answering ? (
          <div className="space-y-2 border-t border-primary/20 pt-2">
            <div className="relative">
              <Textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                rows={2}
                autoFocus
                placeholder="例：是豪哥的，大概一個半小時，地點在信義區"
                className="bg-background pr-11"
              />
              <div className="absolute right-2 top-2">
                <MicButton
                  title="用語音回答"
                  onInterim={(t) => setAnswer(t)}
                  onFinal={(t) => setAnswer(t)}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => void send()}
                disabled={sending || !answer.trim()}
              >
                {sending ? <Loader2 className="size-4 animate-spin" /> : <Mic className="size-4" />}
                {sending ? "更新中…" : "送出回答"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setAnswering(false)}
                disabled={sending}
              >
                取消
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            size="sm"
            variant={hints.warnings.length ? "default" : "outline"}
            className="w-full"
            onClick={() => setAnswering(true)}
          >
            <Mic className="size-4" />
            {hints.warnings.length ? "用語音回答上面的問題" : "用語音補充或修改"}
          </Button>
        ))}
      <Button type="button" size="sm" variant="ghost" className="w-full" onClick={onToggleDetails}>
        {detailsOpen ? "收起欄位" : "要改細節？展開全部欄位"}
      </Button>
    </div>
  );
}

const WEEKDAY_ZH = ["日", "一", "二", "三", "四", "五", "六"];

/** yyyy-MM-dd → 10/13（二） */
function shortDateLabel(ds: string): string {
  const [, m, d] = ds.split("-").map(Number);
  return `${m}/${d}（${WEEKDAY_ZH[wallWeekday(`${ds}T12:00`)]}）`;
}

/** yyyy-MM-dd ↔ 本地 Date（月曆元件用；只取年月日，不涉時區換算） */
function dsToDate(ds: string): Date {
  const [y, m, d] = ds.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function dateToDs(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * 指定日期（多選）：日期不規則的同一件事（如 10/13、10/16、10/20 都 14:00）。
 * 開始日永遠是第一個（改上面的開始日期即可換），其他日期點「＋ 加日期」展開月曆連續點選，可個別移除。
 * 不用原生 <input type="date">：電腦版 Chrome／Edge 只有點右側小日曆圖示才會開，
 * 透明蓋在按鈕上時點了完全沒反應（2026-10-12 Peggy 回報）。
 */
function RecurrenceDatesField({
  startDate,
  value,
  onChange,
}: {
  startDate: string;
  value: string[];
  onChange: (dates: string[]) => void;
}) {
  const extra = [...new Set(value)].filter((d) => d !== startDate).sort();
  const [picking, setPicking] = useState(false);
  const validStart = /^\d{4}-\d{2}-\d{2}$/.test(startDate);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        <span className="inline-flex items-center rounded-full border border-primary bg-primary px-2.5 py-1 text-sm text-primary-foreground tabular-nums">
          {shortDateLabel(startDate)}
          <span className="ml-1 text-xs opacity-80">開始日</span>
        </span>
        {extra.map((ds) => (
          <span
            key={ds}
            className="inline-flex items-center gap-1 rounded-full border bg-card px-2.5 py-1 text-sm tabular-nums"
          >
            {shortDateLabel(ds)}
            <button
              type="button"
              onClick={() => onChange(extra.filter((d) => d !== ds))}
              aria-label={`移除 ${ds}`}
              className="-mr-1 p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </span>
        ))}
        <button
          type="button"
          onClick={() => setPicking((v) => !v)}
          aria-expanded={picking}
          disabled={!validStart}
          className="inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-sm text-primary hover:bg-accent disabled:opacity-50"
        >
          {picking ? <ChevronUp className="size-3.5" /> : <Plus className="size-3.5" />}
          {picking ? "收起月曆" : "加日期"}
        </button>
      </div>
      {/* 月曆直接展開在表單裡（不用浮動視窗，手機上不會蓋住或跳出表單）；可連續點多天，再點一次取消 */}
      {picking && validStart && (
        <div className="w-fit rounded-lg border">
          <Calendar
            mode="multiple"
            locale={zhTW}
            defaultMonth={dsToDate(startDate)}
            selected={[startDate, ...extra].map(dsToDate)}
            disabled={{ before: dsToDate(startDate) }}
            onSelect={(dates) =>
              onChange(
                (dates ?? [])
                  .map(dateToDs)
                  .filter((d) => d !== startDate)
                  .sort(),
              )
            }
          />
          <div className="flex justify-end border-t px-2 py-1.5">
            <Button type="button" size="sm" variant="ghost" onClick={() => setPicking(false)}>
              完成
            </Button>
          </div>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        共 {extra.length + 1} 天、每天同一時間；之後可在任一筆選「此筆與之後全部」一起改或刪。
      </p>
    </div>
  );
}

/**
 * 「標題後面加主角名」開關：只在有非本人的主角時出現。
 * Peggy 回饋：本人和豪哥一起上的課，標題只要「0730小游」，不要「-豪哥」。
 */
function SubjectSuffixToggle({
  control,
  title,
  subjectNames,
  familyNames,
}: {
  control: import("react-hook-form").Control<FormValues>;
  title: string;
  subjectNames: string[];
  familyNames: string[];
}) {
  if (subjectNames.length === 0) return null;
  return (
    <Controller
      control={control}
      name="suffixSubjects"
      render={({ field }) => {
        const preview = applySubjectTitle(title, field.value ? subjectNames : [], familyNames);
        return (
          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <Checkbox
              className="mt-0.5"
              checked={field.value}
              onCheckedChange={(c) => field.onChange(!!c)}
            />
            <span>
              標題後面加上主角名（-{subjectNames.join("、")}）
              {title.trim() && (
                <span className="block text-foreground">存檔後標題：{preview}</span>
              )}
            </span>
          </label>
        );
      }}
    />
  );
}

const RULE_LABEL: Record<string, string> = {
  daily: "每天",
  weekly: "每週",
  biweekly: "每兩週",
  monthly: "每月",
};

/** 編輯重複行程：顯示系列共幾次、到哪天；有規則的系列可延長 */
function SeriesExtendField({
  rule,
  count,
  last,
  register: reg,
  adding,
}: {
  rule: string | null;
  count: number;
  last: string | null;
  register: import("react-hook-form").UseFormRegisterReturn;
  adding: number;
}) {
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <Label className="font-medium">重複</Label>
      <p className="text-sm">
        {rule ? RULE_LABEL[rule] ?? "重複" : "指定日期"}
        {last ? `，到 ${shortDateLabel(last)}，共 ${count} 次` : ""}
      </p>
      {rule ? (
        <div className="space-y-1.5">
          <Label htmlFor="ev-extend" className="text-xs">
            延長重複到（選填）
          </Label>
          <Input id="ev-extend" type="date" min={last ?? undefined} {...reg} />
          {adding > 0 && (
            <p className="text-xs text-primary">存檔後會再新增 {adding} 筆（內容、時間照這筆）。</p>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">要加日期，請另外新增一筆「指定日期」行程。</p>
      )}
      <p className="text-xs text-muted-foreground">
        要提早結束：點最後想保留那筆的下一筆 → 刪除 →「此筆與之後全部」。
      </p>
    </div>
  );
}
