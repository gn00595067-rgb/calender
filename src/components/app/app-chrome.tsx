"use client";

import { useState } from "react";
import { Menu, Search } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { SidebarContent } from "./sidebar";
import { UserMenu } from "./user-menu";
import { CommandPaletteProvider, useCommandPalette } from "./command-palette";
import { AppDataProvider, type Me } from "./app-data";
import type { AccessibleCalendar } from "@/types/domain";

function SearchTrigger() {
  const { open } = useCommandPalette();
  return (
    <Button
      variant="outline"
      onClick={open}
      className="h-9 gap-2 text-muted-foreground sm:w-64 sm:justify-between"
      aria-label="開啟搜尋"
    >
      <span className="flex items-center gap-2">
        <Search className="size-4" />
        <span className="hidden sm:inline">搜尋…</span>
      </span>
      <kbd className="hidden rounded border bg-muted px-1.5 font-mono text-[10px] sm:inline">
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
        className="lg:hidden"
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
