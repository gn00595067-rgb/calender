"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EventModal } from "@/components/calendar/event-modal";
import { useAppData } from "@/components/app/app-data";
import { approveProposalDirectAction, reviewProposalAction } from "@/lib/actions/proposals";
import { waitingDays, type ProposalRow } from "@/lib/client/proposals";
import { fmt, utcToTaipeiWall } from "@/lib/date";
import { ProposalStatus } from "./proposal-status";

/**
 * 一筆提議的審核卡（待審核頁、月曆虛線點開都用這個）：
 * 「審核」打開預填好的新增行程表單，Peggy 存檔才成立；「退回」可寫原因。
 */
export function ProposalReviewCard({
  proposal: p,
  onDone,
}: {
  proposal: ProposalRow;
  /** 核准或退回後（例如關掉外層視窗） */
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const { calendarById } = useAppData();
  const [creating, setCreating] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const cal = calendarById.get(p.calendar_id);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["proposals"] });
    qc.invalidateQueries({ queryKey: ["events"] });
  };

  function approveNow() {
    startTransition(async () => {
      const res = await approveProposalDirectAction(p.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("已同意，行程已上曆");
      refresh();
      onDone?.();
    });
  }

  /** 送出超過 2 天還沒處理（Elsa：久未處理要提醒） */
  const waitDays = waitingDays(p.created_at);

  function review(status: "approved" | "rejected" | "pending") {
    startTransition(async () => {
      const res = await reviewProposalAction({ id: p.id, status, reviewNote: reason });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        status === "approved" ? "已核准，行程已建立" : status === "rejected" ? "已退回" : "已改回待審核",
      );
      setRejecting(false);
      refresh();
      onDone?.();
    });
  }

  return (
    <div className="rounded-xl border bg-card p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <ProposalStatus status={p.status} />
        <span className="font-medium">{p.title}</span>
        {p.status === "pending" && waitDays >= 2 && (
          <span className="text-xs font-medium text-destructive">已等 {waitDays} 天</span>
        )}
      </div>
      <div className="mt-1 tabular-nums">
        {fmt(p.starts_at, "M/d(EEEEE) HH:mm")}–{fmt(p.ends_at, "HH:mm")}
      </div>
      <div className="mt-1 space-y-0.5 text-muted-foreground">
        <div>
          {p.proposer_name ?? "有人"} 提議
          {cal && (
            <>
              {" · 放在 "}
              <span className="inline-flex items-center gap-1">
                <span className="size-2 rounded-full" style={{ backgroundColor: cal.color }} />
                {cal.name}
              </span>
            </>
          )}
        </div>
        {p.location && <div>地點：{p.location}</div>}
        {p.note && <div>備註：{p.note}</div>}
        {p.status === "rejected" && p.review_note && <div className="text-destructive">退回原因：{p.review_note}</div>}
      </div>

      {p.status === "pending" ? (
        rejecting ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Input
              className="h-8 flex-1"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="退回原因（選填），例：那天要陪小孩"
            />
            <Button size="sm" variant="destructive" disabled={pending} onClick={() => review("rejected")}>
              確定退回
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
              取消
            </Button>
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" disabled={pending} onClick={approveNow}>
              同意
            </Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => setCreating(true)}>
              補資料再同意
            </Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => setRejecting(true)}>
              退回
            </Button>
          </div>
        )
      ) : (
        <div className="mt-2">
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => review("pending")}>
            改回待審核
          </Button>
        </div>
      )}

      <EventModal
        open={creating}
        onOpenChange={setCreating}
        mode="create"
        draft={{
          calendarId: p.calendar_id,
          title: p.title,
          description: [p.note, `（${p.proposer_name ?? "有人"} 提議）`].filter(Boolean).join("\n"),
          location: p.location ?? undefined,
          startWall: utcToTaipeiWall(p.starts_at),
          endWall: utcToTaipeiWall(p.ends_at),
        }}
        onSaved={() => review("approved")}
      />
    </div>
  );
}
