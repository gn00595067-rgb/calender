"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Upload, Link2, Users, Tag, Repeat, CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAppData } from "@/components/app/app-data";
import { can } from "@/lib/permissions";
import { D } from "@/lib/date";
import {
  previewIcsImportAction,
  commitIcsImportAction,
  type ImportPreview,
} from "@/lib/actions/import";

function firstOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ImportPage() {
  const { calendars } = useAppData();
  const editable = calendars.filter((c) => can.editEvents(c.effectiveRole));
  const router = useRouter();
  const qc = useQueryClient();

  const [icsText, setIcsText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [icsUrl, setIcsUrl] = useState("");
  const [startDate, setStartDate] = useState(firstOfMonth());
  const [endDate, setEndDate] = useState(today());
  const [calendarId, setCalendarId] = useState(editable[0]?.id ?? "");
  const [createContacts, setCreateContacts] = useState(true);
  const [autoTags, setAutoTags] = useState(true);

  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const newContacts = useMemo(
    () => preview?.attendees.filter((a) => a.isNew).length ?? 0,
    [preview],
  );

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    setIcsText(text);
    setFileName(file.name);
    setIcsUrl("");
    setPreview(null);
  };

  const doPreview = () => {
    if (!icsText.trim() && !icsUrl.trim()) {
      toast.error("請先上傳 .ics 檔或貼上私人網址");
      return;
    }
    startTransition(async () => {
      const res = await previewIcsImportAction({
        icsText: icsText.trim() || undefined,
        icsUrl: icsUrl.trim() || undefined,
        startDate,
        endDate,
      });
      if (!res.ok) {
        toast.error(res.error);
        setPreview(null);
        return;
      }
      setPreview(res.data);
    });
  };

  const doImport = () => {
    if (!preview || !calendarId) return;
    startTransition(async () => {
      const res = await commitIcsImportAction({
        calendarId,
        createContacts,
        autoTags,
        events: preview.events,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const r = res.data;
      toast.success(
        `匯入完成：新增 ${r.inserted} 筆行程` +
          (r.skipped ? `、略過重複 ${r.skipped} 筆` : "") +
          (r.contactsCreated ? `、新增人物 ${r.contactsCreated} 位` : ""),
      );
      await qc.invalidateQueries();
      setPreview(null);
      setIcsText("");
      setFileName(null);
      router.push("/calendar");
    });
  };

  if (editable.length === 0) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="匯入 Google 行事曆" />
        <p className="text-sm text-muted-foreground">你沒有可寫入的分類。</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="匯入 Google 行事曆"
        description="上傳 .ics 檔或貼上私人 iCal 網址，把某段區間的行程匯入，並自動轉換人物與標籤。"
      />

      {/* 教學 */}
      <details className="mb-4 rounded-xl border bg-muted/30 p-3 text-sm">
        <summary className="cursor-pointer font-medium">如何從 Google 行事曆取得 .ics？</summary>
        <div className="mt-2 space-y-2 text-muted-foreground">
          <p>
            <strong className="text-foreground">方式一（檔案）</strong>：電腦版 Google 行事曆 →
            右上齒輪「設定」→ 左側「匯入及匯出」→「匯出」下載 zip，解壓縮後得到每個日曆的 .ics
            檔，於下方上傳。
          </p>
          <p>
            <strong className="text-foreground">方式二（網址）</strong>：設定 → 點選要匯入的日曆 →
            「整合日曆」→ 複製「iCal 格式的私人網址」貼到下方。
          </p>
        </div>
      </details>

      {/* 來源 */}
      <div className="space-y-4 rounded-xl border bg-card p-4">
        <div>
          <Label className="mb-1.5 flex items-center gap-1.5">
            <Upload className="size-4" />
            上傳 .ics 檔
          </Label>
          <input
            ref={fileRef}
            type="file"
            accept=".ics,text/calendar"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              選擇檔案
            </Button>
            <span className="truncate text-sm text-muted-foreground">
              {fileName ?? "尚未選擇檔案"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Separator className="flex-1" />
          或
          <Separator className="flex-1" />
        </div>

        <div>
          <Label htmlFor="ics-url" className="mb-1.5 flex items-center gap-1.5">
            <Link2 className="size-4" />
            私人 iCal 網址
          </Label>
          <Textarea
            id="ics-url"
            value={icsUrl}
            onChange={(e) => {
              setIcsUrl(e.target.value);
              if (e.target.value.trim()) {
                setIcsText("");
                setFileName(null);
              }
              setPreview(null);
            }}
            placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
            rows={2}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="imp-start" className="mb-1.5 block">
              匯入起始日
            </Label>
            <Input
              id="imp-start"
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setPreview(null);
              }}
            />
          </div>
          <div>
            <Label htmlFor="imp-end" className="mb-1.5 block">
              匯入結束日
            </Label>
            <Input
              id="imp-end"
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setPreview(null);
              }}
            />
          </div>
        </div>

        <Button onClick={doPreview} disabled={pending} className="w-full">
          {pending && !preview ? "解析中…" : "預覽將匯入的行程"}
        </Button>
      </div>

      {/* 預覽 + 設定 + 匯入 */}
      {preview && (
        <div className="mt-4 space-y-4 rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="text-sm">{preview.total} 筆行程</Badge>
            {preview.recurringCount > 0 && (
              <Badge variant="secondary" className="gap-1">
                <Repeat className="size-3" />
                含 {preview.recurringCount} 筆重複展開
              </Badge>
            )}
            {createContacts && (
              <Badge variant="secondary" className="gap-1">
                <Users className="size-3" />
                {preview.attendees.length} 位人物（{newContacts} 位新增）
              </Badge>
            )}
            {preview.truncated && (
              <Badge variant="outline" className="text-amber-600">
                已達上限 1500 筆，已截斷
              </Badge>
            )}
          </div>

          {/* 目標與選項 */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="mb-1.5 block">匯入到分類</Label>
              <Select value={calendarId} onValueChange={setCalendarId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="選擇分類" />
                </SelectTrigger>
                <SelectContent>
                  {editable.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <span className="flex items-center gap-2">
                        <span className="size-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                        {c.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="flex items-center justify-between rounded-lg border p-2.5 text-sm">
                <span className="flex items-center gap-1.5">
                  <Users className="size-4" />
                  與會者建立人物
                </span>
                <Switch checked={createContacts} onCheckedChange={setCreateContacts} />
              </label>
              <label className="flex items-center justify-between rounded-lg border p-2.5 text-sm">
                <span className="flex items-center gap-1.5">
                  <Tag className="size-4" />
                  依關鍵字自動貼標籤
                </span>
                <Switch checked={autoTags} onCheckedChange={setAutoTags} />
              </label>
            </div>
          </div>

          {/* 行程樣本 */}
          <div>
            <div className="mb-1.5 text-sm font-medium text-muted-foreground">
              預覽（前 12 筆）
            </div>
            <ul className="max-h-64 space-y-1 overflow-y-auto rounded-lg border p-2">
              {preview.events.slice(0, 12).map((e, i) => (
                <li key={i} className="flex items-center gap-2 text-sm">
                  <span className="w-28 shrink-0 tabular-nums text-muted-foreground">
                    {e.allDay ? D.date(e.startIso) : D.full(e.startIso).slice(5, 16)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{e.title}</span>
                  {e.recurring && <Repeat className="size-3 shrink-0 text-muted-foreground" />}
                </li>
              ))}
              {preview.total > 12 && (
                <li className="px-1 pt-1 text-xs text-muted-foreground">
                  …還有 {preview.total - 12} 筆
                </li>
              )}
            </ul>
          </div>

          <Button onClick={doImport} disabled={pending || !calendarId} className="w-full">
            <CheckCircle2 className="size-4" />
            {pending ? "匯入中…" : `確認匯入 ${preview.total} 筆到「${editable.find((c) => c.id === calendarId)?.name ?? ""}」`}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            重複匯入相同行程會自動略過（以來源識別碼去重）。
          </p>
        </div>
      )}
    </div>
  );
}
