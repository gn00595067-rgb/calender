import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/states";
import { Share2 } from "lucide-react";

export default function SharesSettingsPage() {
  return (
    <div>
      <PageHeader title="分享與權限" description="以 Email 邀請成員並指定角色。" />
      <EmptyState
        icon={Share2}
        title="分享與權限（Phase 4）建置中"
        description="細緻的角色權限：編輯者／協作者／檢視者。"
      />
    </div>
  );
}
