import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/env";
import { ensureBootstrap } from "@/lib/bootstrap";
import { getAccessibleCalendars } from "@/lib/queries/calendars";
import { AppChrome } from "@/components/app/app-chrome";
import { ReminderNotifier } from "@/components/app/reminder-notifier";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  if (!hasSupabaseEnv()) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md space-y-3 rounded-xl border bg-card p-6 text-center">
          <h1 className="text-lg font-bold">尚未連接 Supabase</h1>
          <p className="text-sm text-muted-foreground">
            請依 README「快速開始」建立 Supabase 專案，並在 <code>.env.local</code> 填入
            金鑰後重新啟動開發伺服器。
          </p>
        </div>
      </div>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  await ensureBootstrap(user);

  const [calendars, profileRes] = await Promise.all([
    getAccessibleCalendars(user.id),
    supabase.from("profiles").select("display_name").eq("id", user.id).single(),
  ]);

  const me = {
    id: user.id,
    email: user.email ?? "",
    displayName:
      profileRes.data?.display_name ||
      (user.user_metadata?.display_name as string | undefined) ||
      user.email?.split("@")[0] ||
      "使用者",
  };

  return (
    <>
      <AppChrome me={me} calendars={calendars}>
        {children}
      </AppChrome>
      <ReminderNotifier />
    </>
  );
}
