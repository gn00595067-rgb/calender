"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useTags } from "@/lib/client/lookups";
import { tagKey } from "@/lib/tags";

/**
 * 標籤輸入（手機友善）：
 * - 不用原生 datalist：手機上會蓋滿畫面，點選又會被對話框當成「點外面」而關閉、行程全沒了。
 * - 打字即篩選既有標籤；沒有符合的就出現「＋ 新增「xxx」」按鈕（中文輸入法按 Enter 常常無效）。
 * - 既有標籤放在限高、可捲動的區塊，不會把表單推得很長。
 */
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
    const key = tagKey(n);
    setDraft("");
    if (!key) return;
    // 已選過（大小寫/全半形/空白差異視為同一）→ 不重複加
    if (value.some((v) => tagKey(v) === key)) return;
    // 吸附既有標籤的正式寫法，避免產生「數學/Math」這類分裂變體
    const existing = tags.find((t) => tagKey(t.name) === key);
    onChange([...value, existing ? existing.name : n]);
  };

  const remove = (name: string) => onChange(value.filter((v) => v !== name));

  const selectedKeys = new Set(value.map(tagKey));
  const q = tagKey(draft);
  const suggestions = tags
    .map((t) => t.name)
    .filter((n) => !selectedKeys.has(tagKey(n)))
    .filter((n) => !q || tagKey(n).includes(q));
  // 打的字不是既有標籤 → 可以新增
  const canCreate =
    !!q && !tags.some((t) => tagKey(t.name) === q) && !selectedKeys.has(q);

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((t) => (
            <Badge key={t} variant="secondary" className="gap-1 py-1 text-sm">
              {t}
              <button
                type="button"
                onClick={() => remove(t)}
                aria-label={`移除 ${t}`}
                className="-mr-1 p-0.5"
              >
                <X className="size-3.5" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // 中文選字中按 Enter 是確認選字，不是送出
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              if (draft.trim()) add(draft);
            } else if (e.key === "Backspace" && !draft && value.length) {
              remove(value[value.length - 1]);
            }
          }}
          enterKeyHint="done"
          placeholder="搜尋或輸入新標籤"
          className="h-9 min-w-0 flex-1 rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        {canCreate && (
          <button
            type="button"
            onClick={() => add(draft)}
            className="inline-flex h-9 shrink-0 items-center gap-1 rounded-md bg-primary px-3 text-sm text-primary-foreground"
          >
            <Plus className="size-4" />
            新增「{draft.trim()}」
          </button>
        )}
      </div>

      {suggestions.length > 0 ? (
        <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto rounded-md border border-dashed p-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              className="rounded-full border bg-card px-2.5 py-1 text-sm text-muted-foreground hover:bg-accent"
            >
              + {s}
            </button>
          ))}
        </div>
      ) : (
        q &&
        !canCreate && <p className="text-xs text-muted-foreground">這個標籤已選了</p>
      )}
    </div>
  );
}
