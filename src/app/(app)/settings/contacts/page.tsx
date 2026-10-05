"use client";

import { useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus, Trash2, User } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState, ListSkeleton } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CategorySelect } from "@/components/calendar/category-select";
import {
  BILLING_MODES,
  PAYMENT_METHODS,
  FINANCE_DIRECTIONS,
  PAYMENT_METHOD_LABEL,
  type BillingMode,
  type PaymentMethod,
} from "@/lib/constants";
import { twd } from "@/lib/date";
import { cn } from "@/lib/utils";
import { fetchPlansByContact, isLegacyPlanId, useContacts } from "@/lib/client/lookups";
import { defaultPlanLabel, planSummary, type RatePlan } from "@/lib/rate-plans";
import {
  createContactAction,
  updateContactAction,
  deleteContactAction,
} from "@/lib/actions/contacts";

interface FullContact {
  id: string;
  name: string;
  role_label: string | null;
  phone: string | null;
  note: string | null;
  is_family: boolean;
  billing_mode: "fixed" | "hourly" | null;
  default_rate: number | null;
  default_category_id: string | null;
  default_direction: "expense" | "income" | null;
  default_payment_method:
    | "monthly"
    | "per_time"
    | "prepaid_deduct"
    | "prepaid_term"
    | null;
  plans: RatePlan[];
}

/** 表單中的一列方案（金額以字串暫存，方便輸入） */
interface PlanDraft {
  key: string;
  id: string | null;
  label: string;
  headcount: number;
  billingMode: BillingMode;
  rate: string;
  /** 適用小孩；空＝不限 */
  subjectIds: string[];
}

function useContactsFull() {
  return useQuery({
    queryKey: ["contacts", "full"],
    queryFn: async (): Promise<FullContact[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("contacts")
        .select(
          "id, name, role_label, phone, note, is_family, billing_mode, default_rate, default_category_id, default_direction, default_payment_method",
        )
        .order("name", { ascending: true });
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      const plans = await fetchPlansByContact(rows);
      return rows.map((c) => ({ ...c, plans: plans.get(c.id) ?? [] }));
    },
  });
}

