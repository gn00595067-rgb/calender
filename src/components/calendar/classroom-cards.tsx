"use client";

import { useState } from "react";
import Link from "next/link";
import { School } from "lucide-react";
import { useAppData } from "@/components/app/app-data";
import { matchClassroom, useClassrooms } from "@/lib/client/classrooms";
import type { CalEvent } from "@/lib/client/events";

/** 行程標題或地點對到教室資料（0033）→ 顯示教室名，點開看補課規則等 */
export function ClassroomCards({ event }: { event: CalEvent }) {
  const { calendarById } = useAppData();
  const ownerId = calendarById.get(event.calendar_id)?.owner_id ?? null;
  const { data } = useClassrooms(ownerId);
  const hits = matchClassroom(data, event.title, event.location);
  const [open, setOpen] = useState<string | null>(null);
  if (hits.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {hits.map((c) => (
        <div key={c.id} className="text-sm">
          <button
            type="button"
            onClick={() => setOpen(open === c.id ? null : c.id)}
            className="inline-flex items-center gap-1 font-medium text-primary underline decoration-dotted underline-offset-4"
            aria-expanded={open === c.id}
          >
            <School className="size-3.5" />
            {c.name} 的教室資料
          </button>
          {open === c.id && (
            <div className="mt-1 space-y-1 rounded-md border bg-muted/40 px-3 py-2">
              {(
                [
                  ["補課規則", c.makeup_rules],
                  ["課程使用期限", c.term_rules],
                  ["費用", c.fee],
                  ["聯絡人／電話", c.contact],
                  ["地點", c.address],
                  ["其他", c.note],
                ] as const
              )
                .filter(([, v]) => v.trim())
                .map(([k, v]) => (
                  <div key={k}>
                    <span className="text-xs text-muted-foreground">{k}：</span>
                    <span className="whitespace-pre-wrap">{v}</span>
                  </div>
                ))}
              <Link href="/classrooms" className="text-xs text-primary underline">
                到教室資料修改 →
              </Link>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
