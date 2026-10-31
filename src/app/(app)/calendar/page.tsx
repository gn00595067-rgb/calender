import { Suspense } from "react";
import { CalendarView } from "@/components/calendar/calendar-view";

export default function CalendarPage() {
  // CalendarView 讀網址 ?date=&view=（語音操作後跳到那天），需包 Suspense
  return (
    <Suspense>
      <CalendarView />
    </Suspense>
  );
}
