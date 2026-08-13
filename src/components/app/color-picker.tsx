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
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="選擇顏色">
      {COLOR_PALETTE.map((color) => {
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
            {active && <Check className="size-4 text-white" />}
          </button>
        );
      })}
    </div>
  );
}
