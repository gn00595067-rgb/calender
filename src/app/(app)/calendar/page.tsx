import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/states";
import { CalendarDays } from "lucide-react";

export default function CalendarPage() {
  return (
    <div>
      <PageHeader title="行事曆" description="月／週／日檢視，一眼掌握所有分類行程。" />
      <EmptyState
        icon={CalendarDays}
        title="行事曆核心（Phase 2）建置中"
        description="此頁將提供月／週／日三種自製視圖與行程新增。左側分類與顯示開關已可運作。"
      />
    </div>
  );
}
