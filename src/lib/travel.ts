import "server-only";

/**
 * 車程估算：Google Geocoding（地址→座標）＋ Routes API（依出發時間路況算開車時間）。
 * 金鑰只在伺服器（GOOGLE_MAPS_API_KEY），前端看不到。
 * spec：docs/specs/車程估算與出門提醒.md
 */

export type LatLng = { lat: number; lng: number };

export function mapsConfigured(): boolean {
  return !!process.env.GOOGLE_MAPS_API_KEY;
}

/** 地址或地名 → 座標＋Google 認定的完整地址；找不到回 null */
export async function geocode(text: string): Promise<{ address: string; loc: LatLng } | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error("伺服器尚未設定 GOOGLE_MAPS_API_KEY");
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", text);
  url.searchParams.set("region", "tw");
  url.searchParams.set("language", "zh-TW");
  url.searchParams.set("components", "country:TW");
  url.searchParams.set("key", key);
  const res = await fetch(url, { cache: "no-store" });
  const body = (await res.json()) as {
    status: string;
    error_message?: string;
    results?: { formatted_address: string; geometry: { location: LatLng } }[];
  };
  if (body.status === "ZERO_RESULTS") return null;
  if (body.status !== "OK" || !body.results?.length) {
    throw new Error(`地址查詢失敗（${body.status}${body.error_message ? `：${body.error_message}` : ""}）`);
  }
  const r = body.results[0];
  return { address: r.formatted_address.replace(/^\d{3,6}/, "").replace(/^台灣/, ""), loc: r.geometry.location };
}

/**
 * 開車時間（分鐘，無條件進位）與距離（公里）。
 * departure 在未來才帶（Google 規定）；過去或沒給＝依現在路況。
 */
export async function driveMinutes(
  from: LatLng,
  to: LatLng,
  departure: Date | null,
): Promise<{ minutes: number; km: number }> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error("伺服器尚未設定 GOOGLE_MAPS_API_KEY");
  const point = (p: LatLng) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });
  const future = departure && departure.getTime() > Date.now() + 60_000 ? departure : null;
  const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
    },
    body: JSON.stringify({
      origin: point(from),
      destination: point(to),
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
      ...(future ? { departureTime: future.toISOString() } : {}),
      languageCode: "zh-TW",
      regionCode: "TW",
    }),
  });
  const body = (await res.json()) as {
    routes?: { duration?: string; distanceMeters?: number }[];
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(`路線查詢失敗（${body.error?.message ?? res.status}）`);
  const route = body.routes?.[0];
  if (!route?.duration) throw new Error("找不到開車路線");
  const secs = Number(route.duration.replace(/s$/, ""));
  return { minutes: Math.max(1, Math.ceil(secs / 60)), km: Math.round((route.distanceMeters ?? 0) / 100) / 10 };
}
