"use client";

import { Inbox } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState, ListSkeleton } from "@/components/app/states";
import { useAppData } from "@/components/app/app-data";
import { ProposalReviewCard } from "@/components/proposals/proposal-review";
import { useIncomingProposals } from "@/lib/client/proposals";

/**
 * 待審核（擁有者）：秘書／家庭老師從空檔提議的行程，審核（存成正式行程）或退回。
 * spec：docs/specs/只看空檔與提議行程審核.md
 */
export default function ProposalsPage() {
  const { me } = useAppData();
  const q = useIncomingProposals(me.id);
  const pending = q.data?.pending ?? [];
  const done = q.data?.done ?? [];

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="待審核"
        description="只看空檔的人（秘書、家庭老師）提議的行程。按「審核」會打開填好的新增表單，存檔才會成立。"
      />
      {q.isLoading ? (
        <ListSkeleton rows={4} />
      ) : pending.length === 0 ? (
        <EmptyState icon={Inbox} title="沒有待審核的行程" description="有人提議時會推播通知你，月曆上也會用虛線顯示。" />
      ) : (
        <div className="space-y-2">
          {pending.map((p) => (
            <ProposalReviewCard key={p.id} proposal={p} />
          ))}
        </div>
      )}

      {done.length > 0 && (
        <>
          <h2 className="mt-8 mb-2 text-lg font-bold">已處理</h2>
          <div className="space-y-2">
            {done.map((p) => (
              <ProposalReviewCard key={p.id} proposal={p} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
