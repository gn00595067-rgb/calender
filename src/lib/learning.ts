/**
 * 學習回饋共用邏輯（前後端皆可用的純函式）。
 * spec：docs/specs/學習回饋-依小孩拆分與統整.md
 */

export interface PersonLite {
  id: string;
  name: string;
  role_label: string | null;
  aliases?: string[];
}

const TEACHER_RE = /老師|家教|教練|教師/;

/**
 * 這堂課的老師：
 *   1. 財務紀錄的對象（付鐘點費給誰）——最準
 *   2. 相關人物中稱謂含「老師／家教／教練」的人
 * 都沒有 → null（例如一般行程，不是上課）
 */
export function pickTeacher(
  financeContactIds: string[],
  participants: PersonLite[],
): PersonLite | null {
  for (const id of financeContactIds) {
    const p = participants.find((x) => x.id === id);
    if (p) return p;
  }
  return participants.find((p) => p.role_label && TEACHER_RE.test(p.role_label)) ?? null;
}

/** 「Jack（數學家教）」 */
export function teacherLabel(t: PersonLite): string {
  return t.role_label ? `${t.name}（${t.role_label}）` : t.name;
}

/** 一則回饋拆出的段落；subjectId 為 null＝共同內容（如教學概念） */
export interface NotePartDraft {
  subjectId: string | null;
  content: string;
}
