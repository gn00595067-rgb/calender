"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { importWorkLogsAction } from "@/lib/actions/work";
import type { WorkCategory } from "@/lib/client/work";
import { matchCategory, parseWorkbook, type Cell, type ParseResult } from "@/lib/work-import";
import { taipeiTodayStr } from "@/lib/date";

const NONE = "__none__";

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${y}年${m}月`;
}

/**
 * 匯入工作報告 Excel：讀檔 → 預覽（月份、對不到的類別）→ 寫入。
 * 同一個月重新匯入會以新檔為準（先清掉該月舊紀錄）。
 */
export function WorkImportDialog({
  open,
  onOpenChange,
  contactId,
  contactName,
  categories,
  onImported,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contactId: string;
  contactName: string;
  categories: WorkCategory[];
  onImported: (months: string[]) => void;
}) {
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [reading, setReading] = useState(false);
  const [monthPick, setMonthPick] = useState<Set<string>>(new Set());
  /** 對不到的 Excel 類別 → 使用者選的分類 id（NONE＝不分類） */
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  function reset() {
    setParsed(null);
    setFileName("");
    setMonthPick(new Set());
    setMapping({});
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setReading(true);
    try {
      const { default: readXlsxFile } = await import("read-excel-file/browser");
      const sheets = await readXlsxFile(file);
      const today = taipeiTodayStr();
      const result = parseWorkbook(
        sheets.map((s) => ({ sheet: s.sheet, data: s.data as unknown as Cell[][] })),
        today,
      );
      if (!result) {
        toast.error("看不懂這個檔案：找不到有「日期」和「工作內容／類別」欄位的表頭");
        return;
      }
      setParsed(result);
      setFileName(file.name);
      // 預設勾近 3 個月（含本月）
      const [ty, tm] = today.split("-").map(Number);
      const from = new Date(Date.UTC(ty, tm - 3, 1)).toISOString().slice(0, 7);
      const months = [...new Set(result.rows.map((r) => r.workDate.slice(0, 7)))];
      setMonthPick(new Set(months.filter((m) => m >= from && m <= today.slice(0, 7))));
    } catch (e) {
      console.error(e);
      toast.error("讀取失敗：請確認是 .xlsx 檔（舊的 .xls 請先另存成 .xlsx）");
    } finally {
      setReading(false);
    }
  }

  const months = useMemo(() => {
    const m = new Map<string, { count: number; hours: number }>();
    for (const r of parsed?.rows ?? []) {
      const k = r.workDate.slice(0, 7);
      const cur = m.get(k) ?? { count: 0, hours: 0 };
      m.set(k, { count: cur.count + 1, hours: cur.hours + r.hours });
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [parsed]);

  const selectedRows = (parsed?.rows ?? []).filter((r) => monthPick.has(r.workDate.slice(0, 7)));
  // 對不到分類的 Excel 類別（只看勾選月份）
  const unmatched = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of selectedRows) {
      if (matchCategory(r.categoryRaw, categories)) continue;
      const k = r.categoryRaw || "（空白）";
      m.set(k, (m.get(k) ?? 0) + r.hours);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, monthPick, categories]);

  function submit() {
    if (!parsed || monthPick.size === 0) return;
    const rows = selectedRows.map((r) => {
      const auto = matchCategory(r.categoryRaw, categories);
      const mapped = mapping[r.categoryRaw || "（空白）"];
      return {
        workDate: r.workDate,
        startTime: r.startTime,
        endTime: r.endTime,
        hours: r.hours,
        content: r.content,
        categoryRaw: r.categoryRaw,
        categoryId: auto ?? (mapped && mapped !== NONE ? mapped : null),
      };
    });
    const aliasAdds = Object.entries(mapping)
      .filter(([raw, id]) => id !== NONE && raw !== "（空白）")
      .map(([alias, categoryId]) => ({ categoryId, alias }));
    startTransition(async () => {
      const res = await importWorkLogsAction({ contactId, months: [...monthPick], rows, aliasAdds });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        `已匯入 ${res.data.inserted} 筆${res.data.replaced ? `（取代原本 ${res.data.replaced} 筆）` : ""}`,
      );
      onImported([...monthPick].sort());
      reset();
      onOpenChange(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>匯入 {contactName} 的工作報告</DialogTitle>
          <DialogDescription>
            選 Excel（.xlsx）。需要有「日期」「工作內容」「類別」「開始時間」「結束時間」「工時」欄，順序不限；沒填工時會用開始／結束時間算。
          </DialogDescription>
        </DialogHeader>

        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-sm hover:bg-accent">
          {reading ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
          {fileName || "點這裡選擇 Excel 檔"}
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>

        {parsed && (
          <div className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              工作表「{parsed.sheetName}」讀到 {parsed.rows.length} 筆
              {parsed.skipped.length > 0 &&
                `，略過 ${parsed.skipped.length} 列（${parsed.skipped
                  .slice(0, 4)
                  .map((s) => `第 ${s.line} 列${s.reason}`)
                  .join("、")}${parsed.skipped.length > 4 ? "…" : ""}）`}
            </p>

            <div>
              <div className="mb-1.5 font-medium">要匯入的月份</div>
              <div className="space-y-1.5">
                {months.map(([m, info]) => (
                  <label key={m} className="flex items-center gap-2">
                    <Checkbox
                      checked={monthPick.has(m)}
                      onCheckedChange={(c) =>
                        setMonthPick((prev) => {
                          const next = new Set(prev);
                          if (c) next.add(m);
                          else next.delete(m);
                          return next;
                        })
                      }
                    />
                    {monthLabel(m)}
                    <span className="text-xs text-muted-foreground">
                      {info.count} 筆 · {Math.round(info.hours * 10) / 10} 小時
                    </span>
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                已經匯入過的月份會以這次的檔案為準（舊的那個月會被取代，不會重複）。
              </p>
            </div>

            {unmatched.length > 0 && (
              <div>
                <div className="mb-1.5 font-medium">這些類別要算哪一項？</div>
                <p className="mb-2 text-xs text-muted-foreground">
                  Excel 裡的類別寫法跟工作分類對不上。選了之後會記住，下次自動對應；選「不分類」就先不算錢，之後可在明細改。
                </p>
                <div className="space-y-2">
                  {unmatched.map(([raw, hours]) => (
                    <div key={raw} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate">
                        {raw}
                        <span className="ml-1 text-xs text-muted-foreground">
                          {Math.round(hours * 10) / 10} 小時
                        </span>
                      </span>
                      <select
                        className="h-9 w-40 rounded-md border bg-background px-2 text-sm"
                        value={mapping[raw] ?? NONE}
                        onChange={(e) => setMapping((m) => ({ ...m, [raw]: e.target.value }))}
                      >
                        <option value={NONE}>不分類</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}（{c.hourly_rate}）
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            取消
          </Button>
          <Button onClick={submit} disabled={!parsed || monthPick.size === 0 || pending}>
            {pending ? "匯入中…" : `匯入 ${selectedRows.length} 筆`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
