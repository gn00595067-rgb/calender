"use client";

import { useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Hash, Pencil, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState, ListSkeleton } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAppData } from "@/components/app/app-data";
import { renameTagAction, deleteTagAction } from "@/lib/actions/tags";

interface TagRow {
  id: string;
  name: string;
  /** 掛了這個標籤的行程數 */
  count: number;
}

/** 我自己的標籤＋使用次數（分享進來的別人標籤不在這裡管理） */
function useMyTags(ownerId: string) {
  return useQuery({
    queryKey: ["tags", "manage", ownerId],
    queryFn: async (): Promise<TagRow[]> => {
      const supabase = createClient();
      const { data: tags, error } = await supabase
        .from("tags")
        .select("id, name")
        .eq("owner_id", ownerId)
        .order("name");
      if (error) throw new Error(error.message);
      const ids = (tags ?? []).map((t) => t.id);
      const counts = new Map<string, number>();
      if (ids.length) {
        const { data: links } = await supabase
          .from("event_tags")
          .select("tag_id")
          .in("tag_id", ids);
        for (const l of links ?? []) counts.set(l.tag_id, (counts.get(l.tag_id) ?? 0) + 1);
      }
      return (tags ?? [])
        .map((t) => ({ ...t, count: counts.get(t.id) ?? 0 }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    },
  });
}

export default function TagsSettingsPage() {
  const { me } = useAppData();
  const { data: tags = [], isLoading } = useMyTags(me.id);
  const qc = useQueryClient();
  const [editing, setEditing] = useState<TagRow | null>(null);
  const [newName, setNewName] = useState("");
  const [deleting, setDeleting] = useState<TagRow | null>(null);
  const [pending, startTransition] = useTransition();

  const refresh = () => qc.invalidateQueries({ queryKey: ["tags"] });
  const mergeTarget =
    editing && tags.find((t) => t.id !== editing.id && t.name === newName.trim());

  const rename = () => {
    if (!editing) return;
    const target = editing;
    startTransition(async () => {
      const res = await renameTagAction(target.id, newName);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.data.merged ? `已合併到「${newName.trim()}」` : "已改名");
      setEditing(null);
      refresh();
    });
  };

  const remove = () => {
    if (!deleting) return;
    const target = deleting;
    startTransition(async () => {
      const res = await deleteTagAction(target.id);
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(`已刪除「${target.name}」`);
        refresh();
      }
      setDeleting(null);
    });
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="標籤管理"
        description="標籤用在：報表「依標籤」統計次數與花費、搜尋頁篩選、語音新增時自動判斷。新標籤在新增行程時直接輸入即可建立。"
      />

      {isLoading ? (
        <ListSkeleton rows={5} />
      ) : tags.length === 0 ? (
        <EmptyState
          icon={Hash}
          title="還沒有標籤"
          description="在新增行程的「標籤」欄輸入名稱即可建立，例如：運動、才藝、看診。"
        />
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {tags.map((t) => (
            <li key={t.id} className="flex items-center gap-3 p-3">
              <span className="min-w-0 flex-1 truncate font-medium">#{t.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {t.count > 0 ? `${t.count} 筆行程` : "未使用"}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() => {
                  setEditing(t);
                  setNewName(t.name);
                }}
                aria-label="改名或合併"
              >
                <Pencil className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-destructive hover:text-destructive"
                onClick={() => setDeleting(t)}
                aria-label="刪除"
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        小技巧：把標籤改成另一個已存在的名稱，就會把兩個標籤合併（例如「健身」改成「運動」）。
      </p>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>改名「{editing?.name}」</DialogTitle>
            <DialogDescription>
              所有掛這個標籤的行程（{editing?.count ?? 0} 筆）都會跟著更新。
            </DialogDescription>
          </DialogHeader>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newName.trim()) rename();
            }}
            autoFocus
          />
          {mergeTarget && (
            <p className="text-xs text-amber-600">
              「{mergeTarget.name}」已存在：會把這 {editing?.count ?? 0} 筆行程合併過去，並刪除「
              {editing?.name}」。
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={pending}>
              取消
            </Button>
            <Button
              onClick={rename}
              disabled={pending || !newName.trim() || newName.trim() === editing?.name}
            >
              {mergeTarget ? "合併" : "改名"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>刪除標籤「{deleting?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.count
                ? `會從 ${deleting.count} 筆行程上拿掉這個標籤，行程本身不會被刪除。`
                : "這個標籤目前沒有行程使用。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={remove}
              disabled={pending}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              確定刪除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
