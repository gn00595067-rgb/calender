"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthed, fail, type ActionResult } from "./helpers";

const contactSchema = z.object({
  name: z.string().trim().min(1, { error: "請輸入姓名" }).max(60),
  roleLabel: z.string().trim().max(40).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
});

export async function createContactAction(
  input: unknown,
): Promise<ActionResult<{ id: string; name: string; role_label: string | null }>> {
  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "輸入有誤");
  try {
    const { supabase, user } = await getAuthed();
    const { data, error } = await supabase
      .from("contacts")
      .insert({
        owner_id: user.id,
        name: parsed.data.name,
        role_label: parsed.data.roleLabel ?? null,
        phone: parsed.data.phone ?? null,
        note: parsed.data.note ?? null,
      })
      .select("id, name, role_label")
      .single();
    if (error || !data) return fail(error?.message ?? "建立失敗");
    revalidatePath("/", "layout");
    return { ok: true, data };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}

export async function updateContactAction(
  id: string,
  input: unknown,
): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success) return fail("參數有誤");
  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "輸入有誤");
  try {
    const { supabase } = await getAuthed();
    const { error } = await supabase
      .from("contacts")
      .update({
        name: parsed.data.name,
        role_label: parsed.data.roleLabel ?? null,
        phone: parsed.data.phone ?? null,
        note: parsed.data.note ?? null,
      })
      .eq("id", id);
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}

export async function deleteContactAction(id: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success) return fail("參數有誤");
  try {
    const { supabase } = await getAuthed();
    const { error } = await supabase.from("contacts").delete().eq("id", id);
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}
