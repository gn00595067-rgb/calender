"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useAppData } from "@/components/app/app-data";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useIncomingProposals } from "@/lib/client/proposals";
import { ProposalReviewCard } from "./proposal-review";

const SEEN_KEY = "execcal:proposals-popup-seen";

/**
 * Peggy 一打開 App，有待審核就自動跳出清單（Elsa 11/19），逐筆同意／退回。
 * 同一次開啟只跳一次；在「待審核」頁本身不跳。
 */
export function PendingProposalsPopup() {
  const { me } = useAppData();
  const pathname = usePathname();
  const { data } = useIncomingProposals(me.reviewsProposals ? me.id : "");
  const pending = data?.pending ?? [];
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (pending.length === 0 || pathname.startsWith("/proposals")) return;
    let seen = false;
    try {
      seen = sessionStorage.getItem(SEEN_KEY) === "1";
    } catch {
      /* 無法存取就照跳 */
    }
    if (seen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 有待審核時打開一次
    setOpen(true);
    try {
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* ignore */
    }
  }, [pending.length, pathname]);

  if (!me.reviewsProposals) return null;
  return (
    <Dialog open={open && pending.length > 0} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>有 {pending.length} 筆行程等你審核</DialogTitle>
          <DialogDescription>
            「同意」直接上曆；要補司機、費用按「補資料再同意」；不行就退回。稍後也能在選單「待審核」處理。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {pending.map((p) => (
            <ProposalReviewCard key={p.id} proposal={p} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
