"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { BellRing, Share, SquarePlus } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import {
  currentSubscription,
  disablePush,
  enablePush,
  isIOS,
  pushSupport,
  type PushSupport,
} from "@/lib/client/push";
import { sendTestPushAction } from "@/lib/actions/push";

/**
 * 手機通知：每台裝置各自開啟一次。開啟後即使網頁／App 關著，提醒時間到也會跳通知。
 * spec：docs/specs/手機推播提醒.md
 */
export default function NotificationsPage() {
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let alive = true;
    (async () => {
      const s = pushSupport();
      const sub = s === "ok" ? await currentSubscription() : null;
      if (!alive) return;
      setSupport(s);
      setSubscribed(!!sub);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const enable = () =>
    startTransition(async () => {
      const err = await enablePush();
      if (err) {
        toast.error(err, { duration: 8000 });
        return;
      }
      setSubscribed(true);
      toast.success("這台裝置已開啟通知，可以按「傳送測試通知」試試");
    });

  const disable = () =>
    startTransition(async () => {
      await disablePush();
      setSubscribed(false);
      toast.success("這台裝置已關閉通知");
    });

  const test = () =>
    startTransition(async () => {
      const res = await sendTestPushAction();
      if (res.ok) toast.success(`已送出到 ${res.data.sent} 台裝置，幾秒內會跳出`);
      else toast.error(res.error, { duration: 8000 });
    });

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
      <PageHeader
        title="手機通知"
        description="開啟後，行程提醒時間到會像 Google 行事曆一樣跳通知，網頁關著也收得到。每台手機／電腦要各自開啟一次。"
      />

      <section className="space-y-4 rounded-xl border bg-card p-4">
        <div className="flex items-center gap-2 font-medium">
          <BellRing className="size-5 text-primary" />
          這台裝置
          <span className="text-sm font-normal text-muted-foreground">
            {support === null
              ? "檢查中…"
              : support !== "ok"
                ? "尚未能開啟"
                : subscribed
                  ? "✅ 已開啟"
                  : "未開啟"}
          </span>
        </div>

        {support === "ios-needs-install" && (
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>
              用 <b>Safari</b> 打開本網站，點下方的分享按鈕
              <Share className="mx-1 inline size-4" />
            </li>
            <li>
              選「<b>加入主畫面</b>」
              <SquarePlus className="mx-1 inline size-4" />
            </li>
            <li>從主畫面上的 ExecCal 圖示打開，再回到這一頁按「開啟通知」</li>
            <li className="text-muted-foreground">需要 iOS 16.4 以上</li>
          </ol>
        )}
        {support === "unsupported" && (
          <p className="text-sm text-muted-foreground">
            這個瀏覽器不支援推播。請改用 Chrome、Edge、Safari（iPhone 需加入主畫面）。
          </p>
        )}

        {support === "ok" && (
          <div className="flex flex-wrap gap-2">
            {subscribed ? (
              <>
                <Button onClick={test} disabled={pending}>
                  傳送測試通知
                </Button>
                <Button variant="outline" onClick={disable} disabled={pending}>
                  關閉這台的通知
                </Button>
              </>
            ) : (
              <Button onClick={enable} disabled={pending}>
                開啟通知
              </Button>
            )}
          </div>
        )}
      </section>

      <section className="space-y-2 text-sm text-muted-foreground">
        <p>・新增行程預設「10 分鐘前」提醒，可在行程裡改時間或選「不提醒」。</p>
        <p>・提醒最多可能晚 1 分鐘左右跳出。</p>
        {support === "ok" && isIOS() && (
          <p>・iPhone 要從主畫面圖示開啟過本網站，通知才會穩定送達。</p>
        )}
        <p>・沒收到時：確認手機「設定 → 通知」裡 ExecCal（或瀏覽器）的通知是開的、沒有開勿擾模式。</p>
      </section>
    </div>
  );
}
