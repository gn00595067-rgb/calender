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

  // 初始化與老師身分檢查互不相依，同時查（伺服器與資料庫每來回一次都要時間）
  const [, { data: teacherLinks }, { data: driverLinks }] = await Promise.all([
    ensureBootstrap(user),
    // 老師帳號（人物管理建立的）只用來寫回饋：一律進老師頁（0021 未套用時查詢失敗，照常進行事曆）
    supabase.rpc("my_teacher_links"),
    // 司機帳號：一律進司機頁（0028 未套用時查詢失敗，照常進行事曆）
    supabase.rpc("my_driver_links"),
  ]);
  if (teacherLinks && teacherLinks.length > 0) redirect("/teach");
  if (driverLinks && driverLinks.length > 0) redirect("/drive");

  const [calendars, profileRes, { count: freebusyIn }, { count: freebusyOut }, { data: staffLinks }] = await Promise.all([
    getAccessibleCalendars(user.id),
    supabase.from("profiles").select("display_name").eq("id", user.id).single(),
    // 只看空檔（0030）：別人分享給我的 → 幫排行程；我分享出去的 → 待審核
    supabase
      .from("calendar_shares")
      .select("id", { count: "exact", head: true })
      .eq("member_id", user.id)
      .eq("role", "freebusy"),
    supabase
      .from("calendar_shares")
      .select("id, calendars!inner(owner_id)", { count: "exact", head: true })
      .eq("role", "freebusy")
      .eq("calendars.owner_id", user.id),
    // 員工帳號（0031 前查詢失敗 → 不是）
    supabase.rpc("my_staff_links"),
  ]);

  const me = {
    id: user.id,
    email: user.email ?? "",
    displayName:
      profileRes.data?.display_name ||
      (user.user_metadata?.display_name as string | undefined) ||
      user.email?.split("@")[0] ||
      "使用者",
    canPropose: (freebusyIn ?? 0) > 0,
    reviewsProposals: (freebusyOut ?? 0) > 0,
    isStaff: (staffLinks?.length ?? 0) > 0,
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
