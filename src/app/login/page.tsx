"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { CalendarClock } from "lucide-react";
import { signInAction, signUpAction, type AuthState } from "./actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { APP_NAME, APP_TAGLINE } from "@/lib/constants";

/** 「記住我」在瀏覽器保存帳密的 localStorage key */
const REMEMBER_KEY = "execcal.remember";

/** 測試用預設帳號：王董事長（登入頁預先帶入，方便測試免打字） */
const DEMO_EMAIL = "boss@example.com";
const DEMO_PASSWORD = "test1234";

type Remembered = { email?: string; password?: string };

function loadRemembered(): Remembered | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(REMEMBER_KEY);
    return raw ? (JSON.parse(raw) as Remembered) : null;
  } catch {
    return null;
  }
}

function SubmitButton({ pending, label }: { pending: boolean; label: string }) {
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "處理中…" : label}
    </Button>
  );
}

export default function LoginPage() {
  const [tab, setTab] = useState("login");
  const [remember, setRemember] = useState(true);
  const formRef = useRef<HTMLFormElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [signInState, signIn, signInPending] = useActionState<AuthState, FormData>(
    signInAction,
    undefined,
  );
  const [signUpState, signUp, signUpPending] = useActionState<AuthState, FormData>(
    signUpAction,
    undefined,
  );

  // 首次載入：把上次「記住我」保存的帳密直接寫入未受控欄位（避免 hydration 落差）。
  useEffect(() => {
    const saved = loadRemembered();
    if (!saved) return;
    if (emailRef.current && saved.email) emailRef.current.value = saved.email;
    if (passwordRef.current && saved.password)
      passwordRef.current.value = saved.password;
  }, []);

  // 送出登入前：依「記住我」保存或清除帳密（onSubmit 於 Server Action 之前執行）。
  function persistRemember() {
    try {
      const email = emailRef.current?.value ?? "";
      const password = passwordRef.current?.value ?? "";
      if (remember && email) {
        window.localStorage.setItem(
          REMEMBER_KEY,
          JSON.stringify({ email, password }),
        );
      } else {
        window.localStorage.removeItem(REMEMBER_KEY);
      }
    } catch {
      // localStorage 不可用（隱私模式等）時，靜默略過即可。
    }
  }

  // 一鍵以王董事長登入（測試用）：填入預設帳密並直接送出。
  function loginAsDemo() {
    if (emailRef.current) emailRef.current.value = DEMO_EMAIL;
    if (passwordRef.current) passwordRef.current.value = DEMO_PASSWORD;
    formRef.current?.requestSubmit();
  }

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
              <form ref={formRef} action={signIn} onSubmit={persistRemember} className="mt-4 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="login-email">Email</Label>
                  <Input
                    ref={emailRef}
                    id="login-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="boss@example.com"
                    defaultValue={DEMO_EMAIL}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password">密碼</Label>
                  <Input
                    ref={passwordRef}
                    id="login-password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    defaultValue={DEMO_PASSWORD}
                    required
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="remember"
                    checked={remember}
                    onCheckedChange={(v) => setRemember(v === true)}
                  />
                  <Label htmlFor="remember" className="text-sm font-normal">
                    記住帳號密碼（此裝置）
                  </Label>
                </div>
                {signInState?.error && (
                  <p className="text-sm text-destructive" role="alert">
                    {signInState.error}
                  </p>
                )}
                <SubmitButton pending={signInPending} label="登入" />
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full"
                  disabled={signInPending}
                  onClick={loginAsDemo}
                >
                  一鍵以王董事長登入（測試）
                </Button>
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
