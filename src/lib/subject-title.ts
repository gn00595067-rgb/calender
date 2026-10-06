/**
 * 非本人（有主角）的行程，標題後加「-主角名」，例：打球 → 打球-豪哥。
 * 手動新增、編輯、語音、批次補名共用。spec：docs/specs/語音新增-標題加主角名.md
 */

/** 本人（Peggy）也可能被設成主角；她的行程不加名字 */
export function isSelfName(name: string): boolean {
  return /peggy|本人/i.test(name);
}

/** 標題後加主角名（本人除外）；標題已含該名字就不重複加 */
export function withSubjectSuffix(title: string, subjectNames: string[]): string {
  const missing = subjectNames.filter((n) => n && !isSelfName(n) && !title.includes(n));
  return missing.length ? `${title}-${missing.join("、")}` : title;
}

/** 去掉「-名字、名字」後綴（每個名字都在 names 裡才算後綴，避免誤刪「17-22 Phoenix」這種標題） */
export function stripSubjectSuffix(title: string, names: string[]): string {
  if (!names.length) return title;
  const m = title.match(/^(.+)-([^-]+)$/);
  if (m && m[2].split("、").every((n) => names.includes(n))) return m[1].trim();
  return title;
}

/**
 * 存檔用：先去掉舊的家人名後綴（主角改了／拿掉時才會跟著變），再加上目前主角。
 * familyNames＝所有可當主角的人名；subjectNames＝這筆行程的主角。
 */
export function applySubjectTitle(
  title: string,
  subjectNames: string[],
  familyNames: string[],
): string {
  const base = stripSubjectSuffix(title.trim(), familyNames) || title.trim();
  return withSubjectSuffix(base, subjectNames).slice(0, 120);
}
