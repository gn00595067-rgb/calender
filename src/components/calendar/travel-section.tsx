"use client";

import { useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Car, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listPlacesAction, savePlaceAction } from "@/lib/actions/places";

/**
 * 表單「車程」區塊：按「估算車程」→ Google 算開車時間 → 可開「該出門了」提醒。
 * spec：docs/specs/車程估算與出門提醒.md
 */
export type TravelValue = {
  minutes: number;
  origin: string;
  /** 準備時間（分）；null＝不提醒出門 */
  prep: number | null;
  /** 估算時的地點與時間；改過就提示重算 */
  stamp: string;
  /** 只在剛估算完有（編輯舊行程時沒有） */
  detail?: { km: number; originAddress: string; destAddress: string; future: boolean };
};

const PREP_OPTIONS = [0, 10, 15, 30];
export const DEFAULT_ORIGIN = "家";
const stampOf = (location: string, startWall: string) => `${location.trim()}|${startWall}`;

export function TravelSection({
  location,
  startWall,
  value,
  onChange,
  fixedOrigin,
  onEstimated,
}: {
  location: string;
  startWall: string;
  value: TravelValue | null;
  onChange: (v: TravelValue | null) => void;
  /** 有勾司機時，出發地跟著「上車地點」 */
  fixedOrigin: string | null;
  /** 估算完成（給司機的單程車程用） */
  onEstimated?: (minutes: number) => void;
}) {
  const qc = useQueryClient();
  const { data: places } = useQuery({
    queryKey: ["places"],
    queryFn: async () => {
      const r = await listPlacesAction();
      return r.ok ? (r.data ?? []) : [];
    },
    staleTime: 5 * 60_000,
  });
  const [originPick, setOriginPick] = useState(value?.origin ?? DEFAULT_ORIGIN);
  const origin = fixedOrigin ?? originPick;
  const [needPlace, setNeedPlace] = useState<string | null>(null);
  const [addr, setAddr] = useState("");
  const [pending, startTransition] = useTransition();

  const originNames = [...new Set([DEFAULT_ORIGIN, ...(places ?? []).map((p) => p.name), originPick])];
  const stale = !!value && value.stamp !== stampOf(location, startWall);

  const estimate = () =>
    startTransition(async () => {
      const res = await fetch("/api/travel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origin, destination: location, startWall }),
      }).catch(() => null);
      const body = res ? await res.json().catch(() => ({})) : { error: "連不上伺服器" };
      if (body.needPlace) {
        setNeedPlace(body.needPlace);
        return;
      }
      if (!res?.ok || typeof body.minutes !== "number") {
        toast.error(body.error ?? "車程估算失敗");
        return;
      }
      setNeedPlace(null);
      onChange({
        minutes: body.minutes,
        origin,
        prep: value?.prep ?? 10,
        stamp: stampOf(location, startWall),
        detail: {
          km: body.km,
          originAddress: body.origin.address,
          destAddress: body.destination.address,
          future: body.future,
        },
      });
      onEstimated?.(body.minutes);
    });

  const savePlaceThenEstimate = () =>
    startTransition(async () => {
      const r = await savePlaceAction({ name: needPlace!, address: addr });
      if (!r.ok) return void toast.error(r.error);
      await qc.invalidateQueries({ queryKey: ["places"] });
      setNeedPlace(null);
      setAddr("");
      estimate();
    });

  if (!location.trim()) return null;

  return (
    <div className="space-y-2 rounded-lg border border-dashed px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Car className="size-4 text-muted-foreground" aria-hidden />
        <span className="text-sm">從</span>
        {fixedOrigin ? (
          <span className="text-sm font-medium">{fixedOrigin}</span>
        ) : (
          <Select value={originPick} onValueChange={setOriginPick}>
            <SelectTrigger size="sm" className="w-auto min-w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {originNames.map((n) => (
                <SelectItem key={n} value={n}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <span className="text-sm">出發</span>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={estimate}>
          {pending && <Loader2 className="size-3.5 animate-spin" />}
          {value ? "重新估算" : "估算車程"}
        </Button>
      </div>

      {needPlace && (
        <div className="space-y-1.5 rounded-md bg-muted/50 p-2">
          <Label htmlFor="travel-addr" className="text-xs">
            「{needPlace}」的地址是？存起來之後就不用再填（可到 設定 → 常用地點 修改）
          </Label>
          <div className="flex gap-2">
            <Input
              id="travel-addr"
              value={addr}
              onChange={(e) => setAddr(e.target.value)}
              placeholder="台北市大安區延吉街 100 號"
            />
            <Button type="button" size="sm" disabled={pending || !addr.trim()} onClick={savePlaceThenEstimate}>
              存好並估算
            </Button>
          </div>
        </div>
      )}

      {value && (
        <>
          <p className="text-sm">
            開車約 <b>{value.minutes} 分鐘</b>
            {value.detail && (
              <span className="text-muted-foreground">
                （{value.detail.km} 公里，{value.detail.future ? "依當時路況" : "依現在路況"}）
              </span>
            )}
          </p>
          {value.detail && (
            <p className="text-xs text-muted-foreground">
              終點：{value.detail.destAddress}；起點：{value.detail.originAddress}。地址不對請把地點寫完整。
            </p>
          )}
          {stale && <p className="text-xs text-amber-600">地點或時間改過，建議重新估算。</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Switch
              id="travel-leave"
              checked={value.prep != null}
              onCheckedChange={(on) => onChange({ ...value, prep: on ? 10 : null })}
            />
            <Label htmlFor="travel-leave" className="text-sm font-normal">
              「該出門了」提醒
            </Label>
            {value.prep != null && (
              <>
                <span className="text-xs text-muted-foreground">車程＋準備</span>
                <Select value={String(value.prep)} onValueChange={(v) => onChange({ ...value, prep: Number(v) })}>
                  <SelectTrigger size="sm" className="w-auto">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PREP_OPTIONS.map((m) => (
                      <SelectItem key={m} value={String(m)}>
                        {m === 0 ? "不加" : `${m} 分`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground">＝開始前 {value.minutes + value.prep} 分鐘通知</span>
              </>
            )}
          </div>
          <button
            type="button"
            className="text-xs text-muted-foreground underline"
            onClick={() => onChange(null)}
          >
            不用車程
          </button>
        </>
      )}
    </div>
  );
}

/** 舊行程載入：存的值 → 表單值（沒有 detail，stamp 用目前的地點時間＝不顯示「改過」） */
export function travelFromEvent(
  t: { minutes: number; origin: string | null; leaveMinutes: number | null } | null,
  location: string,
  startWall: string,
): TravelValue | null {
  if (!t) return null;
  return {
    minutes: t.minutes,
    origin: t.origin || DEFAULT_ORIGIN,
    prep: t.leaveMinutes == null ? null : Math.max(0, t.leaveMinutes - t.minutes),
    stamp: stampOf(location, startWall),
  };
}
