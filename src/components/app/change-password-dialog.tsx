"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  changePasswordAction,
  type ChangePasswordState,
} from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { REMEMBER_KEY } from "@/lib/constants";

/**
 * 修改自己的密碼。spec：docs/specs/修改密碼.md
 * 改成功後其他裝置一律登出（這台保留）；若這台裝置「記住帳號密碼」存的是同一個 Email，一併換成新密碼。
 */
export function ChangePasswordDialog({
  open,
  onOpenChange,
  email,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>修改密碼</DialogTitle>
          <DialogDescription>{email}</DialogDescription>
        </DialogHeader>
        {/* 每次打開重新掛載，清掉上次的輸入與錯誤 */}
        {open && (
          <ChangePasswordForm
            email={email}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ChangePasswordForm({
  email,
  onDone,
}: {
  email: string;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState<
    ChangePasswordState,
    FormData
  >(changePasswordAction, undefined);

  // 送出時記下新密碼，成功後才寫回「記住帳號密碼」。
  const submitted = useRef("");

  useEffect(() => {
    if (!state?.ok) return;
    try {
      const raw = window.localStorage.getItem(REMEMBER_KEY);
      const saved = raw ? (JSON.parse(raw) as { email?: string }) : null;
      if (saved?.email === email && submitted.current) {
        window.localStorage.setItem(
          REMEMBER_KEY,
          JSON.stringify({ email, password: submitted.current }),
        );
      }
    } catch {
      // localStorage 不可用（隱私模式等）時略過
    }
    toast.success("密碼已更新，其他裝置都已登出，要用新密碼重新登入");
    onDone();
  }, [state, email, onDone]);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        submitted.current = String(
          new FormData(e.currentTarget).get("password") ?? "",
        );
      }}
      className="space-y-4"
    >
      <div className="space-y-2">
        <Label htmlFor="new-password">新密碼</Label>
        <PasswordInput
          id="new-password"
          name="password"
          autoComplete="new-password"
          placeholder="至少 6 碼"
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm-password">再輸入一次</Label>
        <PasswordInput
          id="confirm-password"
          name="confirm"
          autoComplete="new-password"
          required
        />
      </div>
      {state?.error && (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "儲存中…" : "儲存"}
      </Button>
    </form>
  );
}
