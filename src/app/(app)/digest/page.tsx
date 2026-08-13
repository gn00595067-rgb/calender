import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/states";
import { LayoutDashboard } from "lucide-react";

export default function DigestPage() {
  return (
    <div>
      <PageHeader
        title="區間總覽"
        description="輸入一段期間，在一個螢幕內看清所有重點。"
      />
      <EmptyState
        icon={LayoutDashboard}
        title="區間總覽（Phase 3）建置中"
        description="本產品的招牌功能：依區間長度自動切換密度的單螢幕摘要。"
      />
    </div>
  );
}
