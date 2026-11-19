"use client";

import { useMemo, useState } from "react";
import { useAppData } from "@/components/app/app-data";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { usePendingProposalsInRange, type ProposalRow } from "@/lib/client/proposals";
import type { CalEvent } from "@/lib/client/events";
import { ProposalReviewCard } from "./proposal-review";

/**
 * 待審核的提議（0030）變成虛線「假行程」併進行事曆畫面（月曆、週行程表、區間總覽共用）。
 * 不算空檔、不算衝突（availability／calendar-utils 會略過有 proposal 的）；點了開審核視窗。
 */
export function useProposalGhosts(events: CalEvent[], startIso: string, endIso: string) {
  const { me, calendarById, visibleIds } = useAppData();
  const { data: proposals = [] } = usePendingProposalsInRange(
    me.reviewsProposals ? me.id : "",
    startIso,
    endIso,
  );
  const [reviewing, setReviewing] = useState<ProposalRow | null>(null);
  const merged = useMemo(() => {
    if (proposals.length === 0) return events;
    const ghosts: CalEvent[] = proposals
      .filter((p) => calendarById.has(p.calendar_id) && visibleIds.has(p.calendar_id))
      .map((p) => ({
        id: `proposal-${p.id}`,
        calendar_id: p.calendar_id,
        creator_id: p.proposer_id,
        title: `待審核：${p.title}`,
        description: p.note,
        location: p.location,
        starts_at: p.starts_at,
        ends_at: p.ends_at,
        all_day: false,
        is_important: false,
        recurrence_rule: null,
        recurrence_group_id: null,
        reminder_minutes: null,
        reminder2_minutes: null,
        contactNames: [],
        subjectNames: [],
        participantNames: [],
        tagNames: [],
        finance: [],
        noteCount: 0,
        noteAuthorIds: [],
        driver: null,
        travel: null,
        proposal: p,
      }));
    return [...events, ...ghosts].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }, [events, proposals, calendarById, visibleIds]);

  /** 點行程：提議 → 審核視窗；正式行程 → 原本的處理 */
  const select = (e: CalEvent, onEvent: (e: CalEvent) => void) =>
    e.proposal ? setReviewing(e.proposal) : onEvent(e);

  const dialog = (
    <Dialog open={!!reviewing} onOpenChange={(o) => !o && setReviewing(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>待審核的行程</DialogTitle>
        </DialogHeader>
        {reviewing && <ProposalReviewCard proposal={reviewing} onDone={() => setReviewing(null)} />}
      </DialogContent>
    </Dialog>
  );

  return { events: merged, select, dialog };
}
