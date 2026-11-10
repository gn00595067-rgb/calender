"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getHabitsAction, saveHabitsAction } from "@/lib/actions/profile";

const EXAMPLE = `做臉 2 小時
和朋友吃飯 1.5 小時
開會預設在公司`;

/**
 * 使用習慣：自己寫「做什麼通常多久、在哪」，語音新增時沒講就照這裡排。
 * spec：docs/specs/測試回饋第四輪-月曆連續捲動與語音人名.md §三
 */
export default function HabitsPage() {
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [missing, setMissing] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let alive = true;
    getHabitsAction().then((res) => {
      if (!alive) return;
      if (res.ok) {
        if (res.data === null) setMissing(true);
        else setText(res.data);
      } else toast.error(res.error);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const save = () =>
    startTransition(async () => {
      const res = await saveHabitsAction(text);
      if (res.ok) toast.success("已儲存，下次用語音新增就會照這些習慣排");
      else toast.error(res.error);
    });

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="使用習慣"
        description="寫下做什麼通常要多久、在哪裡。用語音新增時沒講清楚，就照這裡的習慣排。"
      />
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">一行寫一條，用自己的話寫就可以，例如：</p>
        <pre className="rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap">{EXAMPLE}</pre>
        <Textarea
          id="habits-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={EXAMPLE}
          rows={10}
          disabled={!loaded || missing}
          className="text-base"
        />
        {missing && (
          <p className="text-sm text-destructive">資料庫還沒更新（0026），暫時不能儲存。</p>
        )}
        <p className="text-xs text-muted-foreground">
          說「明天下午三點做臉」沒講多久 → 會排 15:00–17:00。自己說了多久的，以說的為準。
        </p>
        <Button onClick={save} disabled={!loaded || missing || pending}>
          {pending ? "儲存中…" : "儲存"}
        </Button>
      </div>
    </div>
  );
}
