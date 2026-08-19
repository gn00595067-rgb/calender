"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Search as SearchIcon,
  Star,
  X,
  SlidersHorizontal,
  CalendarClock,
  Plus,
  ArrowLeft,
} from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState, ListSkeleton, ErrorState } from "@/components/app/states";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EventTwoLineCard } from "@/components/calendar/event-card";
import { EventDetailDialog } from "@/components/calendar/event-detail-dialog";
import { EventModal } from "@/components/calendar/event-modal";
import { IntervalAvailabilityPanel } from "@/components/digest/availability";
import { presetInterval } from "@/components/digest/interval-picker";
import { useAppData } from "@/components/app/app-data";
import { can } from "@/lib/permissions";
import { useContacts, useTags } from "@/lib/client/lookups";
import { useSearch } from "@/lib/client/search";
import { zoned, conflictIds } from "@/lib/calendar-utils";
import {
  D,
  taipeiDateStartUtcISO,
  taipeiDateEndExclusiveUtcISO,
  taipeiTodayStr,
} from "@/lib/date";
import { cn } from "@/lib/utils";
import {
  fetchEventsInRange,
  type CalEvent,
} from "@/lib/client/events";
import type { WindowKey, MinGapKey } from "@/lib/availability";

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
  const router = useRouter();
  const { calendars, calendarById, visibleIds } = useAppData();
  const canCreate = calendars.some((c) => can.editEvents(c.effectiveRole));
  const { data: contacts = [] } = useContacts();
  const { data: tags = [] } = useTags();

  const [q, setQ] = useState(params.get("q") ?? "");
  const debouncedQ = useDebounced(q, 300);

  const [calFilter, setCalFilter] = useState<Set<string>>(new Set());
  const [contactIds, setContactIds] = useState<Set<string>>(new Set());
  const [tagIds, setTagIds] = useState<Set<string>>(new Set());
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [importantOnly, setImportantOnly] = useState(false);
  const [hasFinance, setHasFinance] = useState(false);
  const [hasNotes, setHasNotes] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [detail, setDetail] = useState<CalEvent | null>(null);
  const [editing, setEditing] = useState<CalEvent | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createStart, setCreateStart] = useState<string | undefined>(undefined);

  // 搜尋範圍：若未指定分類過濾，就是全部可存取的分類
  const scopeIds =
    calFilter.size > 0 ? [...calFilter] : calendars.map((c) => c.id);

  const { data: results = [], isLoading, isError, error, refetch } = useSearch({
    q: debouncedQ,
    calendarIds: scopeIds,
    contactIds: [...contactIds],
    tagIds: [...tagIds],
    startDate: startDate || null,
    endDate: endDate || null,
    importantOnly,
    hasFinance,
    hasNotes,
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

  // —— 這段期間的空檔：輸入起訖日即顯示（以所有顯示中分類的行程計算）——
  const [availWindowKey, setAvailWindowKey] = useState<WindowKey>("full");
  const [availMinGapKey, setAvailMinGapKey] = useState<MinGapKey>("60");
  const hasRange = Boolean(startDate && endDate && startDate <= endDate);
  const availStart = hasRange ? taipeiDateStartUtcISO(startDate) : "";
  const availEnd = hasRange ? taipeiDateEndExclusiveUtcISO(endDate) : "";
  const availIds = useMemo(() => [...visibleIds].sort(), [visibleIds]);
  const {
    data: availEvents = [],
    isLoading: availLoading,
    refetch: availRefetch,
  } = useQuery({
    queryKey: ["events", availStart, availEnd, availIds],
    queryFn: () => fetchEventsInRange(availStart, availEnd, availIds),
    enabled: hasRange,
  });
  const availConflicts = useMemo(() => conflictIds(availEvents), [availEvents]);

  const openCreate = (dateStr: string, hour = 9) => {
    if (!canCreate) return;
    setCreateStart(`${dateStr}T${String(hour).padStart(2, "0")}:00`);
    setCreateOpen(true);
  };
  const onSaved = () => {
    availRefetch();
    refetch();
  };

  // 時間區間為外層獨立控制（有自己的「清除區間」），不計入「篩選」
  const activeFilterCount =
    calFilter.size +
    contactIds.size +
    tagIds.size +
    (importantOnly ? 1 : 0) +
    (hasFinance ? 1 : 0) +
    (hasNotes ? 1 : 0);

  const clearFilters = () => {
    setCalFilter(new Set());
    setContactIds(new Set());
    setTagIds(new Set());
    setImportantOnly(false);
    setHasFinance(false);
    setHasNotes(false);
  };

  const toggleIn =
    (setter: React.Dispatch<React.SetStateAction<Set<string>>>) =>
    (id: string) => {
      setter((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    };
  const toggleCal = toggleIn(setCalFilter);
  const toggleContact = toggleIn(setContactIds);
  const toggleTag = toggleIn(setTagIds);

  const hasCriteria =
    debouncedQ.trim() || activeFilterCount > 0;

  // Esc：有輸入時先清空關鍵字，否則直接回行事曆——隨時輕鬆離開
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // 有開啟中的對話框（新增/編輯/詳情/命令面板）時，交給它自己關閉
      if (document.querySelector('[role="dialog"][data-state="open"]')) return;
      if (q) setQ("");
      else router.push("/calendar");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [q, router]);

  return (
    <div className={cn("mx-auto", hasRange ? "max-w-5xl" : "max-w-3xl")}>
      <PageHeader
        title="搜尋"
        description="跨行程、人物、標籤、回饋全文搜尋。"
        actions={
          <>
            <Button variant="outline" onClick={() => router.push("/calendar")}>
              <ArrowLeft className="size-4" />
              返回行事曆
            </Button>
            {canCreate && (
              <Button onClick={() => openCreate(taipeiTodayStr())}>
                <Plus className="size-4" />
                新增行程
              </Button>
            )}
          </>
        }
      />

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

        {/* 時間區間：外層直接可選——快速鍵＋自訂起訖日，設了就顯示該期間的空檔 */}
        <div className="space-y-2 rounded-xl border bg-card p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 inline-flex items-center gap-1 text-sm font-medium">
              <CalendarClock className="size-4 text-muted-foreground" />
              時間區間
            </span>
            {(
              [
                { key: "today", label: "今天" },
                { key: "week", label: "本週" },
                { key: "next7", label: "未來 7 天" },
              ] as const
            ).map((p) => {
              const iv = presetInterval(p.key);
              const active = startDate === iv.startDate && endDate === iv.endDate;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => {
                    setStartDate(iv.startDate);
                    setEndDate(iv.endDate);
                  }}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-sm transition",
                    active ? "border-primary bg-primary/10" : "hover:bg-accent",
                  )}
                >
                  {p.label}
                </button>
              );
            })}
            {(startDate || endDate) && (
              <button
                type="button"
                onClick={() => {
                  setStartDate("");
                  setEndDate("");
                }}
                className="ml-auto rounded-full px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                清除區間
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="date"
              value={startDate}
              max={endDate || undefined}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-9 w-40"
              aria-label="起始日"
            />
            <span className="text-muted-foreground">–</span>
            <Input
              type="date"
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-9 w-40"
              aria-label="結束日"
            />
          </div>
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

            {contacts.length > 0 && (
              <div>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                  人物{contactIds.size > 0 && `（需全部符合 · 已選 ${contactIds.size}）`}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {contacts.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleContact(c.id)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm",
                        contactIds.has(c.id)
                          ? "border-primary bg-primary/10"
                          : "hover:bg-accent",
                      )}
                    >
                      {c.name}
                      {c.role_label ? (
                        <span className="text-xs text-muted-foreground">
                          {c.role_label}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {tags.length > 0 && (
              <div>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                  標籤{tagIds.size > 0 && `（需全部符合 · 已選 ${tagIds.size}）`}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => toggleTag(t.id)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm",
                        tagIds.has(t.id)
                          ? "border-primary bg-primary/10"
                          : "hover:bg-accent",
                      )}
                    >
                      #{t.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

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
              <button
                type="button"
                onClick={() => setHasNotes((v) => !v)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-sm",
                  hasNotes ? "border-primary bg-primary/10" : "hover:bg-accent",
                )}
              >
                含回饋
              </button>
            </div>
          </div>
        )}

        {/* 這段期間的空檔（設定起訖日即顯示） */}
        {hasRange && (
          <div className="rounded-xl border bg-card p-3">
            <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
              <CalendarClock className="size-4 text-emerald-600" />
              這段期間的行事曆與空檔
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              {startDate} – {endDate}
              {canCreate ? "：點空白時段可直接新增、點行程可編輯；" : "："}
              綠色即可安排的空檔（點最長空檔可放大該日）。
            </p>
            {availLoading ? (
              <ListSkeleton rows={3} />
            ) : (
              <IntervalAvailabilityPanel
                startDate={startDate}
                endDate={endDate}
                events={availEvents}
                conflicts={availConflicts}
                colorOf={(id) => calendarById.get(id)?.color ?? "#64748B"}
                onSelect={setDetail}
                windowKey={availWindowKey}
                onWindowKeyChange={setAvailWindowKey}
                minGapKey={availMinGapKey}
                onMinGapKeyChange={setAvailMinGapKey}
                onFocusDay={(ds) => {
                  setStartDate(ds);
                  setEndDate(ds);
                }}
                onCreateAt={canCreate ? openCreate : undefined}
              />
            )}
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
                        {e.tagNames.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1 pl-2.5">
                            {e.tagNames.map((t) => (
                              <span
                                key={t}
                                className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                              >
                                #{t}
                              </span>
                            ))}
                          </div>
                        )}
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
        onEdit={() => {
          setEditing(detail);
          setDetail(null);
        }}
        onChanged={onSaved}
      />

      {/* 新增 */}
      <EventModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        defaultStartWall={createStart}
        onSaved={onSaved}
      />

      {/* 編輯 */}
      <EventModal
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        mode="edit"
        event={editing ?? undefined}
        onSaved={onSaved}
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
