"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/constants";
import { MAIN_NAV, SETTINGS_NAV } from "./nav";
import { useAppData } from "./app-data";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const render = (items: typeof MAIN_NAV) =>
    items.map((item) => {
      const active =
        pathname === item.href || pathname.startsWith(item.href + "/");
      return (
        <Link
          key={item.href}
          href={item.href}
          onClick={onNavigate}
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors touch:py-2.5",
            active
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          <item.icon className="size-4 shrink-0" />
          {item.label}
        </Link>
      );
    });

  return (
    <nav className="space-y-1">
      {render(MAIN_NAV)}
      <div className="px-3 pt-4 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
        設定
      </div>
      {render(SETTINGS_NAV)}
    </nav>
  );
}

function CalendarToggle({
  id,
  name,
  color,
  visible,
  onToggle,
  badge,
}: {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  onToggle: () => void;
  badge?: string;
}) {
  return (
    <label
      htmlFor={`cal-${id}`}
      className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-accent touch:py-2.5"
    >
      <Checkbox
        id={`cal-${id}`}
        checked={visible}
        onCheckedChange={onToggle}
        aria-label={`顯示或隱藏 ${name}`}
      />
      <span
        className="size-3 shrink-0 rounded-[3px]"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <span
        className={cn("flex-1 truncate", !visible && "text-muted-foreground line-through")}
      >
        {name}
      </span>
      {badge && (
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {badge}
        </span>
      )}
    </label>
  );
}

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { ownedCalendars, sharedCalendars, isVisible, toggleVisible, setAllVisible } =
    useAppData();

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-4">
      <Link href="/calendar" onClick={onNavigate} className="flex items-center gap-2 px-1">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <CalendarClock className="size-5" />
        </span>
        <span className="text-lg font-bold">{APP_NAME}</span>
      </Link>

      <NavLinks onNavigate={onNavigate} />

      <div>
        <div className="flex items-center justify-between px-2 pb-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
            我的分類
          </span>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-[11px] touch:h-9 touch:px-3 touch:text-xs"
              onClick={() => setAllVisible(true)}
            >
              全顯
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-[11px] touch:h-9 touch:px-3 touch:text-xs"
              onClick={() => setAllVisible(false)}
            >
              全隱
            </Button>
          </div>
        </div>
        <div className="space-y-0.5">
          {ownedCalendars.map((c) => (
            <CalendarToggle
              key={c.id}
              id={c.id}
              name={c.name}
              color={c.color}
              visible={isVisible(c.id)}
              onToggle={() => toggleVisible(c.id)}
            />
          ))}
          {ownedCalendars.length === 0 && (
            <p className="px-2 py-1 text-xs text-muted-foreground">尚無分類</p>
          )}
        </div>
      </div>

      {sharedCalendars.length > 0 && (
        <div>
          <div className="px-2 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
            與我分享
          </div>
          <div className="space-y-0.5">
            {sharedCalendars.map((c) => (
              <CalendarToggle
                key={c.id}
                id={c.id}
                name={c.name}
                color={c.color}
                visible={isVisible(c.id)}
                onToggle={() => toggleVisible(c.id)}
                badge={
                  c.effectiveRole === "editor"
                    ? "編輯"
                    : c.effectiveRole === "contributor"
                      ? "協作"
                      : "檢視"
                }
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
