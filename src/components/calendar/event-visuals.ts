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

/** 月視圖單行 chip 樣式：較深的底色＋較粗的左色條，讓不同分類更好區分 */
export function chipStyle(color: string, conflict = false): CSSProperties {
  return {
    backgroundColor: hexToRgba(color, 0.22),
    borderLeft: `4px solid ${conflict ? CONFLICT_COLOR : color}`,
  };
}

/**
 * 顯示用標題：去掉開頭與「開始時間相同」的時間字樣，省下窄格空間。
 *   07:30「0730-0900小游-豪哥」→「小游-豪哥」；17:00「17-22 Phoenix」→「Phoenix」
 * 時間不同就保留（08:30「10:30做好便當」的 10:30 是完成期限，不能拿掉）。
 * 只影響月曆／時間軸的顯示，資料與搜尋不變。
 */
export function displayTitle(title: string, startHHmm: string): string {
  // 時：分 需有分鐘或區間（「12月聚餐」的 12 不算時間）
  const m = title.match(
    /^(\d{1,2})(?:[:：]?(\d{2}))?(\s*[-~～–]\s*\d{1,2}(?:[:：]?\d{2})?)?\s*/,
  );
  if (!m || (!m[2] && !m[3])) return title;
  const hh = m[1].padStart(2, "0");
  const mm = m[2] ?? "00";
  if (`${hh}:${mm}` !== startHHmm) return title;
  const rest = title.slice(m[0].length).replace(/^[\s\-–~～、,，]+/, "");
  return rest || title;
}
