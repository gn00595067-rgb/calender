import type { EffectiveRole } from "./constants";

/**
 * 角色能力矩陣（對應規格第 5 節）。
 * 注意：前端隱藏僅為 UX，真正的安全邊界在資料庫 RLS。此處供介面降級使用，
 * 且與 RLS policy 的判斷保持一致。
 */

export const can = {
  viewEvents: (role: EffectiveRole): boolean =>
    role === "owner" || role === "editor" || role === "contributor" || role === "viewer",

  editEvents: (role: EffectiveRole): boolean => role === "owner" || role === "editor",

  addNotes: (role: EffectiveRole): boolean =>
    role === "owner" || role === "editor" || role === "contributor",

  viewFinance: (role: EffectiveRole): boolean => role === "owner" || role === "editor",

  manageShares: (role: EffectiveRole): boolean => role === "owner",

  deleteCalendar: (role: EffectiveRole): boolean => role === "owner",
};

/** 在一組行事曆中，只要對任一具備某能力即為 true（用於全站按鈕顯示） */
export function anyCan(
  roles: EffectiveRole[],
  ability: keyof typeof can,
): boolean {
  return roles.some((r) => can[ability](r));
}
