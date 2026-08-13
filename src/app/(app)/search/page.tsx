"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { Search as SearchIcon, Star, X, SlidersHorizontal } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState, ListSkeleton, ErrorState } from "@/components/app/states";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EventTwoLineCard } from "@/components/calendar/event-card";
import { EventDetailDialog } from "@/components/calendar/event-detail-dialog";
import { useAppData } from "@/components/app/app-data";
import { useContacts, useTags } from "@/lib/client/lookups";
import { useSearch } from "@/lib/client/search";
import { zoned } from "@/lib/calendar-utils";
import { D } from "@/lib/date";
import { cn } from "@/lib/utils";
import type { CalEvent } from "@/lib/client/events";

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function SearchInner() {
  const params = useSearchParams();
  const { calendars, calendarById } = useAppData();
  const { data: contacts = [] } = useContacts();
  const { data: tags = [] } = useTags();

  const [q, setQ] = useState(params.get("q") ?? "");
  const debouncedQ = useDebounced(q, 300);

  const [calFilter, setCalFilter] = useState<Set<string>>(new Set());
  const [contactId, setContactId] = useState<string | null>(null);
  const [tagId, setTagId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [importantOnly, setImportantOnly] = useState(false);
  const [hasFinance, setHasFinance] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [detail, setDetail] = useState<CalEvent | null>(null);

  // 搜尋範圍：若未指定分類過濾，就是全部可存取的分類
  const scopeIds =
    calFilter.size > 0 ? [...calFilter] : calendars.map((c) => c.id);

  const { data: results = [], isLoading, isError, error, refetch } = useSearch({
    q: debouncedQ,
    calendarIds: scopeIds,
    contactId,
    tagId,
    startDate: startDate || null,
    endDate: endDate || null,
    importantOnly,
    hasFinance,
  });

  const grouped = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const e of results) {
      const ds = format(zoned(e.starts_at), "yyyy-MM-dd");
      const arr = m.get(ds);
      if (arr) arr.push(e);
      else m.set(ds, [e]);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [results]);

  const activeFilterCount =
    calFilter.size +
    (contactId ? 1 : 0) +
    (tagId ? 1 : 0) +
    (startDate ? 1 : 0) +
    (endDate ? 1 : 0) +
    (importantOnly ? 1 : 0) +
    (hasFinance ? 1 : 0);

  const clearFilters = () => {
    setCalFilter(new Set());
    setContactId(null);
    setTagId(null);
    setStartDate("");
    setEndDate("");
    setImportantOnly(false);
    setHasFinance(false);
  };

  const toggleCal = (id: string) => {
    setCalFilter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const hasCriteria =
    debouncedQ.trim() || activeFilterCount > 0;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="搜尋" description="跨行程、人物、標籤、回饋全文搜尋。" />

      <div className="space-y-3">
        <div className="relative">
          <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜尋標題、地點、人物、標籤、回饋…"
            className="h-11 pl-9 pr-9"
            autoFocus
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="清除"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters((s) => !s)}
          >
            <SlidersHorizontal className="size-4" />
            篩選
            {activeFilterCount > 0 && (
              <span className="ml-1 rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
                {activeFilterCount}
              </span>
            )}
          </Button>
          {activeFilterCount > 0 && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              清除篩選
            </Button>
          )}
        </div>

        {showFilters && (
          <div className="space-y-3 rounded-xl border bg-card p-3">
            <div>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">分類</div>
              <div className="flex flex-wrap gap-1.5">
                {calendars.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleCal(c.id)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm",
                      calFilter.has(c.id)
                        ? "border-primary bg-primary/10"
                        : "hover:bg-accent",
                    )}
                  >
                    <span className="size-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                    {c.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">人物</div>
                <select
                  value={contactId ?? ""}
                  onChange={(e) => setContactId(e.target.value || null)}
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                >
                  <option value="">全部</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.role_label ? `（${c.role_label}）` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">標籤</div>
                <select
                  value={tagId ?? ""}
                  onChange={(e) => setTagId(e.target.value || null)}
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                >
                  <option value="">全部</option>
                  {tags.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">起始日</div>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="h-9"
                />
              </div>
              <div>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">結束日</div>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="h-9"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setImportantOnly((v) => !v)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-sm",
                  importantOnly ? "border-amber-500 bg-amber-50 text-amber-700" : "hover:bg-accent",
                )}
              >
                <Star className="size-3.5" />
                僅重點行程
              </button>
              <button
                type="button"
                onClick={() => setHasFinance((v) => !v)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-sm",
                  hasFinance ? "border-primary bg-primary/10" : "hover:bg-accent",
                )}
              >
                含財務紀錄
              </button>
            </div>
          </div>
        )}

        {/* 結果 */}
        {!hasCriteria ? (
          <EmptyState
            icon={SearchIcon}
            title="開始搜尋"
            description="輸入關鍵字，或用篩選條件找出行程。可用 Ctrl/⌘+K 快速呼出。"
          />
        ) : isError ? (
          <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
        ) : isLoading ? (
          <ListSkeleton rows={5} />
        ) : results.length === 0 ? (
          <EmptyState icon={SearchIcon} title="沒有符合的行程" description="試試其他關鍵字或放寬篩選。" />
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">共 {results.length} 筆結果</p>
            {grouped.map(([ds, list]) => (
              <div key={ds}>
                <div className="mb-1.5 text-sm font-semibold text-muted-foreground">
                  {D.full(list[0].starts_at).slice(0, 14)}
                </div>
                <div className="space-y-1.5">
                  {list.map((e) => (
                    <div key={e.id} className="flex items-start gap-2">
                      <span
                        className="mt-1 hidden w-16 shrink-0 text-xs text-muted-foreground sm:block"
                      >
                        {calendarById.get(e.calendar_id)?.name}
                      </span>
                      <div className="flex-1">
                        <EventTwoLineCard
                          event={e}
                          color={calendarById.get(e.calendar_id)?.color ?? "#64748B"}
                          onClick={() => setDetail(e)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <EventDetailDialog
        open={!!detail}
        onOpenChange={(o) => !o && setDetail(null)}
        event={detail}
        onEdit={() => setDetail(null)}
        onChanged={() => refetch()}
      />
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<ListSkeleton rows={5} />}>
      <SearchInner />
    </Suspense>
  );
}