export default function ContactsSettingsPage() {
  const { data: contacts = [], isLoading } = useContactsFull();
  const nameById = new Map(contacts.map((c) => [c.id, c.name]));
  const qc = useQueryClient();
  const [editing, setEditing] = useState<FullContact | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<FullContact | null>(null);
  const [pending, startTransition] = useTransition();

  const invalidate = () => qc.invalidateQueries({ queryKey: ["contacts"] });

  const onDelete = () => {
    if (!deleting) return;
    const target = deleting;
    startTransition(async () => {
      const res = await deleteContactAction(target.id);
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(`已刪除「${target.name}」`);
        invalidate();
      }
      setDeleting(null);
    });
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="人物管理"
        description="家教老師、客戶、醫師等聯絡人，可於行程中關聯與搜尋。"
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            新增人物
          </Button>
        }
      />

      {isLoading ? (
        <ListSkeleton rows={4} />
      ) : contacts.length === 0 ? (
        <EmptyState
          icon={User}
          title="尚無人物"
          description="建立第一位聯絡人，例如小孩的家教老師。"
          action={<Button onClick={() => setCreating(true)}>新增人物</Button>}
        />
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {contacts.map((c) => (
            <li key={c.id} className="flex items-center gap-3 p-3">
              <span className="flex size-9 items-center justify-center rounded-full bg-muted text-sm font-medium">
                {c.name.charAt(0)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 truncate font-medium">
                  {c.name}
                  {c.is_family && (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                      家人
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  {c.role_label && <span>{c.role_label}</span>}
                  {c.plans.map((p) => (
                    <span
                      key={p.id}
                      className="rounded bg-muted px-1.5 py-0.5 tabular-nums"
                    >
                      {p.label}
                      {p.subject_ids.length > 0 &&
                        `（${p.subject_ids.map((id) => nameById.get(id) ?? "?").join("、")}）`}{" "}
                      {twd(p.rate)}
                      {p.billing_mode === "monthly" ? "／月" : p.billing_mode === "hourly" ? "／時" : "／堂"}
                    </span>
                  ))}
                  {c.plans.length > 0 && c.default_payment_method && (
                    <span>{PAYMENT_METHOD_LABEL[c.default_payment_method]}</span>
                  )}
                </div>
              </div>
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
            </li>
          ))}
        </ul>
      )}

      <ContactFormDialog
        open={creating}
        mode="create"
        onOpenChange={setCreating}
        onDone={invalidate}
      />
      <ContactFormDialog
        open={!!editing}
        mode="edit"
        contact={editing ?? undefined}
        onOpenChange={(o) => !o && setEditing(null)}
        onDone={invalidate}
      />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>刪除「{deleting?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              此人物將從所有關聯行程中移除。相關行程本身不會被刪除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDelete}
              disabled={pending}
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

function ContactFormDialog({
  open,
  mode,
  contact,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  mode: "create" | "edit";
  contact?: FullContact;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [roleLabel, setRoleLabel] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  // 收費方案（1對1／1對2…）
  const [plans, setPlans] = useState<PlanDraft[]>([]);
  const [defaultCategoryId, setDefaultCategoryId] = useState<string | null>(null);
  const [defaultDirection, setDefaultDirection] = useState<"expense" | "income">(
    "expense",
  );
  const [defaultPaymentMethod, setDefaultPaymentMethod] = useState<
    PaymentMethod | ""
  >("");
  const [isFamily, setIsFamily] = useState(false);
  const [pending, startTransition] = useTransition();
  const [init, setInit] = useState(false);

  if (open && !init) {
    setName(contact?.name ?? "");
    setRoleLabel(contact?.role_label ?? "");
    setPhone(contact?.phone ?? "");
    setNote(contact?.note ?? "");
    setIsFamily(contact?.is_family ?? false);
    setPlans(
      (contact?.plans ?? []).map((p) => ({
        key: p.id,
        // 舊費率暫代的方案（尚未套 0008）沒有真正的 id，存檔時當新方案
        id: isLegacyPlanId(p.id) ? null : p.id,
        label: p.label,
        headcount: p.headcount,
        billingMode: p.billing_mode,
        rate: String(p.rate),
        subjectIds: p.subject_ids,
      })),
    );
    setDefaultCategoryId(contact?.default_category_id ?? null);
    setDefaultDirection(contact?.default_direction ?? "expense");
    setDefaultPaymentMethod(contact?.default_payment_method ?? "");
    setInit(true);
  }
  if (!open && init) setInit(false);

  // 金額沒填的方案視為未完成，不送出
  const filledPlans = plans.filter((p) => p.rate.trim() !== "");
  // 只有「適用小孩相同、人數也相同」才真的分不出要挑哪個
  const planKey = (p: PlanDraft) => `${p.headcount}|${[...p.subjectIds].sort().join(",")}`;
  const dupHeadcount = filledPlans.some(
    (p, i) => filledPlans.findIndex((q) => planKey(q) === planKey(p)) !== i,
  );

  const submit = () => {
    startTransition(async () => {
      const hasRate = filledPlans.length > 0;
      const payload = {
        name,
        roleLabel: roleLabel || null,
        phone: phone || null,
        note: note || null,
        isFamily,
        plans: filledPlans.map((p) => ({
          id: p.id,
          label: p.label.trim() || defaultPlanLabel(p.headcount),
          headcount: p.headcount,
          billingMode: p.billingMode,
          rate: Math.round(Number(p.rate)),
          subjectIds: p.subjectIds,
        })),
        defaultCategoryId: defaultCategoryId,
        defaultDirection: hasRate ? defaultDirection : null,
        defaultPaymentMethod: defaultPaymentMethod || null,
      };
      const res =
        mode === "create"
          ? await createContactAction(payload)
          : await updateContactAction(contact!.id, payload);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(mode === "create" ? "已新增人物" : "已更新人物");
      onOpenChange(false);
      onDone();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "新增人物" : "編輯人物"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="ct-name">姓名</Label>
            <Input
              id="ct-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例：陳老師"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ct-role">稱謂／角色</Label>
            <Input
              id="ct-role"
              value={roleLabel}
              onChange={(e) => setRoleLabel(e.target.value)}
              placeholder="例：數學家教"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ct-phone">電話</Label>
            <Input
              id="ct-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="選填"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ct-note">備註</Label>
            <Input
              id="ct-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="選填"
            />
          </div>

          {/* 家人：可當「主角（誰的行程）」，例如小孩、本人 */}
          <label className="flex items-start gap-2 rounded-lg border p-3">
            <Checkbox
              checked={isFamily}
              onCheckedChange={(c) => setIsFamily(!!c)}
              className="mt-0.5"
            />
            <span className="text-sm">
              家人／本人（可當「主角」）
              <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                勾選後，此人會出現在行程的「主角（誰的行程）」欄與空檔聚焦，例如小孩、本人。
              </span>
            </span>
          </label>

          {/* 預設收費：設一次，新增行程選到此人即自動帶入 */}
          <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
            <div className="text-sm font-medium">
              收費方案（選填）
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                新增行程選到此人，會依小孩人數自動挑 1對1／1對2 並帶入金額
              </span>
            </div>
            <PlanEditor plans={plans} onChange={setPlans} />
            {dupHeadcount && (
              <p className="text-xs text-amber-600">
                有兩個方案的人數與適用小孩都相同，新增行程時會挑排在前面的那個。
                若是不同小孩不同價，請在各方案勾選「適用小孩」。
              </p>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">預設費用類別</Label>
              <CategorySelect
                value={defaultCategoryId}
                label={null}
                onChange={(id) => setDefaultCategoryId(id)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">收／支</Label>
                <Select
                  value={defaultDirection}
                  onValueChange={(v) =>
                    setDefaultDirection(v as "expense" | "income")
                  }
                >
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
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">付款方式</Label>
                <Select
                  value={defaultPaymentMethod || undefined}
                  onValueChange={(v) => setDefaultPaymentMethod(v as PaymentMethod)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="選擇" />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
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

/** 收費方案清單編輯：每列＝名稱、人數、計費方式、金額（整堂總價） */
function PlanEditor({
  plans,
  onChange,
}: {
  plans: PlanDraft[];
  onChange: (plans: PlanDraft[]) => void;
}) {
  // 可指定的小孩：標記為家人的人物
  const { data: allContacts = [] } = useContacts();
  const family = allContacts.filter((c) => c.is_family);
  const update = (key: string, patch: Partial<PlanDraft>) =>
    onChange(plans.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  const add = () => {
    // 新方案預設人數＝目前最大人數 + 1（第一個是 1對1，第二個是 1對2）
    const headcount = plans.reduce((m, p) => Math.max(m, p.headcount), 0) + 1;
    onChange([
      ...plans,
      {
        key: crypto.randomUUID(),
        id: null,
        label: defaultPlanLabel(headcount),
        headcount,
        billingMode: plans.at(-1)?.billingMode ?? "hourly",
        rate: "",
        subjectIds: [],
      },
    ]);
  };

  return (
    <div className="space-y-2">
      {plans.length === 0 && (
        <p className="text-xs text-muted-foreground">
          尚未設定。例：1對1 時薪 1,200、1對2 時薪 1,800（兩人一起的整堂價）。
        </p>
      )}
      {plans.map((p) => (
        <div key={p.key} className="space-y-2 rounded-md border bg-background p-2">
          <div className="flex items-center gap-2">
            <Input
              value={p.label}
              onChange={(e) => update(p.key, { label: e.target.value })}
              className="h-8 flex-1"
              placeholder="方案名稱"
              aria-label="方案名稱"
            />
            <Select
              value={String(p.headcount)}
              onValueChange={(v) => {
                const headcount = Number(v);
                // 名稱還是預設格式時，跟著人數改
                const auto =
                  p.label === defaultPlanLabel(p.headcount) || !p.label.trim();
                update(p.key, {
                  headcount,
                  ...(auto ? { label: defaultPlanLabel(headcount) } : {}),
                });
              }}
            >
              <SelectTrigger className="h-8 w-24" aria-label="上課人數">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} 位學生
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={() => onChange(plans.filter((x) => x.key !== p.key))}
              aria-label="刪除方案"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Select
              value={p.billingMode}
              onValueChange={(v) => update(p.key, { billingMode: v as BillingMode })}
            >
              <SelectTrigger className="h-8 w-full" aria-label="計費方式">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BILLING_MODES.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="number"
              min={0}
              step={1}
              value={p.rate}
              onChange={(e) => update(p.key, { rate: e.target.value })}
              className="h-8"
              placeholder={
                p.billingMode === "monthly"
                  ? "每月金額"
                  : p.billingMode === "hourly"
                    ? "每小時（整堂）"
                    : "每堂（整堂）"
              }
              aria-label="金額"
            />
          </div>
          {family.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">適用小孩：</span>
              <button
                type="button"
                onClick={() => update(p.key, { subjectIds: [] })}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 transition",
                  p.subjectIds.length === 0
                    ? "border-primary bg-primary text-primary-foreground"
                    : "hover:bg-accent",
                )}
              >
                不限
              </button>
              {family.map((f) => {
                const on = p.subjectIds.includes(f.id);
                return (
                  <button
                    key={f.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      const subjectIds = on
                        ? p.subjectIds.filter((id) => id !== f.id)
                        : [...p.subjectIds, f.id];
                      // 指定小孩時，人數跟著勾選的人數走
                      update(p.key, {
                        subjectIds,
                        ...(subjectIds.length ? { headcount: subjectIds.length } : {}),
                      });
                    }}
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 transition",
                      on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
                    )}
                  >
                    {f.name}
                  </button>
                );
              })}
            </div>
          )}
          {p.billingMode === "monthly" && p.rate.trim() !== "" && (
            <p className="text-[11px] text-muted-foreground">
              每月固定 {twd(Number(p.rate) || 0)}，每堂課不另計費；月底到「報表 → 月薪結算」記一筆（請假可調整金額）。
            </p>
          )}
          {p.billingMode !== "monthly" && p.headcount >= 2 && p.rate.trim() !== "" && (
            <p className="text-[11px] text-muted-foreground">
              {planSummary({
                label: p.label || defaultPlanLabel(p.headcount),
                billing_mode: p.billingMode,
                rate: Number(p.rate) || 0,
              })}
              ，為 {p.headcount} 人一起的整堂價；統計時平均分給每位小孩。
            </p>
          )}
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add}>
        <Plus className="size-4" />
        新增方案
      </Button>
    </div>
  );
}
