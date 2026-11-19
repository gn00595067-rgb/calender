"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  linkStaffAccountAction,
  staffAccountEmailAction,
  unlinkStaffAccountAction,
} from "@/lib/actions/staff-work";

/**
 * 員工帳號（家庭老師）：把人物連到登入帳號，對方就能在「我的工作」記工作紀錄、寫週報。
 * Email 已有帳號（例如已分享行事曆給她）就直接連；沒有就建一個，密碼只顯示一次。
 * spec：docs/specs/Elsa需求-多人權限與家庭老師報告.md
 */
export function StaffAccountPanel({
  contactId,
  contactName,
  linked,
  onChanged,
}: {
  contactId: string;
  contactName: string;
  linked: boolean;
  onChanged: () => void;
}) {
  const [email, setEmail] = useState("");
  const [linkedEmail, setLinkedEmail] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ email: string; password: string } | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!linked) return;
    let alive = true;
    void staffAccountEmailAction(contactId).then((r) => {
      if (alive && r.ok) setLinkedEmail(r.data.email);
    });
    return () => {
      alive = false;
    };
  }, [linked, contactId]);

  function link() {
    startTransition(async () => {
      const res = await linkStaffAccountAction(contactId, email);
      if (!res.ok) return void toast.error(res.error);
      setLinkedEmail(res.data.email);
      if (res.data.password) setIssued({ email: res.data.email, password: res.data.password });
      toast.success("已連結");
      onChanged();
    });
  }

  function unlink() {
    startTransition(async () => {
      const res = await unlinkStaffAccountAction(contactId);
      if (!res.ok) return void toast.error(res.error);
      setLinkedEmail(null);
      toast.success("已取消連結，記過的工作紀錄會保留");
      onChanged();
    });
  }

  const url = typeof window !== "undefined" ? window.location.origin : "";
  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-medium">員工帳號（記工作紀錄、寫週報）</p>
        <p className="text-xs text-muted-foreground">
          家庭老師登入後在「我的工作」記每段時間做了什麼、寫週報；看不到時薪與月薪。
        </p>
      </div>
      {linked || linkedEmail ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>已連結：{linkedEmail ?? "…"}</span>
          <Button size="sm" variant="ghost" className="text-destructive" disabled={pending} onClick={unlink}>
            取消連結
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1 space-y-1">
            <Label className="text-xs">對方登入用的 Email</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="例：phoenix@gmail.com" />
          </div>
          <Button size="sm" disabled={pending || !email.trim()} onClick={link}>
            連結
          </Button>
        </div>
      )}
      {issued && (
        <div className="space-y-1 rounded-md bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <p>已建立新帳號，密碼只顯示這一次：</p>
          <p className="font-mono">
            {issued.email}／{issued.password}
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void navigator.clipboard.writeText(
                `${contactName} 您好，這是 ExecCal 帳號：\n網址：${url}\n帳號：${issued.email}\n密碼：${issued.password}\n登入後在左側選單「我的工作」記工作紀錄、寫週報。`,
              );
              toast.success("已複製，可以貼到 LINE");
            }}
          >
            <Copy className="size-3.5" />
            複製給對方
          </Button>
        </div>
      )}
    </div>
  );
}
