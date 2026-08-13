import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/states";
import { Search } from "lucide-react";

export default function SearchPage() {
  return (
    <div>
      <PageHeader title="搜尋" description="跨行程、人物、標籤、回饋全文搜尋與篩選。" />
      <EmptyState
        icon={Search}
        title="搜尋與篩選（Phase 3）建置中"
        description="可用 Ctrl/⌘+K 或 / 呼出快捷搜尋。"
      />
    </div>
  );
}
