import "server-only";
import { randomBytes } from "node:crypto";
import { getAuthed } from "./helpers";

/** 好念好打的密碼：去掉 0/O、1/l/I 等容易看錯的字（老師、司機帳號共用） */
export function makePassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(8);
  return [...bytes].map((b) => chars[b % chars.length]).join("");
}

/** 確認是自己的人物（非家人）；回傳人物資料 */
export async function ownNonFamilyContact(contactId: string, familyError: string) {
  const { supabase, user } = await getAuthed();
  const { data, error } = await supabase
    .from("contacts")
    .select("*")
    .eq("id", contactId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("找不到這位人物");
  if (data.is_family) throw new Error(familyError);
  return { supabase, user, contact: data };
}
