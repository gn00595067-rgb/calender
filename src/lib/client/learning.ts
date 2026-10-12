"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { taipeiDateEndExclusiveUtcISO, taipeiDateStartUtcISO } from "@/lib/date";
import { pickTeacher, type PersonLite } from "@/lib/learning";

/** 某個小孩的一則學習回饋 */
export interface LearningEntry {
  noteId: string;
  eventTitle: string;
  eventStart: string;
  authorName: string;
  progressLabel: string | null;
  /** 共同內容（教學概念等）；未拆分時為 null */
  shared: string | null;
  /** 這個小孩的回饋 */
  content: string;
  /** 多人上課但尚未依小孩拆開（整篇顯示） */
  unsplit: boolean;
}

/** 一位老師（一門課）底下的統計與回饋 */
export interface LearningGroup {
  key: string;
  teacher: PersonLite | null;
  classCount: number;
  entries: LearningEntry[];
}

export interface LearningData {
  children: { id: string; name: string }[];
  groupsByChild: Map<string, LearningGroup[]>;
}

/** .in() 參數太多時分批查（URL 長度上限） */
async function inChunks<T>(ids: string[], fn: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 150) out.push(...(await fn(ids.slice(i, i + 150))));
  return out;
}

/**
 * 學習回饋統整：區間內每個小孩 × 每位老師的上課堂數與回饋。
 * 老師依 pickTeacher（財務對象 → 稱謂含老師／家教／教練）；拆分段落取 note_parts（0017 前視為沒拆）。
 */
export function useLearningFeed(start: string, end: string) {
  return useQuery({
    queryKey: ["learning", start, end],
    queryFn: async (): Promise<LearningData> => {
      const supabase = createClient();
      const { data: evRows, error } = await supabase
        .from("events")
        .select("id, title, starts_at")
        .gte("starts_at", taipeiDateStartUtcISO(start))
        .lt("starts_at", taipeiDateEndExclusiveUtcISO(end))
        .order("starts_at");
      if (error) throw new Error(error.message);
      const events = evRows ?? [];
      const eventIds = events.map((e) => e.id);
      if (eventIds.length === 0) return { children: [], groupsByChild: new Map() };

      const [links, fins, notes] = await Promise.all([
        inChunks(eventIds, async (c) =>
          (await supabase.from("event_contacts").select("event_id, contact_id, role").in("event_id", c)).data ?? [],
        ),
        inChunks(eventIds, async (c) =>
          (await supabase.from("finance_records").select("event_id, contact_id").in("event_id", c)).data ?? [],
        ),
        inChunks(eventIds, async (c) =>
          (
            await supabase
              .from("event_notes")
              .select("id, event_id, author_id, content, progress_label, created_at")
              .in("event_id", c)
              .order("created_at")
          ).data ?? [],
        ),
      ]);
      const contactIds = [...new Set(links.map((l) => l.contact_id))];
      const noteIds = notes.map((n) => n.id);
      const authorIds = [...new Set(notes.map((n) => n.author_id))];
      const [contacts, parts, profiles] = await Promise.all([
        inChunks(contactIds, async (c) =>
          (await supabase.from("contacts").select("id, name, role_label").in("id", c)).data ?? [],
        ),
        inChunks(noteIds, async (c) => {
          const res = await supabase
            .from("note_parts")
            .select("note_id, subject_contact_id, content, position")
            .in("note_id", c)
            .order("position");
          return res.error ? [] : (res.data ?? []); // 尚未套 0017
        }),
        authorIds.length
          ? supabase.from("profiles").select("id, display_name").in("id", authorIds).then((r) => r.data ?? [])
          : Promise.resolve([]),
      ]);

      const contactById = new Map(contacts.map((c) => [c.id, c]));
      const nameByAuthor = new Map(profiles.map((p) => [p.id, p.display_name]));
      const partsByNote = new Map<string, typeof parts>();
      for (const p of parts) {
        const arr = partsByNote.get(p.note_id);
        if (arr) arr.push(p);
        else partsByNote.set(p.note_id, [p]);
      }
      const notesByEvent = new Map<string, typeof notes>();
      for (const n of notes) {
        const arr = notesByEvent.get(n.event_id);
        if (arr) arr.push(n);
        else notesByEvent.set(n.event_id, [n]);
      }

      const childNames = new Map<string, string>();
      const groupsByChild = new Map<string, Map<string, LearningGroup>>();
      const groupOf = (childId: string, teacher: PersonLite | null) => {
        let m = groupsByChild.get(childId);
        if (!m) groupsByChild.set(childId, (m = new Map()));
        const key = teacher?.id ?? "none";
        let g = m.get(key);
        if (!g) m.set(key, (g = { key, teacher, classCount: 0, entries: [] }));
        return g;
      };

      for (const ev of events) {
        const evLinks = links.filter((l) => l.event_id === ev.id);
        const toPerson = (id: string): PersonLite[] => {
          const c = contactById.get(id);
          return c ? [{ id: c.id, name: c.name, role_label: c.role_label }] : [];
        };
        const subjects = evLinks.filter((l) => l.role === "subject").flatMap((l) => toPerson(l.contact_id));
        if (subjects.length === 0) continue;
        const participants = evLinks.filter((l) => l.role !== "subject").flatMap((l) => toPerson(l.contact_id));
        const teacher = pickTeacher(
          fins.filter((f) => f.event_id === ev.id && f.contact_id).map((f) => f.contact_id!),
          participants,
        );
        const evNotes = notesByEvent.get(ev.id) ?? [];
        for (const child of subjects) {
          // 不是上課（沒老師）也沒回饋的行程不列
          if (!teacher && evNotes.length === 0) continue;
          childNames.set(child.id, child.name);
          const g = groupOf(child.id, teacher);
          if (teacher) g.classCount++;
          for (const n of evNotes) {
            const ps = partsByNote.get(n.id) ?? [];
            const base = {
              noteId: n.id,
              eventTitle: ev.title,
              eventStart: ev.starts_at,
              authorName: nameByAuthor.get(n.author_id) ?? "使用者",
              progressLabel: n.progress_label,
            };
            if (ps.length) {
              const mine = ps.filter((p) => p.subject_contact_id === child.id);
              if (mine.length === 0) continue;
              const shared = ps.filter((p) => !p.subject_contact_id).map((p) => p.content).join("\n\n");
              g.entries.push({
                ...base,
                shared: shared || null,
                content: mine.map((p) => p.content).join("\n\n"),
                unsplit: false,
              });
            } else {
              g.entries.push({ ...base, shared: null, content: n.content, unsplit: subjects.length >= 2 });
            }
          }
        }
      }

      const children = [...childNames.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
      const sorted = new Map(
        [...groupsByChild.entries()].map(([id, m]) => [
          id,
          [...m.values()].sort(
            (a, b) => b.entries.length - a.entries.length || b.classCount - a.classCount,
          ),
        ]),
      );
      return { children, groupsByChild: sorted };
    },
  });
}
