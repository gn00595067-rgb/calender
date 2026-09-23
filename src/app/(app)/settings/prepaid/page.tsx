"use client";

import { useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Wallet, PiggyBank, Archive, ArchiveRestore } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState, ListSkeleton } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
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
import { CategorySelect } from "@/components/calendar/category-select";
import { useContacts } from "@/lib/client/lookups";
import { usePrepaidAccounts, type PrepaidAccountView } from "@/lib/client/prepaid";
import {
  createPrepaidAccountAction,
  topUpPrepaidAccountAction,
  setPrepaidActiveAction,
  deletePrepaidAccountAction,
} from "@/lib/actions/prepaid";
import { twd } from "@/lib/date";
import { cn } from "@/lib/utils";

const KIND_LABEL = { deduct: "預繳累扣", term: "預付學期" } as const;

export default function PrepaidSettingsPage() {
  const { data: accounts = [], isLoading } = usePrepaidAccounts();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [topUp, setTopUp] = useState<PrepaidAccountView | null>(null);
  const [deleting, setDeleting] = useState<PrepaidAccountView | null>(null);
  const [pending, startTransition] = useTransition();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["prepaid-accounts"] });
    qc.invalidateQueries({ queryKey: ["report-finance"] });
  };

  const toggleActive = (a: PrepaidAccountView) => {
    startTransition(async () => {
      const res = await setPrepaidActiveAction(a.id, !a.is_active);
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(a.is_active ? "已封存帳戶" : "已重新啟用");
        invalidate();
      }
    });
  };

  const onDelete = () => {
    if (!deleting) return;
    const t = deleting;
    startTransition(async () => {
      const res = await deletePrepaidAccountAction(t.id);
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(`已刪除「${t.label}」`);
        invalidate();
      }
      setDeleting(null);
    });
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="預繳帳戶"
        description="預繳累扣／預付學期：先儲值一筆，之後每堂自動扣抵，隨時看剩餘餘額與堂數。"
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            新增帳戶
          </Button>
        }
      />

      {isLoading ? (
        <ListSkeleton rows={3} />
      ) : accounts.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="尚無預繳帳戶"
          description="例如：預付陳老師一學期 18 堂 $28,800。"
          action={<Button onClick={() => setCreating(true)}>新增帳戶</Button>}
        />
      ) : (
        <ul className="space-y-3">
          {accounts.map((a) => {
            const pct =
              a.total_amount > 0
                ? Math.max(0, Math.min(100, (a.balance / a.total_amount) * 100))
                : 0;
            const low = a.balance <= 0 || pct <= 15;
            return (
              <li
                key={a.id}
                className={cn(
                  "rounded-xl border bg-card p-4",
                  !a.is_active && "opacity-60",
                )}
              >
                <div className="flex items-start gap-3">
                  <span className="flex size-9 items-center justify-center rounded-full bg-muted">
                    <PiggyBank className="size-4 text-muted-foreground" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{a.label}</span>
                      <Badge variant="secondary">{KIND_LABEL[a.kind]}</Badge>
                      {a.contact_name && (
                        <span className="text-xs text-muted-foreground">
                          {a.contact_name}
                        </span>
                      )}
                      {!a.is_active && <Badge variant="outline">已封存</Badge>}
                    </div>
                    <div className="mt-1 text-sm">
                      餘額{" "}
                      <span
                        className={cn(
                          "font-semibold tabular-nums",
                          low ? "text-rose-600" : "text-emerald-600",
                        )}
                      >
                        {twd(a.balance)}
                      </span>
                      <span className="text-muted-foreground">
                        {" "}
                        / 總 {twd(a.total_amount)} · 已用 {a.usedSessions} 堂
                        {a.remainingSessions != null &&
                          ` · 剩 ${a.remainingSessions} 堂`}
                      </span>
                    </div>
                    {/* 餘額進度條 */}
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          low ? "bg-rose-500" : "bg-emerald-500",
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    {low && a.is_active && (
                      <p className="mt-1 text-xs text-rose-600">
                        餘額偏低，記得再儲值。
                      </p>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setTopUp(a)}
                    disabled={pending}
                  >
                    <Plus className="size-3.5" />
                    再儲值
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleActive(a)}
                    disabled={pending}
                  >
                    {a.is_active ? (
                      <>
                        <Archive className="size-3.5" />
                        封存
                      </>
                    ) : (
                      <>
                        <ArchiveRestore className="size-3.5" />
                        啟用
                      </>
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setDeleting(a)}
                    disabled={pending}
                  >
                    <Trash2 className="size-3.5" />
                    刪除
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <CreateDialog open={creating} onOpenChange={setCreating} onDone={invalidate} />
      <TopUpDialog account={topUp} onOpenChange={() => setTopUp(null)} onDone={invalidate} />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>刪除「{deleting?.label}」？</AlertDialogTitle>
            <AlertDialogDescription>
              帳戶會被移除；已扣抵的行程財務仍保留，但不再連結此帳戶。
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

function CreateDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const { data: contacts = [] } = useContacts();
  const [label, setLabel] = useState("");
  const [contactId, setContactId] = useState<string>("");
  const [kind, setKind] = useState<"deduct" | "term">("deduct");
  const [totalAmount, setTotalAmount] = useState("");
  const [totalSessions, setTotalSessions] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [init, setInit] = useState(false);

  if (open && !init) {
    setLabel("");
    setContactId("");
    setKind("deduct");
    setTotalAmount("");
    setTotalSessions("");
    setCategoryId(null);
    setNote("");
    setInit(true);
  }
  if (!open && init) setInit(false);

  const submit = () => {
    startTransition(async () => {
      const res = await createPrepaidAccountAction({
        label,
        contactId: contactId || null,
        kind,
        totalAmount: totalAmount.trim() ? Math.round(Number(totalAmount)) : 0,
        totalSessions:
          kind === "term" && totalSessions.trim()
            ? Math.round(Number(totalSessions))
            : null,
        categoryId,
        note: note || null,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("已建立預繳帳戶");
      onOpenChange(false);
      onDone();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>新增預繳帳戶</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="pp-label">名稱</Label>
            <Input
              id="pp-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="例：陳老師數學 上學期"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>老師／對象</Label>
              <Select value={contactId || undefined} onValueChange={setContactId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="選擇（選填）" />
                </SelectTrigger>
                <SelectContent>
                  {contacts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>類型</Label>
              <Select
                value={kind}
                onValueChange={(v) => setKind(v as "deduct" | "term")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="deduct">預繳累扣</SelectItem>
                  <SelectItem value="term">預付學期</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="pp-amount">儲值金額</Label>
              <Input
                id="pp-amount"
                type="number"
                min={0}
                value={totalAmount}
                onChange={(e) => setTotalAmount(e.target.value)}
                placeholder="例：28800"
              />
            </div>
            {kind === "term" && (
              <div className="space-y-2">
                <Label htmlFor="pp-sessions">總堂數（選填）</Label>
                <Input
                  id="pp-sessions"
                  type="number"
                  min={0}
                  value={totalSessions}
                  onChange={(e) => setTotalSessions(e.target.value)}
                  placeholder="例：18"
                />
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Label>費用類別（選填）</Label>
            <CategorySelect
              value={categoryId}
              label={null}
              onChange={(id) => setCategoryId(id)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pp-note">備註</Label>
            <Input
              id="pp-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="選填"
            />
          </div>
          <p className="rounded bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground">
            建立時會自動記一筆「儲值」支出；之後在行程選此帳戶扣抵，不會重複計入支出。
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={submit} disabled={pending || !label.trim()}>
            {pending ? "儲存中…" : "建立"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TopUpDialog({
  account,
  onOpenChange,
  onDone,
}: {
  account: PrepaidAccountView | null;
  onOpenChange: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [pending, startTransition] = useTransition();
  const [init, setInit] = useState(false);

  const open = !!account;
  if (open && !init) {
    setAmount("");
    setInit(true);
  }
  if (!open && init) setInit(false);

  const submit = () => {
    if (!account) return;
    const amt = Math.round(Number(amount));
    if (!amt || amt <= 0) {
      toast.error("請輸入金額");
      return;
    }
    startTransition(async () => {
      const res = await topUpPrepaidAccountAction(account.id, amt);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`已再儲值 ${twd(amt)}`);
      onOpenChange();
      onDone();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onOpenChange()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>再儲值：{account?.label}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Label htmlFor="pp-topup">儲值金額</Label>
          <Input
            id="pp-topup"
            type="number"
            min={0}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="例：10000"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onOpenChange}>
            取消
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? "儲存中…" : "儲值"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
