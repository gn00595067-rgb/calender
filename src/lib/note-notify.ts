import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushToUser } from "@/lib/push";

/**
 * 有人寫了學習回饋 → 推播給行事曆擁有者（Peggy 11/24：老師寫完回饋要在桌面跳通知）。
 * 擁有者自己寫的不推。推播失敗不影響回饋本身。
 */
export async function notifyOwnerOfNote(noteId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: n } = await admin
      .from("event_notes")
      .select("id, author_id, content, created_at, events!inner(title, starts_at, calendars!inner(owner_id))")
      .eq("id", noteId)
      .maybeSingle();
    if (!n) return;
    const ev = n.events as unknown as { title: string; starts_at: string; calendars: { owner_id: string } };
    const ownerId = ev.calendars.owner_id;
    if (!ownerId || ownerId === n.author_id) return;
    const { data: p } = await admin.from("profiles").select("display_name").eq("id", n.author_id).maybeSingle();
    const day = new Date(ev.starts_at).toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
    const md = `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
    const text = n.content.replace(/\s+/g, " ").trim();
    await sendPushToUser(admin, ownerId, {
      title: `${p?.display_name || "老師"} 寫了學習回饋`,
      body: `${md} ${ev.title}｜${text.length > 60 ? `${text.slice(0, 60)}…` : text}`,
      tag: `note-${n.id}`,
      url: `/calendar?date=${day}&view=day`,
    });
  } catch (e) {
    console.error("[note notify]", e);
  }
}
