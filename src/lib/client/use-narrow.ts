"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(max-width: 639px)"; // 與 Tailwind max-sm 一致

function subscribe(cb: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** 是否為手機窄螢幕（< 640px）；需要在 JS 裡改尺寸（如時間軸每小時高度）時用，純樣式用 max-sm: 即可 */
export function useNarrow(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
