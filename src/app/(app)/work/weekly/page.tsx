"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { ListSkeleton } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { StaffWorkspace } from "@/components/work/staff-workspace";
import { useContacts } from "@/lib/client/lookups";
import { useWorkPeople } from "@/lib/client/work";

/**
 * 家長看家庭老師的每日紀錄與週報（也可以幫忙補記）。
 * spec：docs/specs/Elsa需求-多人權限與家庭老師報告.md
 */
export default function WorkWeeklyPage() {
  const { data: contacts = [] } = useContacts();
  const ids = useWorkPeople();
  const people = (ids.data ?? [])
    .map((id) => contacts.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => !!c)
    .map((c) => ({ id: c.id, name: c.name }));
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="每日紀錄與週報"
        description="家庭老師自己記的工作紀錄、送出的週報"
        actions={
          <Button variant="outline" asChild>
            <Link href="/work">
              <ChevronLeft className="size-4" />
              工作效益
            </Link>
          </Button>
        }
      />
      {ids.isLoading ? <ListSkeleton rows={5} /> : <StaffWorkspace people={people} defaultTab="report" />}
    </div>
  );
}
