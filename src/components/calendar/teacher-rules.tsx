"use client";

import { useState } from "react";
import { ScrollText } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 老師的規則（0030）：跟家長談好的個人約定（請假、取消、補課…）。
 * spec：docs/specs/只看空檔與提議行程審核.md
 */

/** 規則卡（表單選到有規則的老師時顯示） */
export function RulesBox({ items }: { items: { name: string; rules: string }[] }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-800 dark:bg-amber-950/40">
      {items.map((it) => (
        <div key={it.name}>
          <div className="flex items-center gap-1 font-medium text-amber-900 dark:text-amber-200">
            <ScrollText className="size-3.5" />
            {it.name} 的規則
          </div>
          <p className="whitespace-pre-wrap text-amber-900/90 dark:text-amber-100/90">{it.rules}</p>
        </div>
      ))}
    </div>
  );
}

/** 人名清單：有規則的人名可以點，點了在下面展開他的規則（行程詳情用） */
export function NamesWithRules({
  names,
  rules,
}: {
  names: string[];
  rules?: Record<string, string>;
}) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <span className="inline">
      {names.map((n, i) => {
        const r = rules?.[n];
        return (
          <span key={n}>
            {i > 0 && "、"}
            {r ? (
              <button
                type="button"
                onClick={() => setOpen(open === n ? null : n)}
                className={cn(
                  "inline-flex items-center gap-0.5 rounded px-1 font-medium text-amber-800 underline decoration-dotted underline-offset-4 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-950",
                  open === n && "bg-amber-100 dark:bg-amber-950",
                )}
                aria-expanded={open === n}
                title={`看 ${n} 的規則`}
              >
                {n}
                <ScrollText className="size-3" />
              </button>
            ) : (
              n
            )}
          </span>
        );
      })}
      {open && rules?.[open] && (
        <span className="mt-1.5 block">
          <RulesBox items={[{ name: open, rules: rules[open] }]} />
        </span>
      )}
    </span>
  );
}
