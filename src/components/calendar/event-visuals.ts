import { CONFLICT_COLOR } from "@/lib/constants";
import type { CSSProperties } from "react";

export function hexToRgba(hex: string, alpha: number): string {
  const m = hex.replace("#", "");
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** 卡片樣式：左側 4px 色條 + 淡色背景（UX 原則第 2 條） */
export function eventStyle(color: string, conflict = false): CSSProperties {
  return {
    backgroundColor: hexToRgba(color, 0.1),
    borderLeft: `4px solid ${color}`,
    ...(conflict
      ? { boxShadow: `inset 0 0 0 1.5px ${CONFLICT_COLOR}` }
      : {}),
  };
}

/** 月視圖單行 chip 樣式 */
export function chipStyle(color: string, conflict = false): CSSProperties {
  return {
    backgroundColor: hexToRgba(color, 0.14),
    borderLeft: `3px solid ${conflict ? CONFLICT_COLOR : color}`,
  };
}
