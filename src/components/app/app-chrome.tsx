"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Menu, Search } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { SidebarContent } from "./sidebar";
import { UserMenu } from "./user-menu";
import { CommandPaletteProvider, useCommandPalette } from "./command-palette";
import { AppDataProvider, type Me } from "./app-data";
import type { AccessibleCalendar } from "@/types/domain";

/**
 * 頂部搜尋框：點擊直接前往「完整搜尋頁」（關鍵字＋所有篩選＋空檔）。
 * 鍵盤 Ctrl/⌘+K（或 /）仍開輕量命令面板供快速跳頁；hover 時提示。
 */
function SearchTrigger() {
  const router = useRouter();
  const { open } = useCommandPalette();
  return (
    <Button
      variant="outline"
      onClick={() => router.push("/search")}
      className="group h-9 gap-2 text-muted-foreground sm:w-64 sm:justify-between"
      aria-label="開啟搜尋"
    >
      <span className="flex items-center gap-2">
        <Search className="size-4" />
        <span className="hidden sm:inline">搜尋…</span>
      </span>
      <kbd
        role="button"
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation();
          open();
        }}
        className="hidden rounded border bg-muted px-1.5 font-mono text-[10px] transition group-hover:bg-background sm:inline"
        title="快速命令面板"
      >
        Ctrl K
      </kbd>
    </Button>
  );
}

function Topbar({ onOpenNav }: { onOpenNav: () => void }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur sm:px-4">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden touch:size-11"
        onClick={onOpenNav}
        aria-label="開啟選單"
      >
        <Menu className="size-5" />
      </Button>
      <div className="flex-1" />
      <SearchTrigger />
      <UserMenu />
    </header>
  );
}

export function AppChrome({
  me,
  calendars,
  children,
}: {
  me: Me;
  calendars: AccessibleCalendar[];
  children: React.ReactNode;
}) {
  const [mobileNav, setMobileNav] = useState(false);

  return (
    <AppDataProvider me={me} calendars={calendars}>
      <CommandPaletteProvider>
        <div className="flex min-h-screen w-full">
          {/* 桌面側欄 */}
          <aside className="hidden w-64 shrink-0 border-r bg-sidebar lg:block">
            <div className="sticky top-0 h-screen">
              <SidebarContent />
            </div>
          </aside>

          {/* 行動側欄 */}
          <Sheet open={mobileNav} onOpenChange={setMobileNav}>
            <SheetContent side="left" className="w-72 p-0">
              <SheetTitle className="sr-only">主選單</SheetTitle>
              <SidebarContent onNavigate={() => setMobileNav(false)} />
            </SheetContent>
          </Sheet>

          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar onOpenNav={() => setMobileNav(true)} />
            <main className="flex-1 p-3 sm:p-4 lg:p-6">{children}</main>
          </div>
        </div>
      </CommandPaletteProvider>
    </AppDataProvider>
  );
}
