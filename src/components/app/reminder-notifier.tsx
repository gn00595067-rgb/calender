"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { useUpcomingReminders } from "@/lib/client/reminders";

const NOTIFIED_KEY = "execcal:notified-reminders";

function loadNotified(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(NOTIFIED_KEY) || "[]"));
  } catch {
    return new Set();
  }
}
function saveNotified(s: Set<string>) {
  try {
    // 只保留最近 500 筆，避免無限成長
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify([...s].slice(-500)));
  } catch {
    /* 忽略 */
  }
}

/**
 * 桌面（瀏覽器）行程提醒：網頁開著時，於提醒時間彈出系統通知。
 * 需使用者授權通知權限；未決定時顯示一顆小按鈕邀請開啟。
 */
export function ReminderNotifier() {
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">(
    "default",
  );
  // 只有授權後才需要輪詢資料
  const { data: reminders = [] } = useUpcomingReminders(perm === "granted");
  const notified = useRef<Set<string>>(new Set());

  useEffect(() => {
    notified.current = loadNotified();
    if (typeof window !== "undefined" && "Notification" in window) {
      setPerm(Notification.permission);
    } else {
      setPerm("unsupported");
    }
  }, []);

  const enable = useCallback(() => {
    if (typeof Notification === "undefined") return;
    Notification.requestPermission().then((p) => setPerm(p));
  }, []);

  useEffect(() => {
    if (perm !== "granted") return;
    const tick = () => {
      const now = Date.now();
      for (const e of reminders) {
        if (e.reminder_minutes == null) continue;
        const start = new Date(e.starts_at).getTime();
        const fireAt = start - e.reminder_minutes * 60_000;
        if (now >= fireAt && now < start && !notified.current.has(e.id)) {
          notified.current.add(e.id);
          saveNotified(notified.current);
          const mins = Math.round((start - now) / 60_000);
          try {
            new Notification(e.title, {
              body: `${mins <= 0 ? "即將開始" : `${mins} 分鐘後開始`}${
                e.location ? ` · ${e.location}` : ""
              }`,
              tag: e.id,
            });
          } catch {
            /* 忽略 */
          }
        }
      }
    };
    tick();
    const iv = setInterval(tick, 30_000);
    return () => clearInterval(iv);
  }, [reminders, perm]);

  // 尚未決定權限 → 顯示邀請按鈕（授權後消失）
  if (perm !== "default") return null;
  return (
    <button
      type="button"
      onClick={enable}
      className="fixed bottom-4 right-4 z-50 inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-2 text-sm shadow-lg hover:bg-accent"
    >
      <Bell className="size-4 text-primary" />
      開啟桌面提醒
    </button>
  );
}
