"use client";

import { useActionState, useState } from "react";
import { CalendarClock } from "lucide-react";
import { signInAction, signUpAction, type AuthState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { APP_NAME, APP_TAGLINE } from "@/lib/constants";

function SubmitButton({ pending, label }: { pending: boolean; label: string }) {
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "處理中…" : label}
    </Button>
  );
}

export default function LoginPage() {
  const [tab, setTab] = useState("login");
  const [signInState, signIn, signInPending] = useActionState<AuthState, FormData>(
    signInAction,
    undefined,
  );
  const [signUpState, signUp, signUpPending] = useActionState<AuthState, FormData>(
    signUpAction,
    undefined,
  );

  return (
    <div className="flex min-h-full flex-1 items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-3 flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <CalendarClock className="size-7" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{APP_NAME}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {APP_TAGLINE}－在一個螢幕內看清一段期間所有重要的事
          </p>
        </div>

        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">登入</TabsTrigger>
              <TabsTrigger value="register">註冊</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <form action={signIn} className="mt-4 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="login-email">Email</Label>
                  <Input
                    id="login-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="boss@example.com"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password">密碼</Label>
                  <Input
                    id="login-password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                  />
                </div>
                {signInState?.error && (
                  <p className="text-sm text-destructive" role="alert">
                    {signInState.error}
                  </p>
                )}
                <SubmitButton pending={signInPending} label="登入" />
              </form>
            </TabsContent>

            <TabsContent value="register">
              <form action={signUp} className="mt-4 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="reg-name">顯示名稱</Label>
                  <Input
                    id="reg-name"
                    name="displayName"
                    type="text"
                    placeholder="王老闆"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reg-email">Email</Label>
                  <Input
                    id="reg-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reg-password">密碼</Label>
                  <Input
                    id="reg-password"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    placeholder="至少 6 碼"
                    required
                  />
                </div>
                {signUpState?.error && (
                  <p className="text-sm text-destructive" role="alert">
                    {signUpState.error}
                  </p>
                )}
                <SubmitButton pending={signUpPending} label="建立帳號" />
              </form>
            </TabsContent>
          </Tabs>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          測試帳號：boss@example.com／tutor@example.com（密碼 test1234）
        </p>
      </div>
    </div>
  );
}
