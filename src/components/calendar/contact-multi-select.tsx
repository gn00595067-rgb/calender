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
import { useContacts } from "@/lib/client/lookups";
import { createContactAction } from "@/lib/actions/contacts";
import { useQueryClient } from "@tanstack/react-query";

export function ContactMultiSelect({
  value,
  onChange,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const { data: contacts = [] } = useContacts();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("");
  const [pending, startTransition] = useTransition();

  const selected = contacts.filter((c) => value.includes(c.id));

  const toggle = (id: string) => {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  };

  const addNew = () => {
    if (!newName.trim()) return;
    startTransition(async () => {
      const res = await createContactAction({
        name: newName.trim(),
        roleLabel: newRole.trim() || null,
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
            {selected.length ? selected.map((c) => c.name).join("、") : "選擇人物…"}
          </span>
          <ChevronsUpDown className="size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <div className="max-h-56 overflow-y-auto p-1">
          {contacts.length === 0 && (
            <p className="px-2 py-3 text-center text-sm text-muted-foreground">
              尚無人物，於下方新增
            </p>
          )}
          {contacts.map((c) => (
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
              {c.role_label && (
                <span className="text-xs text-muted-foreground">{c.role_label}</span>
              )}
            </button>
          ))}
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
