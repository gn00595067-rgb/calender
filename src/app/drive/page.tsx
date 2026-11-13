import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOutAction } from "@/app/login/actions";
import { DriverHome } from "@/components/overtime/driver-home";
import { TeacherPasswordButton } from "@/components/tutor/teacher-password-button";

/**
 * 司機頁：司機帳號登入後只會看到這一頁（今天班表、接送行程、填加班、我的加班）。
 * spec：docs/specs/司機打卡與加班費.md
 */
export default async function DrivePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: links } = await supabase.rpc("my_driver_links");
  if (!links || links.length === 0) redirect("/calendar");

  return (
    <div className="mx-auto w-full max-w-2xl p-4">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">司機</h1>
          <p className="text-sm text-muted-foreground">
            {links[0].contact_name}
            {links[0].owner_name ? ` · ${links[0].owner_name} 家` : ""}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <TeacherPasswordButton email={user.email ?? ""} />
          <form action={signOutAction}>
            <button type="submit" className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
              登出
            </button>
          </form>
        </div>
      </header>
      <DriverHome />
    </div>
  );
}
