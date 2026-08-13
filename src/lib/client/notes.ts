"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

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
