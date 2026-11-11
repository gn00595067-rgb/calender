import { NextResponse } from "next/server";
import { z } from "zod";
import { fromZonedTime } from "date-fns-tz";
import { createClient } from "@/lib/supabase/server";
import { driveMinutes, geocode, mapsConfigured, type LatLng } from "@/lib/travel";

/**
 * 估算車程：從出發地（常用地點名稱或地址）開車到行程地點要多久。
 * 只在使用者按「估算車程」時呼叫（每次會打 Google，費用可控）。
 * spec：docs/specs/車程估算與出門提醒.md
 */
export const dynamic = "force-dynamic";

const WALL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const bodySchema = z.object({
  origin: z.string().trim().min(1).max(200),
  destination: z.string().trim().min(1).max(200),
  /** 行程開始（台北牆上時間）；用來估「那時候」的路況 */
  startWall: z.string().regex(WALL),
});

type Place = { id: string; owner_id: string; name: string; address: string; lat: number | null; lng: number | null };

/** 看起來像簡稱（家、公司、阿嬤家）而不是地址：沒有數字、很短 → 要先設定常用地點 */
const looksLikeNickname = (s: string) => s.length <= 6 && !/\d/.test(s);

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未登入" }, { status: 401 });

  let input: z.infer<typeof bodySchema>;
  try {
    input = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "輸入格式不正確" }, { status: 400 });
  }
  if (!mapsConfigured()) {
    return NextResponse.json({ error: "車程估算還沒開通（伺服器缺 Google 地圖金鑰）" }, { status: 503 });
  }

  // 看得到的常用地點（RLS：自己的＋分享給我可編輯的人的）；自己的優先
  const { data: placeRows, error: placeErr } = await supabase
    .from("places")
    .select("id, owner_id, name, address, lat, lng");
  if (placeErr) {
    const missing = /places/.test(placeErr.message);
    return NextResponse.json(
      { error: missing ? "資料庫還沒更新（0027），暫時不能估算車程" : placeErr.message },
      { status: 500 },
    );
  }
  const places = ((placeRows ?? []) as Place[]).sort(
    (a, b) => Number(b.owner_id === user.id) - Number(a.owner_id === user.id),
  );
  const findPlace = (name: string) => places.find((p) => p.name === name.trim()) ?? null;

  /** 名稱或地址 → 座標；常用地點沒座標就查一次並存回（只存自己的） */
  async function resolve(text: string, isOrigin: boolean) {
    const place = findPlace(text);
    if (place) {
      if (place.lat != null && place.lng != null) {
        return { label: place.name, address: place.address, loc: { lat: place.lat, lng: place.lng } as LatLng };
      }
      const g = await geocode(place.address);
      if (!g) return { notFound: place.address };
      if (place.owner_id === user!.id) {
        await supabase.from("places").update({ lat: g.loc.lat, lng: g.loc.lng }).eq("id", place.id);
      }
      return { label: place.name, address: g.address, loc: g.loc };
    }
    // 出發地是「家」「公司」這種簡稱但沒設定 → 問地址（直接丟給 Google 會亂找一個）
    if (isOrigin && looksLikeNickname(text)) return { needPlace: text };
    const g = await geocode(text);
    if (!g) return { notFound: text };
    return { label: text, address: g.address, loc: g.loc };
  }

  try {
    const [from, to] = await Promise.all([resolve(input.origin, true), resolve(input.destination, false)]);
    if ("needPlace" in from) return NextResponse.json({ needPlace: from.needPlace });
    if ("notFound" in from) return NextResponse.json({ error: `找不到出發地「${from.notFound}」，請改寫完整地址` }, { status: 422 });
    if ("notFound" in to) return NextResponse.json({ error: `找不到地點「${to.notFound}」，請改寫完整一點（例：台北市延吉街 100 號）` }, { status: 422 });

    // 先用「開始前 30 分鐘出發」估路況；第一次結果差很多再用實際出發時間重算一次
    const start = fromZonedTime(input.startWall, "Asia/Taipei");
    let r = await driveMinutes(from.loc!, to.loc!, new Date(start.getTime() - 30 * 60_000));
    if (Math.abs(r.minutes - 30) > 15) {
      r = await driveMinutes(from.loc!, to.loc!, new Date(start.getTime() - r.minutes * 60_000));
    }
    return NextResponse.json({
      minutes: r.minutes,
      km: r.km,
      origin: { label: from.label, address: from.address },
      destination: { label: to.label, address: to.address },
      // 估的是未來路況，還是現在路況（行程已過或太近）
      future: start.getTime() - r.minutes * 60_000 > Date.now() + 60_000,
    });
  } catch (err) {
    console.error("[travel]", err);
    return NextResponse.json({ error: (err as Error).message || "車程估算失敗" }, { status: 502 });
  }
}
