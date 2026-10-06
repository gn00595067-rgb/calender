"use client";

import { useState, useTransition } from "react";
import { Check, Plus, ChevronsUpDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  useContacts,
  useContactUsage,
  useContactCooccurrence,
  participantAffinity,
  type ContactLite,
} from "@/lib/client/lookups";
import { createContactAction } from "@/lib/actions/contacts";
import { useQueryClient } from "@tanstack/react-query";

export function ContactMultiSelect({
  value,
  onChange,
  placeholder = "選擇人物…",
  preferFamily = false,
  newIsFamily = false,
  usageRole,
  context,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  /** 觸發鈕與清單為空時的提示文字 */
  placeholder?: string;
  /** 家人（可當主角）排在最前並標徽章 */
  preferFamily?: boolean;
  /** 快速新增的人物是否標記為家人（主角欄用） */
  newIsFamily?: boolean;
  /** 依此角色的使用次數排序（常用的排前面） */
  usageRole?: "subject" | "participant";
  /**
   * 相關人物欄：依目前主角分區排序——「常和 ○○ 一起」在前、其他依名字。
   * 不給則沿用整體使用次數排序（老師會因每週上課永遠排最前，不適合相關人物）。
   */
  context?: { subjectIds: string[]; label: string };
}) {
  const { data: contacts = [] } = useContacts();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("");
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");

  const selected = contacts.filter((c) => value.includes(c.id));
  const { data: usage } = useContactUsage(
    usageRole ?? "subject",
    usageRole && !context ? contacts.map((c) => c.id) : [],
  );
  const { data: cooc } = useContactCooccurrence(!!context && open);
  const affinity = cooc && context ? participantAffinity(cooc, context.subjectIds) : null;

  const q = query.trim().toLowerCase();
  const matches = (c: ContactLite) =>
    !q || c.name.toLowerCase().includes(q) || (c.role_label ?? "").toLowerCase().includes(q);

  // 分區：有情境時「常一起」（系列數多→次數多）在前，其他依名字；
  // 沒情境時沿用：常用的（此角色出現次數多）→ 主角欄家人優先 → 名字
  const byName = (a: ContactLite, b: ContactLite) => a.name.localeCompare(b.name, "zh-Hant");
  const pool = contacts.filter(matches);
  const sections: { title: string | null; items: ContactLite[] }[] = affinity
    ? [
        {
          title: `常和 ${context!.label} 一起`,
          items: pool
            .filter((c) => affinity.has(c.id))
            .sort(
              (a, b) =>
                affinity.get(b.id)!.series - affinity.get(a.id)!.series ||
                affinity.get(b.id)!.count - affinity.get(a.id)!.count ||
                byName(a, b),
            ),
        },
        { title: "其他人物", items: pool.filter((c) => !affinity.has(c.id)).sort(byName) },
      ]
    : [
        {
          title: null,
          items: [...pool].sort(
            (a, b) =>
              (usage?.get(b.id) ?? 0) - (usage?.get(a.id) ?? 0) ||
              (preferFamily ? Number(b.is_family) - Number(a.is_family) : 0) ||
              byName(a, b),
          ),
        },
      ];
  const countOf = (id: string) =>
    affinity ? (affinity.get(id)?.count ?? 0) : (usage?.get(id) ?? 0);

  const toggle = (id: string) => {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  };

  const addNew = () => {
    if (!newName.trim()) return;
    startTransition(async () => {
      const res = await createContactAction({
        name: newName.trim(),
        roleLabel: newRole.trim() || null,
        isFamily: newIsFamily,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      await qc.invalidateQueries({ queryKey: ["contacts"] });
      onChange([...value, res.data.id]);
      setNewName("");
      setNewRole("");
      toast.success(`已新增人物「${res.data.name}」`);
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          className="w-full justify-between font-normal"
        >
          <span className="truncate">
            {selected.length ? selected.map((c) => c.name).join("、") : placeholder}
          </span>
          <ChevronsUpDown className="size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-(--radix-popover-trigger-width) p-0"
        align="start"
        // 打開時不自動聚焦搜尋框，免得手機鍵盤一直跳出來蓋住清單
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {contacts.length > 8 && (
          <div className="border-b p-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜尋名字或稱謂（如：老師、客戶）"
              className="h-8"
            />
          </div>
        )}
        <div className="max-h-64 overflow-y-auto p-1">
          {contacts.length === 0 && (
            <p className="px-2 py-3 text-center text-sm text-muted-foreground">
              尚無人物，於下方新增
            </p>
          )}
          {contacts.length > 0 && pool.length === 0 && (
            <p className="px-2 py-3 text-center text-sm text-muted-foreground">
              找不到「{query}」，可在下方新增
            </p>
          )}
          {sections.map((sec) =>
            sec.items.length === 0 ? null : (
              <div key={sec.title ?? "all"}>
                {sec.title && (
                  <div className="px-2 pb-0.5 pt-1.5 text-[11px] font-medium text-muted-foreground">
                    {sec.title}
                  </div>
                )}
          {sec.items.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => toggle(c.id)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
            >
              <Check
                className={cn(
                  "size-4",
                  value.includes(c.id) ? "opacity-100" : "opacity-0",
                )}
              />
              <span className="flex-1 truncate">{c.name}</span>
              {!!countOf(c.id) && (
                <span className="text-[10px] tabular-nums text-muted-foreground/70">
                  {countOf(c.id)} 次
                </span>
              )}
              {preferFamily && c.is_family && (
                <span className="rounded bg-primary/10 px-1 text-[10px] font-medium text-primary">
                  家人
                </span>
              )}
              {c.role_label && (
                <span className="text-xs text-muted-foreground">{c.role_label}</span>
              )}
            </button>
          ))}
              </div>
            ),
          )}
        </div>
        <div className="border-t p-2">
          <div className="flex gap-1.5">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="新人物姓名"
              className="h-8"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addNew();
                }
              }}
            />
            <Input
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              placeholder="稱謂（選填）"
              className="h-8 w-28"
            />
            <Button
              type="button"
              size="icon"
              variant="secondary"
              className="size-8 shrink-0"
              disabled={pending || !newName.trim()}
              onClick={addNew}
              aria-label="新增人物"
            >
              <Plus className="size-4" />
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
