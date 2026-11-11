"use server";

import { getAuthed, fail, type ActionResult } from "./helpers";

/**
 * 常用地點（家、公司…）：估算車程時把名稱換成地址。
 * spec：docs/specs/車程估算與出門提醒.md
 */
export type PlaceItem = { id: string; name: string; address: string; mine: boolean };

/** 看得到的常用地點（自己的＋分享給我可編輯的人的）；0027 前回 null */
export async function listPlacesAction(): Promise<ActionResult<PlaceItem[] | null>> {
  try {
    const { supabase, user } = await getAuthed();
    const { data, error } = await supabase
      .from("places")
      .select("id, owner_id, name, address")
      .order("created_at");
    if (error) return /places/.test(error.message) ? { ok: true, data: null } : fail(error.message);
    return {
      ok: true,
      data: (data ?? []).map((p) => ({ id: p.id, name: p.name, address: p.address, mine: p.owner_id === user.id })),
    };
  } catch (e) {
    return fail((e as Error).message);
  }
}

/** 新增或更新（同名覆蓋）；地址改了就清掉座標，下次估算重查 */
export async function savePlaceAction(input: { name: string; address: string }): Promise<ActionResult> {
  try {
    const { supabase, user } = await getAuthed();
    const name = input.name.trim().slice(0, 40);
    const address = input.address.trim().slice(0, 200);
    if (!name || !address) return fail("名稱和地址都要填");
    const { error } = await supabase
      .from("places")
      .upsert({ owner_id: user.id, name, address, lat: null, lng: null }, { onConflict: "owner_id,name" });
    if (error) return fail(error.message);
    return { ok: true, data: undefined };
  } catch (e) {
    return fail((e as Error).message);
  }
}

export async function deletePlaceAction(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await getAuthed();
    const { error } = await supabase.from("places").delete().eq("id", id);
    if (error) return fail(error.message);
    return { ok: true, data: undefined };
  } catch (e) {
    return fail((e as Error).message);
  }
}
