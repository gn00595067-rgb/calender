"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const credentialsSchema = z.object({
  // 手機鍵盤常把開頭變大寫、複製時帶到空白：Email 一律去空白轉小寫（密碼大小寫有別，只去前後空白）
  email: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
    z.email({ error: "請輸入有效的 Email" }),
  ),
  password: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.string().min(6, { error: "密碼至少 6 碼" }),
  ),
  displayName: z.string().trim().optional(),
});

export type AuthState = { error?: string } | undefined;

function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login")) return "Email 或密碼錯誤";
  if (m.includes("already registered") || m.includes("already been registered"))
    return "此 Email 已註冊過，請直接登入";
  if (m.includes("email not confirmed")) return "Email 尚未驗證";
  if (m.includes("rate limit")) return "嘗試次數過多，請稍後再試";
  return message;
}

export async function signInAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "輸入格式有誤" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) return { error: friendlyAuthError(error.message) };

  redirect("/calendar");
}

export async function signUpAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    displayName: formData.get("displayName"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "輸入格式有誤" };
  }

  const supabase = await createClient();
  const displayName =
    parsed.data.displayName?.trim() || parsed.data.email.split("@")[0];

  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { display_name: displayName } },
  });
  if (error) return { error: friendlyAuthError(error.message) };

  // 若專案關閉 Email 驗證，signUp 後即有 session；直接進主頁（bootstrap 於 app layout 完成）。
  redirect("/calendar");
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

const newPasswordSchema = z
  .object({
    password: z.string().min(6, { error: "密碼至少 6 碼" }),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { error: "兩次輸入的密碼不一樣" });

export type ChangePasswordState = { error?: string; ok?: boolean } | undefined;

/** 已登入者修改自己的密碼（不要求舊密碼，見 docs/specs/修改密碼.md） */
export async function changePasswordAction(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const parsed = newPasswordSchema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "輸入格式有誤" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "登入已過期，請重新登入" };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    const m = error.message.toLowerCase();
    if (m.includes("different from the old")) return { error: "新密碼跟原本的一樣，請換一組" };
    if (m.includes("reauthentication")) return { error: "需要重新登入後才能改密碼" };
    return { error: friendlyAuthError(error.message) };
  }
  // 其他裝置一律登出（這台保留）。proxy 每次換頁都 getUser 向伺服器驗 session，所以下一次操作就會被導回登入頁。
  await supabase.auth.signOut({ scope: "others" });
  return { ok: true };
}
