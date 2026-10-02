"use client";

import { Check } from "lucide-react";
import { COLOR_PALETTE } from "@/lib/constants";
import { cn } from "@/lib/utils";

export function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  // 舊分類可能用了已移出色盤的顏色：放在最前面，編輯時仍看得到目前選中的是哪個
  const inPalette = COLOR_PALETTE.some(
    (c) => c.toLowerCase() === value.toLowerCase(),
  );
  const colors = value && !inPalette ? [value, ...COLOR_PALETTE] : COLOR_PALETTE;

  return (
    <div
      className="grid w-fit grid-cols-5 gap-2"
      role="radiogroup"
      aria-label="選擇顏色"
    >
      {colors.map((color) => {
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
              "flex size-8 items-center justify-center rounded-full ring-offset-2 transition",
              active ? "ring-2 ring-foreground" : "hover:scale-110",
            )}
            style={{ backgroundColor: color }}
          >
            {active && <Check className="size-4 text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]" />}
          </button>
        );
      })}
    </div>
  );
}
