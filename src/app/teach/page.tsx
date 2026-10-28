import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOutAction } from "@/app/login/actions";
import { TeachView } from "@/components/teach/teach-view";

/**
 * 老師頁：老師帳號登入後只會看到這一頁（自己的課＋寫回饋）。
 * spec：docs/specs/老師自填回饋與缺回饋不付款.md
 */
export default async function TeachPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: links } = await supabase.rpc("my_teacher_links");
  if (!links || links.length === 0) redirect("/calendar");

  return (
    <div className="mx-auto w-full max-w-2xl p-4">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">我的課與回饋</h1>
          <p className="text-sm text-muted-foreground">
            {links.map((l) => `${l.contact_name}老師`).join("、")}
            {links[0]?.owner_name ? ` · ${links[0].owner_name} 家` : ""}
          </p>
        </div>
        <form action={signOutAction}>
          <button type="submit" className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
            登出
          </button>
        </form>
      </header>
      <TeachView userId={user.id} />
    </div>
  );
}
