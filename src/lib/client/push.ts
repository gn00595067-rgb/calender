"use client";

import {
  savePushSubscriptionAction,
  deletePushSubscriptionAction,
} from "@/lib/actions/push";

/**
 * 這台裝置的推播訂閱（瀏覽器端）。spec：docs/specs/手機推播提醒.md
 */
export type PushSupport =
  | "ok"
  /** iPhone/iPad 但不是從主畫面開啟 → 要先加入主畫面 */
  | "ios-needs-install"
  | "unsupported";

export function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

export function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  const has = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (isIOS() && !isStandalone()) return "ios-needs-install";
  return has ? "ok" : "unsupported";
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  return navigator.serviceWorker.ready;
}

/** 這台裝置目前的訂閱（沒有＝null） */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== "ok") return null;
  const reg = await registration();
  return reg.pushManager.getSubscription();
}

/** 開啟這台裝置的推播；回傳錯誤訊息或 null（成功） */
export async function enablePush(): Promise<string | null> {
  const support = pushSupport();
  if (support === "ios-needs-install") return "iPhone 請先「加入主畫面」，再從主畫面圖示開啟";
  if (support === "unsupported") return "這個瀏覽器不支援推播通知";
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key) return "伺服器尚未設定推播金鑰，請通知管理者";

  const perm = await Notification.requestPermission();
  if (perm !== "granted") return "沒有允許通知；請到瀏覽器／手機設定把本網站的通知打開";

  const reg = await registration();
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    }));
  const json = sub.toJSON();
  const res = await savePushSubscriptionAction({
    endpoint: json.endpoint,
    keys: json.keys,
    userAgent: navigator.userAgent.slice(0, 300),
  });
  return res.ok ? null : res.error;
}

/** 關閉這台裝置的推播 */
export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await deletePushSubscriptionAction(sub.endpoint);
  await sub.unsubscribe();
}
