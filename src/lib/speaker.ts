/**
 * 「說話的人」：登入者是行事曆主人的某位家人（豪哥用自己帳號登入）時，找出對應的人物。
 * 規則：顯示名稱＝家人的名字或別名，且那位不是「本人」。老闆自己登入時回 null，維持「沒主角＝本人」。
 * spec：docs/specs/語音新增-說話的人當主角.md
 */
export function findSpeaker<
  C extends { name: string; is_family: boolean; is_self?: boolean; aliases?: string[] | null },
>(contacts: C[], displayName: string | null | undefined): C | null {
  const n = displayName?.trim();
  if (!n) return null;
  const hit = contacts.find(
    (c) => c.is_family && (c.name.trim() === n || (c.aliases ?? []).some((a) => a.trim() === n)),
  );
  return hit && !hit.is_self ? hit : null;
}
