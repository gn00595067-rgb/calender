"use client";

import { useState, useTransition } from "react";
import { Check, Plus, ChevronsUpDown, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useCategories } from "@/lib/client/lookups";
import { createCategoryAction } from "@/lib/actions/categories";
import { useQueryClient } from "@tanstack/react-query";

/**
 * 費用類別「選單制」單選（防呆）。可從既有類別挑選，或於底部新增。
 * 以 id 為準（同名＝同一筆），label 供顯示與名稱備援。
 */
export function CategorySelect({
  value,
  label,
  onChange,
}: {
  value: string | null;
  label: string | null;
  onChange: (id: string | null, name: string | null) => void;
}) {
  const { data: categories = [] } = useCategories();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [pending, startTransition] = useTransition();

  const current =
    (value && categories.find((c) => c.id === value)?.name) || label || "";

  const addNew = () => {
    const name = newName.trim();
    if (!name) return;
    // 已存在同名 → 直接選它，不重複建立
    const existing = categories.find((c) => c.name === name);
    if (existing) {
      onChange(existing.id, existing.name);
      setNewName("");
      setOpen(false);
      return;
    }
    startTransition(async () => {
      const res = await createCategoryAction({ name });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      await qc.invalidateQueries({ queryKey: ["categories"] });
      onChange(res.data.id, res.data.name);
      setNewName("");
      setOpen(false);
      toast.success(`已新增類別「${res.data.name}」`);
    });
  };

  return (
    <div className="flex items-center gap-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            className="w-full justify-between font-normal"
          >
            <span className={cn("truncate", !current && "text-muted-foreground")}>
              {current || "選擇費用類別…"}
            </span>
            <ChevronsUpDown className="size-4 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-(--radix-popover-trigger-width) p-0"
          align="start"
        >
          <div className="max-h-56 overflow-y-auto p-1">
            {categories.length === 0 && (
              <p className="px-2 py-3 text-center text-sm text-muted-foreground">
                尚無類別，於下方新增
              </p>
            )}
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  onChange(c.id, c.name);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                <Check
                  className={cn(
                    "size-4",
                    value === c.id ? "opacity-100" : "opacity-0",
                  )}
                />
                <span className="flex-1 truncate">{c.name}</span>
                {c.group_label && (
                  <span className="text-xs text-muted-foreground">
                    {c.group_label}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="border-t p-2">
            <div className="flex gap-1.5">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="新增類別（如：數學家教費）"
                className="h-8"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addNew();
                  }
                }}
              />
              <Button
                type="button"
                size="icon"
                variant="secondary"
                className="size-8 shrink-0"
                disabled={pending || !newName.trim()}
                onClick={addNew}
                aria-label="新增類別"
              >
                <Plus className="size-4" />
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      {value && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-muted-foreground"
          onClick={() => onChange(null, null)}
          aria-label="清除類別"
        >
          <X className="size-4" />
        </Button>
      )}
    </div>
  );
}
