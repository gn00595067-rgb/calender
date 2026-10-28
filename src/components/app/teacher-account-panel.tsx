"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Copy, KeyRound, UserRoundCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createTeacherAccountAction,
  disableTeacherAccountAction,
  resetTeacherPasswordAction,
  teacherAccountEmailAction,
} from "@/lib/actions/teachers";

/**
 * 人物管理裡的「老師帳號」：建立／重設密碼／停用。
 * 密碼只在建立或重設當下顯示一次，請轉交給老師。
 * spec：docs/specs/老師自填回饋與缺回饋不付款.md
 */
export function TeacherAccountPanel({
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
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!linked) return;
    let alive = true;
    void teacherAccountEmailAction(contactId).then((r) => {
      if (alive && r.ok) setLinkedEmail(r.data.email);
    });
    return () => {
      alive = false;
    };
  }, [contactId, linked]);

  const loginUrl = typeof window === "undefined" ? "" : `${window.location.origin}/login`;
  const message = issued
    ? `${contactName} 老師您好，這是 ExecCal 寫學習回饋的帳號：\n網址：${loginUrl}\n帳號：${issued.email}\n密碼：${issued.password}\n登入後就會看到您的課，每堂課下面可以填回饋。`
    : "";

  const run = (fn: () => Promise<void>) => startTransition(fn);

  return (
    <div className="space-y-2 border-t pt-3">
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <UserRoundCheck className="size-4" />
        老師帳號
        <span className="text-xs font-normal text-muted-foreground">
          老師自己登入寫回饋，只看得到自己的課、看不到費用
        </span>
      </div>

      {issued ? (
        <div className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-2.5 text-sm">
          <div className="font-medium">帳號已就緒，密碼只顯示這一次，請現在轉交給老師：</div>
          <pre className="whitespace-pre-wrap rounded bg-background p-2 text-xs">{message}</pre>
          <Button
            type="button"
            size="sm"
            onClick={() =>
              void navigator.clipboard
                .writeText(message)
                .then(() => toast.success("已複製，可以直接貼到 LINE"))
                .catch(() => toast.error("複製失敗，請手動選取"))
            }
          >
            <Copy className="size-4" />
            複製給老師的訊息
          </Button>
        </div>
      ) : null}

      {linked ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            已建立帳號{linkedEmail ? `：${linkedEmail}` : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const r = await resetTeacherPasswordAction(contactId);
                  if (!r.ok) return void toast.error(r.error);
                  setIssued(r.data);
                })
              }
            >
              <KeyRound className="size-4" />
              重設密碼
            </Button>
            {confirmDisable ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  className="bg-destructive text-white hover:bg-destructive/90"
                  disabled={pending}
                  onClick={() =>
                    run(async () => {
                      const r = await disableTeacherAccountAction(contactId);
                      if (!r.ok) return void toast.error(r.error);
                      toast.success("已停用，老師寫過的回饋會保留");
                      setConfirmDisable(false);
                      setIssued(null);
                      onChanged();
                    })
                  }
                >
                  確定停用
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmDisable(false)}>
                  取消
                </Button>
              </>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => setConfirmDisable(true)}
              >
                停用帳號
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="space-y-1.5">
            <Label className="text-xs">老師的 Email（選填，不填就自動產生一組帳號）</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="例：jack@gmail.com"
            />
          </div>
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() =>
              run(async () => {
                const r = await createTeacherAccountAction(contactId, email || null);
                if (!r.ok) return void toast.error(r.error);
                setIssued(r.data);
                onChanged();
              })
            }
          >
            {pending ? "建立中…" : "建立老師帳號"}
          </Button>
        </div>
      )}
    </div>
  );
}
