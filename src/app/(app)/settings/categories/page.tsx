"use client";

import { useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus, Trash2, Coins } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
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
import { CATEGORY_GROUPS } from "@/lib/constants";
import {
  createCategoryAction,
  updateCategoryAction,
  deleteCategoryAction,
} from "@/lib/actions/categories";

interface FullCategory {
  id: string;
  name: string;
  group_label: string | null;
}

const NONE = "__none__";

function groupText(v: string | null): string {
  return CATEGORY_GROUPS.find((g) => g.value === v)?.label ?? "";
}

function useCategoriesFull() {
  return useQuery({
    queryKey: ["categories", "full"],
    queryFn: async (): Promise<FullCategory[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("expense_categories")
        .select("id, name, group_label")
        .eq("is_archived", false)
        .order("name", { ascending: true });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export default function CategoriesSettingsPage() {
  const { data: categories = [], isLoading } = useCategoriesFull();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<FullCategory | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<FullCategory | null>(null);
  const [pending, startTransition] = useTransition();

  const invalidate = () => qc.invalidateQueries({ queryKey: ["categories"] });

  const onDelete = () => {
    if (!deleting) return;
    const target = deleting;
    startTransition(async () => {
      const res = await deleteCategoryAction(target.id);
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
        title="費用類別"
        description="選單制的費用類別，讓報表能準確統計週／月／年支出（避免每次手打標準不一）。"
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            新增類別
          </Button>
        }
      />

      {isLoading ? (
        <ListSkeleton rows={4} />
      ) : categories.length === 0 ? (
        <EmptyState
          icon={Coins}
          title="尚無費用類別"
          description="建立第一個類別，例如「數學家教費」。"
          action={<Button onClick={() => setCreating(true)}>新增類別</Button>}
        />
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {categories.map((c) => (
            <li key={c.id} className="flex items-center gap-3 p-3">
              <span className="flex size-9 items-center justify-center rounded-full bg-muted">
                <Coins className="size-4 text-muted-foreground" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{c.name}</div>
              </div>
              {c.group_label && (
                <Badge variant="secondary">{groupText(c.group_label)}</Badge>
              )}
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

      <CategoryFormDialog
        open={creating}
        mode="create"
        onOpenChange={setCreating}
        onDone={invalidate}
      />
      <CategoryFormDialog
        open={!!editing}
        mode="edit"
        category={editing ?? undefined}
        onOpenChange={(o) => !o && setEditing(null)}
        onDone={invalidate}
      />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>刪除「{deleting?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              既有財務紀錄仍會保留類別名稱，但不再歸入此類別選項。
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

function CategoryFormDialog({
  open,
  mode,
  category,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  mode: "create" | "edit";
  category?: FullCategory;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [groupLabel, setGroupLabel] = useState<string>(NONE);
  const [pending, startTransition] = useTransition();
  const [init, setInit] = useState(false);

  if (open && !init) {
    setName(category?.name ?? "");
    setGroupLabel(category?.group_label ?? NONE);
    setInit(true);
  }
  if (!open && init) setInit(false);

  const submit = () => {
    startTransition(async () => {
      const payload = {
        name,
        groupLabel: groupLabel === NONE ? null : groupLabel,
      };
      const res =
        mode === "create"
          ? await createCategoryAction(payload)
          : await updateCategoryAction(category!.id, payload);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(mode === "create" ? "已新增類別" : "已更新類別");
      onOpenChange(false);
      onDone();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "新增類別" : "編輯類別"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="cat-name">類別名稱</Label>
            <Input
              id="cat-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例：數學家教費"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label>分群（統計用，選填）</Label>
            <Select value={groupLabel} onValueChange={setGroupLabel}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>不分群</SelectItem>
                {CATEGORY_GROUPS.map((g) => (
                  <SelectItem key={g.value} value={g.value}>
                    {g.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              可依「小孩／大人／通用」分群，報表能分別統計。
            </p>
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
