"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Trash2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveWorkSetupAction } from "@/lib/actions/work";
import type { WorkCategory } from "@/lib/client/work";

interface Draft {
  id?: string;
  name: string;
  sub_label: string;
  hourly_rate: string;
  aliases: string[];
}

/** Peggy 給 Phoenix 的 9 個大項與暫訂時薪（新的人可一鍵套用再改） */
const PRESET: Omit<Draft, "aliases">[] = [
  { name: "英文教學", sub_label: "英文教學", hourly_rate: "500" },
  { name: "複習.檢討", sub_label: "複習.檢討", hourly_rate: "500" },
  { name: "檢查作業", sub_label: "每天作業.閱讀", hourly_rate: "250" },
  { name: "專題輔導", sub_label: "青山time", hourly_rate: "500" },
  { name: "聯絡老師", sub_label: "課表/考券/收集反饋", hourly_rate: "250" },
  { name: "外出/陪上課", sub_label: "外出/陪上課", hourly_rate: "250" },
  { name: "阿姨國語教學", sub_label: "阿姨國語教學", hourly_rate: "250" },
  { name: "採購", sub_label: "網上/實體店", hourly_rate: "250" },
  { name: "行政/其他", sub_label: "回報進度.確認.家長溝通", hourly_rate: "250" },
];

/** 月薪＋工作分類（大項／小項／時薪）設定；別名＝匯入時記住的 Excel 類別寫法 */
export function WorkSetupDialog({
  open,
  onOpenChange,
  contactId,
  contactName,
  categories,
  monthlySalary,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contactId: string;
  contactName: string;
  categories: WorkCategory[];
  monthlySalary: number | null;
  onSaved: () => void;
}) {
  const toDrafts = () =>
    categories.map((c) => ({
      id: c.id,
      name: c.name,
      sub_label: c.sub_label ?? "",
      hourly_rate: String(c.hourly_rate),
      aliases: c.aliases,
    }));
  const [rows, setRows] = useState<Draft[]>(toDrafts);
  const [salary, setSalary] = useState(monthlySalary != null ? String(monthlySalary) : "");
  const [pending, startTransition] = useTransition();

  const set = (i: number, patch: Partial<Draft>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  function save() {
    startTransition(async () => {
      const res = await saveWorkSetupAction({
        contactId,
        monthlySalary: salary.trim() ? Math.round(Number(salary)) : null,
        categories: rows
          .filter((r) => r.name.trim())
          .map((r) => ({
            ...(r.id ? { id: r.id } : {}),
            name: r.name.trim(),
            sub_label: r.sub_label.trim() || null,
            hourly_rate: Math.max(0, Math.round(Number(r.hourly_rate) || 0)),
            aliases: r.aliases,
          })),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("已儲存");
      onSaved();
      onOpenChange(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setRows(toDrafts());
          setSalary(monthlySalary != null ? String(monthlySalary) : "");
        }
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{contactName} 的月薪與工作分類</DialogTitle>
          <DialogDescription>
            每個大項的暫訂時薪 × 當月時數＝工作價值，用來看有沒有達到月薪標準。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="ws-salary">月薪（NT$）</Label>
          <Input
            id="ws-salary"
            inputMode="numeric"
            value={salary}
            onChange={(e) => setSalary(e.target.value.replace(/[^\d]/g, ""))}
            placeholder="例：40000"
            className="w-40"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>工作分類</Label>
            {rows.length === 0 && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setRows(PRESET.map((p) => ({ ...p, aliases: [] })))}
              >
                套用預設 9 項
              </Button>
            )}
          </div>
          <div className="grid grid-cols-[1fr_1fr_5rem_2rem] gap-1.5 text-xs text-muted-foreground">
            <span>大項</span>
            <span>小項（說明）</span>
            <span>時薪</span>
            <span />
          </div>
          {rows.map((r, i) => (
            <div key={r.id ?? `new-${i}`} className="space-y-1">
              <div className="grid grid-cols-[1fr_1fr_5rem_2rem] items-center gap-1.5">
                <Input value={r.name} onChange={(e) => set(i, { name: e.target.value })} />
                <Input value={r.sub_label} onChange={(e) => set(i, { sub_label: e.target.value })} />
                <Input
                  inputMode="numeric"
                  value={r.hourly_rate}
                  onChange={(e) => set(i, { hourly_rate: e.target.value.replace(/[^\d]/g, "") })}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="刪除這個分類"
                  onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
              {r.aliases.length > 0 && (
                <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                  Excel 寫成這些也算：
                  {r.aliases.map((a) => (
                    <span key={a} className="inline-flex items-center gap-0.5 rounded-full bg-muted px-2 py-0.5">
                      {a}
                      <button
                        type="button"
                        aria-label={`移除 ${a}`}
                        onClick={() => set(i, { aliases: r.aliases.filter((x) => x !== a) })}
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setRows((rs) => [...rs, { name: "", sub_label: "", hourly_rate: "250", aliases: [] }])}
          >
            <Plus className="size-4" />
            新增分類
          </Button>
          <p className="text-xs text-muted-foreground">刪掉的分類，已匯入的紀錄會變成「未分類」。</p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            取消
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending ? "儲存中…" : "儲存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
