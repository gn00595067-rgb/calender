import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/states";
import { Users } from "lucide-react";

export default function ContactsSettingsPage() {
  return (
    <div>
      <PageHeader title="人物管理" description="家教老師、客戶、醫師等聯絡人。" />
      <EmptyState
        icon={Users}
        title="人物管理（Phase 2）建置中"
        description="行程可關聯人物，供搜尋與報表分組。"
      />
    </div>
  );
}
