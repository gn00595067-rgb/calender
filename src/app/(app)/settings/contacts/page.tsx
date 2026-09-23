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
}

function useContactsFull() {
  return useQuery({
    queryKey: ["contacts", "full"],
    queryFn: async (): Promise<FullContact[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("contacts")
        .select(
          "id, name, role_label, phone, note, billing_mode, default_rate, default_category_id, default_direction, default_payment_method",
        )
        .order("name", { ascending: true });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export default function ContactsSettingsPage() {
  const { data: contacts = [], isLoading } = useContactsFull();
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
                <div className="truncate font-medium">{c.name}</div>
                <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  {c.role_label && <span>{c.role_label}</span>}
                  {c.default_rate != null && (
                    <span className="rounded bg-muted px-1.5 py-0.5 tabular-nums">
                      {twd(c.default_rate)}
                      {c.billing_mode === "hourly" ? "／時" : "／堂"}
                      {c.default_payment_method
                        ? ` · ${PAYMENT_METHOD_LABEL[c.default_payment_method]}`
                        : ""}
                    </span>
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
  // 預設收費
  const [billingMode, setBillingMode] = useState<BillingMode>("fixed");
  const [defaultRate, setDefaultRate] = useState("");
  const [defaultCategoryId, setDefaultCategoryId] = useState<string | null>(null);
  const [defaultDirection, setDefaultDirection] = useState<"expense" | "income">(
    "expense",
  );
  const [defaultPaymentMethod, setDefaultPaymentMethod] = useState<
    PaymentMethod | ""
  >("");
  const [pending, startTransition] = useTransition();
  const [init, setInit] = useState(false);

  if (open && !init) {
    setName(contact?.name ?? "");
    setRoleLabel(contact?.role_label ?? "");
    setPhone(contact?.phone ?? "");
    setNote(contact?.note ?? "");
    setBillingMode(contact?.billing_mode ?? "fixed");
    setDefaultRate(
      contact?.default_rate != null ? String(contact.default_rate) : "",
    );
    setDefaultCategoryId(contact?.default_category_id ?? null);
    setDefaultDirection(contact?.default_direction ?? "expense");
    setDefaultPaymentMethod(contact?.default_payment_method ?? "");
    setInit(true);
  }
  if (!open && init) setInit(false);

  const submit = () => {
    startTransition(async () => {
      const rate = defaultRate.trim() ? Math.round(Number(defaultRate)) : null;
      const payload = {
        name,
        roleLabel: roleLabel || null,
        phone: phone || null,
        note: note || null,
        billingMode: rate != null ? billingMode : null,
        defaultRate: rate,
        defaultCategoryId: defaultCategoryId,
        defaultDirection: rate != null ? defaultDirection : null,
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

          {/* 預設收費：設一次，新增行程選到此人即自動帶入 */}
          <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
            <div className="text-sm font-medium">
              預設收費（選填）
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                設定後，新增行程選到此人會自動帶入
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">計費方式</Label>
                <Select
                  value={billingMode}
                  onValueChange={(v) => setBillingMode(v as BillingMode)}
                >
                  <SelectTrigger className="w-full">
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
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">
                  {billingMode === "hourly" ? "時薪（每小時）" : "每堂金額"}
                </Label>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={defaultRate}
                  onChange={(e) => setDefaultRate(e.target.value)}
                  placeholder="例：1600"
                />
              </div>
            </div>
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
