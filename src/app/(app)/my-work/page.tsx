"use client";

import { Briefcase } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState, ListSkeleton } from "@/components/app/states";
import { StaffWorkspace } from "@/components/work/staff-workspace";
import { useMyStaffLinks } from "@/lib/client/staff";

/**
 * 我的工作（家庭老師）：每日分時紀錄＋週報。家長在人物管理把人物連到這個帳號才看得到。
 * spec：docs/specs/Elsa需求-多人權限與家庭老師報告.md
 */
export default function MyWorkPage() {
  const links = useMyStaffLinks();
  const people = (links.data ?? []).map((l) => ({ id: l.contact_id, name: l.contact_name }));
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="我的工作" description="到班時記下每段時間做了什麼；週末自動整理成週報，寫好重點檢討後送出。" />
      {links.isLoading ? (
        <ListSkeleton rows={5} />
      ) : people.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="還沒有連到工作人物"
          description="請家長到「人物管理」→ 你的名字 →「員工帳號」輸入你的登入 Email。"
        />
      ) : (
        <StaffWorkspace people={people} asStaff />
      )}
    </div>
  );
}
