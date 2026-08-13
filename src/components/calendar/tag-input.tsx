"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useTags } from "@/lib/client/lookups";

export function TagInput({
  value,
  onChange,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
}) {
  const { data: tags = [] } = useTags();
  const [draft, setDraft] = useState("");

  const add = (name: string) => {
    const n = name.trim();
    if (!n || value.includes(n)) {
      setDraft("");
      return;
    }
    onChange([...value, n]);
    setDraft("");
  };

  const remove = (name: string) => onChange(value.filter((v) => v !== name));

  const suggestions = tags
    .map((t) => t.name)
    .filter((n) => !value.includes(n));

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 rounded-md border p-2">
        {value.map((t) => (
          <Badge key={t} variant="secondary" className="gap-1">
            {t}
            <button type="button" onClick={() => remove(t)} aria-label={`移除 ${t}`}>
              <X className="size-3" />
            </button>
          </Badge>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add(draft);
            } else if (e.key === "Backspace" && !draft && value.length) {
              remove(value[value.length - 1]);
            }
          }}
          placeholder={value.length ? "" : "輸入標籤後按 Enter"}
          className="min-w-24 flex-1 bg-transparent text-sm outline-none"
          list="tag-suggestions"
        />
        <datalist id="tag-suggestions">
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </div>
      {suggestions.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {suggestions.slice(0, 8).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
