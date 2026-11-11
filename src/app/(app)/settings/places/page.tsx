"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  deletePlaceAction,
  listPlacesAction,
  savePlaceAction,
  type PlaceItem,
} from "@/lib/actions/places";

/**
 * 常用地點：家、公司…的地址。行程地點或出發地寫「家」時，估算車程用這裡的地址。
 * spec：docs/specs/車程估算與出門提醒.md
 */
export default function PlacesPage() {
  const [items, setItems] = useState<PlaceItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [missing, setMissing] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [pending, startTransition] = useTransition();

  const load = useCallback(
    () =>
      listPlacesAction().then((res) => {
        if (res.ok) {
          if (res.data === null) setMissing(true);
          else setItems(res.data);
        } else toast.error(res.error);
        setLoaded(true);
      }),
    [],
  );
  useEffect(() => {
    let alive = true;
    listPlacesAction().then((res) => {
      if (!alive) return;
      if (res.ok) {
        if (res.data === null) setMissing(true);
        else setItems(res.data);
      } else toast.error(res.error);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const save = (n: string, a: string, after?: () => void) =>
    startTransition(async () => {
      const res = await savePlaceAction({ name: n, address: a });
      if (!res.ok) return void toast.error(res.error);
      toast.success(`已儲存「${n.trim()}」`);
      after?.();
      await load();
    });

  const remove = (p: PlaceItem) =>
    startTransition(async () => {
      const res = await deletePlaceAction(p.id);
      if (!res.ok) return void toast.error(res.error);
      await load();
    });

  const mine = items.filter((p) => p.mine);
  const shared = items.filter((p) => !p.mine);

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="常用地點"
        description="設定家、公司等地點的地址。行程的出發地或地點寫「家」時，估算車程會用這裡的地址。"
      />
      {missing && <p className="mb-4 text-sm text-destructive">資料庫還沒更新（0027），暫時不能設定。</p>}

      <div className="space-y-3">
        {mine.map((p) => (
          <PlaceRow key={p.id} place={p} disabled={pending} onSave={save} onDelete={() => remove(p)} />
        ))}
        {loaded && !missing && mine.length === 0 && (
          <p className="text-sm text-muted-foreground">還沒有常用地點，先加「家」吧。</p>
        )}
      </div>

      <div className="mt-6 space-y-2 rounded-lg border p-3">
        <p className="text-sm font-medium">新增地點</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[8rem_1fr]">
          <div className="space-y-1">
            <Label htmlFor="pl-name" className="text-xs">名稱</Label>
            <Input id="pl-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="家" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pl-addr" className="text-xs">地址</Label>
            <Input
              id="pl-addr"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="台北市大安區延吉街 100 號"
            />
          </div>
        </div>
        <Button
          size="sm"
          disabled={!loaded || missing || pending || !name.trim() || !address.trim()}
          onClick={() =>
            save(name, address, () => {
              setName("");
              setAddress("");
            })
          }
        >
          新增
        </Button>
      </div>

      {shared.length > 0 && (
        <div className="mt-6 space-y-1">
          <p className="text-sm font-medium">分享給你的地點（只能看）</p>
          {shared.map((p) => (
            <p key={p.id} className="text-sm text-muted-foreground">
              {p.name}：{p.address}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function PlaceRow({
  place,
  disabled,
  onSave,
  onDelete,
}: {
  place: PlaceItem;
  disabled: boolean;
  onSave: (name: string, address: string) => void;
  onDelete: () => void;
}) {
  const [address, setAddress] = useState(place.address);
  const changed = address.trim() !== place.address;
  return (
    <div className="flex items-end gap-2">
      <div className="flex-1 space-y-1">
        <Label className="text-xs">{place.name}</Label>
        <Input value={address} onChange={(e) => setAddress(e.target.value)} />
      </div>
      {changed && (
        <Button size="sm" disabled={disabled || !address.trim()} onClick={() => onSave(place.name, address)}>
          儲存
        </Button>
      )}
      <Button size="icon" variant="ghost" disabled={disabled} onClick={onDelete} aria-label={`刪除${place.name}`}>
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}
