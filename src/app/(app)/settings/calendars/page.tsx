import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/states";
import { FolderCog } from "lucide-react";

export default function CalendarsSettingsPage() {
  return (
    <div>
      <PageHeader title="分類管理" description="新增、改名、改色、排序與刪除行事曆分類。" />
      <EmptyState
        icon={FolderCog}
        title="分類管理（Phase 2）建置中"
        description="目前已於首次登入建立四個預設分類。"
      />
    </div>
  );
}
