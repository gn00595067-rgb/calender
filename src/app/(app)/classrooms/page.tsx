"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, School, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState, ListSkeleton } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppData } from "@/components/app/app-data";
import { useMyStaffLinks } from "@/lib/client/staff";
import { useClassrooms, type Classroom } from "@/lib/client/classrooms";
import { createClient } from "@/lib/supabase/client";

/**
 * 教室資料庫（Elsa 11/19 需求 5）：小孩在外面上的課每間一張卡，把散在各處的規則集中。
 * 家庭老師可以先填他知道的，Elsa／Peggy 再補。
 * spec：docs/specs/Elsa需求-多人權限與家庭老師報告.md
 */

const FIELDS: { key: keyof Pick<Classroom, "makeup_rules" | "term_rules" | "fee" | "contact" | "address" | "note">; label: string; hint: string; long?: boolean }[] = [
  { key: "makeup_rules", label: "補課規則", hint: "怎麼補、要提前多久請假、可補幾次", long: true },
  { key: "term_rules", label: "課程使用期限", hint: "買的堂數多久內要用完、到期日", long: true },
  { key: "fee", label: "費用", hint: "例：10 堂 12,000，月繳" },
  { key: "contact", label: "聯絡人／電話", hint: "例：王老師 0912-345-678、LINE 群組" },
  { key: "address", label: "地點", hint: "地址或教室名稱" },
  { key: "note", label: "其他", hint: "上課要帶的東西、停車、注意事項…", long: true },
];

type Draft = Omit<Classroom, "id" | "owner_id" | "updated_by" | "updated_at" | "created_at"> & { id?: string };
const EMPTY: Draft = { name: "", makeup_rules: "", term_rules: "", fee: "", contact: "", address: "", note: "" };

export default function ClassroomsPage() {
  const { me, calendars } = useAppData();
  const qc = useQueryClient();
  const links = useMyStaffLinks();
  // 家長自己；家庭老師看被分享分類的擁有者（或員工帳號的家長）
  const ownerId =
    (calendars.some((c) => c.isOwned) ? me.id : null) ??
    calendars.find((c) => !c.isOwned)?.owner_id ??
    links.data?.[0]?.owner_id ??
    null;
  const list = useClassrooms(ownerId);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, startTransition] = useTransition();
  const refresh = () => qc.invalidateQueries({ queryKey: ["classrooms"] });

  function save() {
    if (!draft || !ownerId) return;
    if (!draft.name.trim()) return void toast.error("請填教室／課程名稱");
    startTransition(async () => {
      const sb = createClient();
      const { id, ...fields } = draft;
      const row = { ...fields, name: fields.name.trim(), updated_by: me.id, updated_at: new Date().toISOString() };
      const { error } = id
        ? await sb.from("classrooms").update(row).eq("id", id)
        : await sb.from("classrooms").insert({ ...row, owner_id: ownerId });
      if (error) return void toast.error(error.message);
      toast.success("已儲存");
      setDraft(null);
      refresh();
    });
  }

  function remove(c: Classroom) {
    startTransition(async () => {
      const { error } = await createClient().from("classrooms").delete().eq("id", c.id);
      if (error) return void toast.error(error.message);
      toast.success(`已刪除「${c.name}」`);
      setDraft(null);
      refresh();
    });
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="教室資料"
        description="小孩在外面上的課，每間一張卡：補課規則、使用期限、聯絡方式。行程標題或地點有教室名稱時，點開行程就看得到。"
        actions={
          ownerId ? (
            <Button onClick={() => setDraft({ ...EMPTY })}>
              <Plus className="size-4" />
              新增教室
            </Button>
          ) : undefined
        }
      />
      {list.isLoading ? (
        <ListSkeleton rows={4} />
      ) : list.data === null ? (
        <EmptyState icon={School} title="資料庫還沒更新" description="請先在 Supabase SQL Editor 套用 0033_classrooms.sql。" />
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState icon={School} title="還沒有教室" description="例：作文教室、英文辯論課。家庭老師可以先填知道的，再由家長補充。" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {(list.data ?? []).map((c) => (
            <section key={c.id} className="space-y-2 rounded-xl border bg-card p-3 text-sm">
              <div className="flex items-center gap-2">
                <School className="size-4 text-muted-foreground" />
                <h2 className="font-bold">{c.name}</h2>
                <Button
                  size="icon"
                  variant="ghost"
                  className="ml-auto size-7"
                  aria-label="修改"
                  onClick={() => setDraft({ ...c })}
                >
                  <Pencil className="size-3.5" />
                </Button>
              </div>
              {FIELDS.filter((f) => c[f.key]?.trim()).map((f) => (
                <div key={f.key}>
                  <div className="text-xs text-muted-foreground">{f.label}</div>
                  <p className="whitespace-pre-wrap">{c[f.key]}</p>
                </div>
              ))}
              {FIELDS.every((f) => !c[f.key]?.trim()) && <p className="text-muted-foreground">還沒填內容</p>}
            </section>
          ))}
        </div>
      )}

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "修改教室" : "新增教室"}</DialogTitle>
            <DialogDescription>知道多少填多少，之後可以再補。</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="cr-name">教室／課程名稱</Label>
                <Input
                  id="cr-name"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="例：作文教室（跟行程標題用一樣的字，點行程才對得到）"
                />
              </div>
              {FIELDS.map((f) => (
                <div key={f.key} className="space-y-1">
                  <Label className="text-sm">{f.label}</Label>
                  {f.long ? (
                    <Textarea
                      rows={3}
                      value={draft[f.key]}
                      onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                      placeholder={f.hint}
                    />
                  ) : (
                    <Input
                      value={draft[f.key]}
                      onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                      placeholder={f.hint}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            {draft?.id && (
              <Button
                variant="ghost"
                className="mr-auto text-destructive"
                disabled={pending}
                onClick={() => {
                  const c = list.data?.find((x) => x.id === draft.id);
                  if (c && window.confirm(`確定刪除「${c.name}」？`)) remove(c);
                }}
              >
                <Trash2 className="size-4" />
                刪除
              </Button>
            )}
            <Button variant="outline" onClick={() => setDraft(null)}>
              取消
            </Button>
            <Button onClick={save} disabled={pending}>
              儲存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
