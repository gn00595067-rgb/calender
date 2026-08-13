import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/states";
import { BarChart3 } from "lucide-react";

export default function ReportsPage() {
  return (
    <div>
      <PageHeader title="報表結算" description="每月財務統整、費用結清與教學進度統整。" />
      <EmptyState
        icon={BarChart3}
        title="報表結算（Phase 5）建置中"
        description="財務總覽、費用明細就地結清與 CSV 匯出。"
      />
    </div>
  );
}
