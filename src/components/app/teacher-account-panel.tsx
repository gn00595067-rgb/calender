"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Car, Copy, KeyRound, UserRoundCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createTeacherAccountAction,
  disableTeacherAccountAction,
  resetTeacherPasswordAction,
  teacherAccountEmailAction,
} from "@/lib/actions/teachers";
import {
  createDriverAccountAction,
  disableDriverAccountAction,
  driverAccountEmailAction,
  resetDriverPasswordAction,
} from "@/lib/actions/drivers";

/** 老師／司機帳號的動作與文字（建立流程相同，只有登入後看到的頁面不同） */
const KINDS = {
  teacher: {
    title: "老師帳號",
    hint: "老師自己登入寫回饋，只看得到自己的課、看不到費用",
    who: "老師",
    create: createTeacherAccountAction,
    reset: resetTeacherPasswordAction,
    disable: disableTeacherAccountAction,
    email: teacherAccountEmailAction,
    keepNote: "已停用，老師寫過的回饋會保留",
    message: (name: string, url: string, email: string, pw: string) =>
      `${name} 老師您好，這是 ExecCal 寫學習回饋的帳號：\n網址：${url}\n帳號：${email}\n密碼：${pw}\n登入後就會看到您的課，每堂課下面可以填回饋。`,
  },
  driver: {
    title: "司機帳號",
    hint: "司機自己登入看接送行程、填加班，送出後要你核准",
    who: "司機",
    create: createDriverAccountAction,
    reset: resetDriverPasswordAction,
    disable: disableDriverAccountAction,
    email: driverAccountEmailAction,
    keepNote: "已停用，加班紀錄會保留",
    message: (name: string, url: string, email: string, pw: string) =>
      `${name} 您好，這是 ExecCal 司機帳號：\n網址：${url}\n帳號：${email}\n密碼：${pw}\n登入後可以看接送行程；有加班請當天填寫，送出後等核准。`,
  },
} as const;

/**
 * 人物管理裡的「老師帳號」／「司機帳號」：建立／重設密碼／停用。
 * 密碼只在建立或重設當下顯示一次，請轉交給老師。
 * spec：docs/specs/老師自填回饋與缺回饋不付款.md
 */
export function TeacherAccountPanel({
  kind = "teacher",
  contactId,
  contactName,
  linked,
  onChanged,
}: {
  kind?: keyof typeof KINDS;
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
  const k = KINDS[kind];

  useEffect(() => {
    if (!linked) return;
    let alive = true;
    void k.email(contactId).then((r) => {
      if (alive && r.ok) setLinkedEmail(r.data.email);
    });
    return () => {
      alive = false;
    };
  }, [contactId, linked, k]);

  const loginUrl = typeof window === "undefined" ? "" : `${window.location.origin}/login`;
  const message = issued
    ? k.message(contactName, loginUrl, issued.email, issued.password)
    : "";

  const run = (fn: () => Promise<void>) => startTransition(fn);

  return (
    <div className="space-y-2 border-t pt-3">
      <div className="flex items-center gap-1.5 text-sm font-medium">
        {kind === "driver" ? <Car className="size-4" /> : <UserRoundCheck className="size-4" />}
        {k.title}
        <span className="text-xs font-normal text-muted-foreground">{k.hint}</span>
      </div>

      {issued ? (
        <div className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-2.5 text-sm">
          <div className="font-medium">帳號已就緒，密碼只顯示這一次，請現在轉交給{k.who}：</div>
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
            複製給{k.who}的訊息
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
                  const r = await k.reset(contactId);
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
                      const r = await k.disable(contactId);
                      if (!r.ok) return void toast.error(r.error);
                      toast.success(k.keepNote);
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
            <Label className="text-xs">{k.who}的 Email（選填，不填就自動產生一組帳號）</Label>
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
                const r = await k.create(contactId, email || null);
                if (!r.ok) return void toast.error(r.error);
                setIssued(r.data);
                onChanged();
              })
            }
          >
            {pending ? "建立中…" : `建立${k.title}`}
          </Button>
        </div>
      )}
    </div>
  );
}
