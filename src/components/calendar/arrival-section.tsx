"use client";

import { useState } from "react";
import Link from "next/link";
import { useAppData } from "@/components/app/app-data";
import { useWorkPeople } from "@/lib/client/work";
import { useContacts } from "@/lib/client/lookups";
import { useMyStaffLinks, useStaffCategories, useStaffLogs } from "@/lib/client/staff";
import { useSchedule } from "@/lib/client/tutor";
import { fmt } from "@/lib/date";
import { hmToMin } from "@/lib/work-groups";
import type { CalEvent } from "@/lib/client/events";
import { cn } from "@/lib/utils";

/**
 * 家庭老師到班區塊（Elsa 11/19）：行事曆只顯示「到班 17:00–22:00」一塊，
 * 點進來分「預排課表」（週課表）與「工作報告」（老師實際記的工作紀錄），可對照。
 * 只在相關人物／主角裡有家庭老師（有工作紀錄設定的人）時顯示。
 */
export function ArrivalSection({ event }: { event: CalEvent }) {
  const { me, calendarById } = useAppData();
  const ownerId = calendarById.get(event.calendar_id)?.owner_id ?? null;
  const isOwner = ownerId === me.id;
  const { data: contacts = [] } = useContacts();
  const people = useWorkPeople();
  const links = useMyStaffLinks(!isOwner && !!me.isStaff);

  // 這堂的家庭老師：家長看「有工作設定的人」；老師看自己
  const candidates = isOwner
    ? (people.data ?? []).map((id) => contacts.find((c) => c.id === id)).filter((c) => !!c)
    : (links.data ?? []).filter((l) => l.owner_id === ownerId).map((l) => ({ id: l.contact_id, name: l.contact_name }));
  const staff = candidates.find((c) => event.contactNames.includes(c!.name)) ?? null;

  const day = fmt(event.starts_at, "yyyy-MM-dd");
  const from = hmToMin(fmt(event.starts_at, "HH:mm"));
  const to = from + Math.round((Date.parse(event.ends_at) - Date.parse(event.starts_at)) / 60000);
  const [tab, setTab] = useState<"plan" | "report">("report");
  const schedule = useSchedule(staff ? ownerId : null, day, day);
  const logs = useStaffLogs(staff?.id ?? null, day, day);
  const cats = useStaffCategories(staff?.id ?? null);
  if (!staff || event.all_day) return null;

  const inBlock = (s: string | null) => s != null && hmToMin(s.slice(0, 5)) >= from - 30 && hmToMin(s.slice(0, 5)) < to;
  const plan = (schedule.data ?? []).filter((i) => inBlock(i.start_time));
  const done = (logs.data ?? []).filter((l) => l.event_id === event.id || inBlock(l.start_time));
  const catName = new Map((cats.data ?? []).map((c) => [c.id, c.name]));
  const hours = done.reduce((s, l) => s + l.hours, 0);

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{staff.name} 到班</span>
        <div className="ml-auto flex rounded-md border p-0.5 text-xs">
          {(
            [
              ["plan", `預排課表 ${plan.length}`],
              ["report", `工作報告 ${done.length}`],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={cn("rounded px-2 py-0.5", tab === k ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {tab === "plan" ? (
        plan.length === 0 ? (
          <p className="text-sm text-muted-foreground">這段時間還沒排課表（在「家教填報」→ 週課表排）。</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {plan.map((i) => (
              <li key={i.id} className={cn(i.status && "text-muted-foreground line-through")}>
                <span className="tabular-nums text-muted-foreground">
                  {i.start_time.slice(0, 5)}–{i.end_time.slice(0, 5)}
                </span>{" "}
                {i.title}
                {i.responsible && <span className="text-muted-foreground">（{i.responsible}）</span>}
                {i.status && <span className="ml-1 text-destructive no-underline">{i.status}</span>}
              </li>
            ))}
          </ul>
        )
      ) : done.length === 0 ? (
        <p className="text-sm text-muted-foreground">還沒有工作紀錄。</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {done.map((l) => (
            <li key={l.id}>
              <span className="tabular-nums text-muted-foreground">
                {l.start_time?.slice(0, 5)}–{l.end_time?.slice(0, 5)}
              </span>{" "}
              <span className="rounded bg-muted px-1 text-xs">
                {(l.category_id && catName.get(l.category_id)) || l.category_raw || "未分類"}
              </span>{" "}
              {l.content}
            </li>
          ))}
          <li className="text-xs text-muted-foreground">合計 {hours.toFixed(2)} 小時</li>
        </ul>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <Link href={isOwner ? "/tutoring?tab=schedule" : "/tutoring"} className="text-xs text-primary underline">
          排週課表（預排）→
        </Link>
        <Link href={isOwner ? "/work/weekly" : "/my-work"} className="text-xs text-primary underline">
          {isOwner ? "看每日紀錄與週報 →" : "記工作紀錄 →"}
        </Link>
      </div>
    </div>
  );
}
