"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { pickTeacher, type PersonLite } from "@/lib/learning";

export interface NoteView {
  id: string;
  content: string;
  progress_label: string | null;
  created_at: string;
  author_id: string;
  authorName: string;
}

export function useEventNotes(eventId: string | null) {
  return useQuery({
    queryKey: ["notes", eventId],
    enabled: !!eventId,
    queryFn: async (): Promise<NoteView[]> => {
      const supabase = createClient();
      const { data: notes, error } = await supabase
        .from("event_notes")
        .select("id, content, progress_label, created_at, author_id")
        .eq("event_id", eventId!)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      const rows = notes ?? [];
      if (rows.length === 0) return [];

      const authorIds = [...new Set(rows.map((n) => n.author_id))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", authorIds);
      const nameById = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));

      return rows.map((n) => ({
        ...n,
        authorName: nameById.get(n.author_id) ?? "使用者",
      }));
    },
  });
}

export interface NotePartView {
  id: string;
  note_id: string;
  subject_contact_id: string | null;
  content: string;
  position: number;
}

export interface NoteContext {
  /** 這堂課的主角（小孩） */
  subjects: PersonLite[];
  /** 這堂課的老師（財務對象或稱謂含老師／家教／教練的相關人物） */
  teacher: PersonLite | null;
  /** 各回饋的拆分段落 */
  partsByNote: Map<string, NotePartView[]>;
}

/** 回饋區塊需要的脈絡：主角、老師、拆分段落（note_parts 尚未套 0017 時視為沒有） */
export function useNoteContext(eventId: string | null, noteIds: string[]) {
  const ids = [...noteIds].sort();
  return useQuery({
    queryKey: ["note-context", eventId, ids],
    enabled: !!eventId,
    queryFn: async (): Promise<NoteContext> => {
      const supabase = createClient();
      const [ecRes, finRes, partRes] = await Promise.all([
        supabase.from("event_contacts").select("contact_id, role").eq("event_id", eventId!),
        supabase.from("finance_records").select("contact_id").eq("event_id", eventId!),
        ids.length
          ? supabase
              .from("note_parts")
              .select("id, note_id, subject_contact_id, content, position")
              .in("note_id", ids)
              .order("position")
          : Promise.resolve({ data: [] as NotePartView[], error: null }),
      ]);
      const links = ecRes.data ?? [];
      // 用 * 而非列欄位：0017 前的庫沒有 aliases
      const { data: cts } = links.length
        ? await supabase.from("contacts").select("*").in("id", links.map((l) => l.contact_id))
        : { data: [] };
      const byId = new Map((cts ?? []).map((c) => [c.id, c]));
      const people = links.flatMap((l) => {
        const c = byId.get(l.contact_id);
        if (!c) return [];
        const person: PersonLite = {
          id: c.id,
          name: c.name,
          role_label: c.role_label,
          aliases: Array.isArray(c.aliases) ? c.aliases : [],
        };
        return [{ role: l.role, person }];
      });
      const subjects = people.filter((p) => p.role === "subject").map((p) => p.person);
      const participants = people.filter((p) => p.role !== "subject").map((p) => p.person);
      const financeIds = (finRes.data ?? [])
        .map((f) => f.contact_id)
        .filter((x): x is string => !!x);
      const partsByNote = new Map<string, NotePartView[]>();
      for (const p of partRes.error ? [] : (partRes.data ?? [])) {
        const arr = partsByNote.get(p.note_id);
        if (arr) arr.push(p);
        else partsByNote.set(p.note_id, [p]);
      }
      return { subjects, teacher: pickTeacher(financeIds, participants), partsByNote };
    },
  });
}
