"use client";

import { useState } from "react";
import { Mic } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useSpeech } from "@/lib/voice/use-speech";

/**
 * 語音輸入麥克風鈕。按一下開始聆聽、再按一下停止；辨識中會脈動閃爍。
 *
 * - `onInterim`：即時把（含中間結果的）文字回填到輸入框。
 * - `onFinal`：一段辨識完成的最終文字。
 * - 若瀏覽器不支援 Web Speech（如部分 iPad Safari），且未指定 `keepWhenUnsupported`，
 *   會直接不顯示——因為 iOS 鍵盤本身就有內建麥克風可聽寫。
 */
export function MicButton({
  onInterim,
  onFinal,
  title = "語音輸入",
  className,
  keepWhenUnsupported = false,
}: {
  onInterim?: (text: string) => void;
  onFinal?: (text: string) => void;
  title?: string;
  className?: string;
  keepWhenUnsupported?: boolean;
}) {
  const [errored, setErrored] = useState(false);
  const { supported, listening, start, stop } = useSpeech({
    onInterim,
    onFinal,
    onError: (code) => {
      setErrored(true);
      if (code === "not-allowed" || code === "service-not-allowed") {
        toast.error("麥克風被拒絕，請在瀏覽器允許麥克風權限");
      } else if (code === "no-speech") {
        toast.message("沒有聽到聲音，請再試一次");
      } else if (code === "unsupported") {
        toast.message("此瀏覽器不支援語音，請改用鍵盤上的麥克風聽寫");
      }
    },
  });

  if (!supported && !keepWhenUnsupported) return null;

  const disabled = !supported;

  return (
    <button
      type="button"
      title={disabled ? "此瀏覽器不支援語音輸入" : title}
      aria-label={title}
      aria-pressed={listening}
      disabled={disabled}
      onClick={() => {
        setErrored(false);
        if (listening) stop();
        else start();
      }}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-40",
        listening && "bg-red-500/10 text-red-600 animate-pulse",
        errored && !listening && "text-amber-600",
        className,
      )}
    >
      <Mic className="size-4" />
    </button>
  );
}
