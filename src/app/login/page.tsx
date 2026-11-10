"use client";

import { useActionState, useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import { signInAction, signUpAction, type AuthState } from "./actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { APP_NAME, APP_TAGLINE, REMEMBER_KEY } from "@/lib/constants";

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
  // 受控欄位：登入失敗時 React 會重設表單，未受控欄位會被清空，要整個重打（11/10 回饋）
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signInState, signIn, signInPending] = useActionState<AuthState, FormData>(
    signInAction,
    undefined,
  );
  const [signUpState, signUp, signUpPending] = useActionState<AuthState, FormData>(
    signUpAction,
    undefined,
  );

  // 首次載入：帶入上次「記住我」保存的帳密（放 effect 避免 hydration 落差）。
  useEffect(() => {
    const saved = loadRemembered();
    if (!saved) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 掛載時自 localStorage 同步一次
    if (saved.email) setEmail(saved.email);
    if (saved.password) setPassword(saved.password);
  }, []);

  // 送出登入前：依「記住我」保存或清除帳密（onSubmit 於 Server Action 之前執行）。
  function persistRemember() {
    try {
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
              <form action={signIn} onSubmit={persistRemember} className="mt-4 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="login-email">Email</Label>
                  <Input
                    id="login-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="name@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password">密碼</Label>
                  <PasswordInput
                    id="login-password"
                    name="password"
                    autoComplete="current-password"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
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
                    placeholder="例如：Peggy姐"
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
                  <PasswordInput
                    id="reg-password"
                    name="password"
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
      </div>
    </div>
  );
}
