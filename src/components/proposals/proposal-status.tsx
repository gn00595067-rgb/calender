import { cn } from "@/lib/utils";

const LABEL = { pending: "待審核", approved: "已核准", rejected: "已退回" } as const;

/** 提議行程的狀態小標籤 */
export function ProposalStatus({ status }: { status: keyof typeof LABEL }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 text-xs leading-5 font-medium",
        status === "pending" && "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
        status === "approved" && "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
        status === "rejected" && "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
      )}
    >
      {LABEL[status]}
    </span>
  );
}
