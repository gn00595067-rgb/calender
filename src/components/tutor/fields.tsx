"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * 家教填報表單的小元件：老師多半下課後用手機填，按鈕與字都放大。
 */

export function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-sm font-medium">
        {label}
        {required && <span className="ml-0.5 text-red-600">*</span>}
        {hint && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/** 單選：一排可點的膠囊（比下拉選單好按） */
export function Choice({
  options,
  value,
  onChange,
  allowEmpty,
}: {
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
  allowEmpty?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={value === o}
          onClick={() => onChange(allowEmpty && value === o ? "" : o)}
          className={cn(
            "min-h-10 rounded-full border px-3.5 text-sm transition",
            value === o ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
          )}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

/** 複選膠囊 */
export function Chips({
  options,
  value,
  onChange,
  labelOf,
}: {
  options: readonly string[];
  value: string[];
  onChange: (v: string[]) => void;
  labelOf?: (o: string) => string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button
            key={o}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== o) : [...value, o])}
            className={cn(
              "min-h-10 rounded-full border px-3.5 text-sm transition",
              on ? "border-primary bg-primary/10 font-medium text-primary" : "hover:bg-accent",
            )}
          >
            {on ? "✓ " : ""}
            {labelOf ? labelOf(o) : o}
          </button>
        );
      })}
    </div>
  );
}

/** 0–100% 吸收程度：滑桿每 5% 一格，旁邊大字顯示 */
export function Percent({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-8 flex-1 accent-primary"
      />
      <span
        className={cn(
          "w-14 text-right text-lg font-bold tabular-nums",
          value < 60 ? "text-red-600" : value < 80 ? "text-amber-600" : "text-emerald-600",
        )}
      >
        {value}%
      </span>
    </div>
  );
}

export function TimeRange({
  start,
  end,
  onChange,
}: {
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input type="time" value={start} onChange={(e) => onChange(e.target.value, end)} className="h-11 flex-1 text-base" />
      <span className="text-muted-foreground">–</span>
      <Input type="time" value={end} onChange={(e) => onChange(start, e.target.value)} className="h-11 flex-1 text-base" />
    </div>
  );
}

export function Text({
  value,
  onChange,
  placeholder,
  multiline,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  return multiline ? (
    <Textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={2} className="text-base" />
  ) : (
    <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-11 text-base" />
  );
}

/**
 * 可展開的區塊（家庭老師每日回報）：沒內容就收著略過；
 * 標題旁顯示「已填 N 項」，打開才填。
 */
export function Section({
  title,
  filled,
  defaultOpen,
  children,
}: {
  title: string;
  filled?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="rounded-xl border bg-card">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex min-h-12 w-full items-center gap-2 px-3 text-left"
      >
        <span className="font-semibold">{title}</span>
        {filled && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{filled}</span>}
        <ChevronDown className={cn("ml-auto size-4 text-muted-foreground transition", open && "rotate-180")} />
      </button>
      {open && <div className="space-y-3 border-t p-3">{children}</div>}
    </div>
  );
}

/** 可新增多筆的清單（工作時段、聯繫、採購…） */
export function Repeater<T>({
  items,
  onChange,
  make,
  addLabel,
  render,
}: {
  items: T[];
  onChange: (items: T[]) => void;
  make: () => T;
  addLabel: string;
  render: (item: T, set: (next: T) => void, index: number) => ReactNode;
}) {
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i} className="relative space-y-2 rounded-lg border bg-muted/20 p-2.5 pr-10">
          {render(it, (next) => onChange(items.map((x, j) => (j === i ? next : x))), i)}
          <button
            type="button"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            aria-label="刪除這一筆"
            className="absolute right-1.5 top-1.5 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-red-600"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, make()])}
        className="flex min-h-10 w-full items-center justify-center gap-1 rounded-lg border border-dashed text-sm text-muted-foreground hover:bg-accent"
      >
        <Plus className="size-4" />
        {addLabel}
      </button>
    </div>
  );
}
