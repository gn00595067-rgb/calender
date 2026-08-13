"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { AccessibleCalendar } from "@/types/domain";

export interface Me {
  id: string;
  email: string;
  displayName: string;
}

interface AppDataValue {
  me: Me;
  calendars: AccessibleCalendar[];
  ownedCalendars: AccessibleCalendar[];
  sharedCalendars: AccessibleCalendar[];
  calendarById: Map<string, AccessibleCalendar>;
  /** 目前「顯示中」的行事曆 id（供各視圖過濾） */
  visibleIds: Set<string>;
  isVisible: (calendarId: string) => boolean;
  toggleVisible: (calendarId: string) => void;
  setAllVisible: (visible: boolean) => void;
}

const AppDataContext = createContext<AppDataValue | null>(null);

const STORAGE_KEY = "execcal:hidden-calendars";

export function AppDataProvider({
  me,
  calendars,
  children,
}: {
  me: Me;
  calendars: AccessibleCalendar[];
  children: React.ReactNode;
}) {
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

  // 從 localStorage 還原隱藏狀態。以 effect 讀取（而非 lazy initializer）是為了避免
  // SSR 與 client 首次渲染的 hydration 不一致；這是合法的「與外部系統同步」情境。
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 掛載時自 localStorage 同步一次
      if (raw) setHiddenIds(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* ignore */
    }
  }, []);

  const persist = useCallback((next: Set<string>) => {
    setHiddenIds(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  }, []);

  const allIds = useMemo(() => calendars.map((c) => c.id), [calendars]);

  const value = useMemo<AppDataValue>(() => {
    const calendarById = new Map(calendars.map((c) => [c.id, c]));
    const visibleIds = new Set(allIds.filter((id) => !hiddenIds.has(id)));
    return {
      me,
      calendars,
      ownedCalendars: calendars.filter((c) => c.isOwned),
      sharedCalendars: calendars.filter((c) => !c.isOwned),
      calendarById,
      visibleIds,
      isVisible: (id: string) => !hiddenIds.has(id),
      toggleVisible: (id: string) => {
        const next = new Set(hiddenIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        persist(next);
      },
      setAllVisible: (visible: boolean) => {
        persist(visible ? new Set() : new Set(allIds));
      },
    };
  }, [me, calendars, allIds, hiddenIds, persist]);

  return <AppDataContext value={value}>{children}</AppDataContext>;
}

export function useAppData(): AppDataValue {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error("useAppData 必須在 AppDataProvider 內使用");
  return ctx;
}
