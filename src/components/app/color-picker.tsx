"use client";

import { Check } from "lucide-react";
import { COLOR_PALETTE, COLOR_PALETTE_COLUMNS } from "@/lib/constants";
import { cn } from "@/lib/utils";

export function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  // 舊分類可能用了色盤外的顏色：另列一顆「目前顏色」，不打亂色盤的同色系對齊
  const inPalette = COLOR_PALETTE.some(
    (c) => c.toLowerCase() === value.toLowerCase(),
  );

  const swatch = (color: string) => {
    const active = value.toLowerCase() === color.toLowerCase();
    return (
      <button
        key={color}
        type="button"
        role="radio"
        aria-checked={active}
        aria-label={color}
        onClick={() => onChange(color)}
        className={cn(
          "flex size-7 items-center justify-center rounded-full ring-offset-2 transition sm:size-8",
          active ? "ring-2 ring-foreground" : "hover:scale-110",
        )}
        style={{ backgroundColor: color }}
      >
        {active && <Check className="size-4 text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]" />}
      </button>
    );
  };

  return (
    <div className="space-y-2" role="radiogroup" aria-label="選擇顏色">
      {value && !inPalette && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {swatch(value)}
          目前顏色（舊色盤）
        </div>
      )}
      {/* 同一欄＝同色系：上排鮮色、下排深色 */}
      <div
        className="grid w-fit gap-1.5 sm:gap-2"
        style={{ gridTemplateColumns: `repeat(${COLOR_PALETTE_COLUMNS}, auto)` }}
      >
        {COLOR_PALETTE.map(swatch)}
      </div>
    </div>
  );
}
