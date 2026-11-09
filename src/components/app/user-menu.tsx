"use client";

import { useState } from "react";
import { KeyRound, LogOut, User as UserIcon } from "lucide-react";
import { signOutAction } from "@/app/login/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useAppData } from "./app-data";
import { ChangePasswordDialog } from "./change-password-dialog";

export function UserMenu() {
  const { me } = useAppData();
  const initial = (me.displayName || me.email || "?").charAt(0).toUpperCase();
  const [pwOpen, setPwOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="h-9 gap-2 px-2"
            aria-label="使用者選單"
          >
            <Avatar className="size-7">
              <AvatarFallback className="bg-primary text-xs text-primary-foreground">
                {initial}
              </AvatarFallback>
            </Avatar>
            <span className="hidden max-w-32 truncate text-sm font-medium sm:inline">
              {me.displayName}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="flex items-center gap-2">
            <UserIcon className="size-4" />
            <div className="min-w-0">
              <div className="truncate font-medium">{me.displayName}</div>
              <div className="truncate text-xs font-normal text-muted-foreground">
                {me.email}
              </div>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => setPwOpen(true)}
            className="cursor-pointer"
          >
            <KeyRound className="mr-2 size-4" />
            修改密碼
          </DropdownMenuItem>
          <form action={signOutAction}>
            <button type="submit" className="w-full">
              <DropdownMenuItem asChild>
                <span className="cursor-pointer">
                  <LogOut className="mr-2 size-4" />
                  登出
                </span>
              </DropdownMenuItem>
            </button>
          </form>
        </DropdownMenuContent>
      </DropdownMenu>
      <ChangePasswordDialog
        open={pwOpen}
        onOpenChange={setPwOpen}
        email={me.email ?? ""}
      />
    </>
  );
}
