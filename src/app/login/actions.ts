"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const credentialsSchema = z.object({
  email: z.email({ error: "請輸入有效的 Email" }),
  password: z.string().min(6, { error: "密碼至少 6 碼" }),
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
