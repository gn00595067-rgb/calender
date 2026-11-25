"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 瀏覽器語音辨識（Web Speech API）封裝。
 *
 * - 桌面 Chrome / Edge 支援最完整；iPad Safari 支援不穩定，unsupported 時
 *   `supported` 會是 false，呼叫端應改走「鍵盤內建麥克風聽寫」的降級路徑。
 * - 只做「語音→文字」，不做任何語意解析。
 */

// Web Speech API 在 TS 沒有內建型別，這裡宣告會用到的最小介面。
interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternativeLike;
  isFinal: boolean;
  length: number;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}
interface SpeechRecognitionErrorEventLike {
  error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface UseSpeechOptions {
  /** 辨識語言，預設繁中。 */
  lang?: string;
  /** 收到（可能是中間結果的）文字時觸發；文字是這次收音累積的全部內容。 */
  onInterim?: (text: string) => void;
  /** 收音結束時觸發一次，帶累積的全部文字。 */
  onFinal?: (text: string) => void;
  /** 發生錯誤時觸發（例如未授權麥克風）；自動接續時的「沒聽到聲音」不算。 */
  onError?: (code: string) => void;
  /** 停多久沒講話才結束（毫秒），預設 3000。 */
  silenceMs?: number;
}

export interface UseSpeechResult {
  /** 此瀏覽器是否支援 Web Speech API。 */
  supported: boolean;
  /** 是否正在聆聽。 */
  listening: boolean;
  /** 開始聆聽；prefix＝已有的文字，接著往後加（補充用）。 */
  start: (prefix?: string) => void;
  /** 停止聆聽（會觸發最終結果）。 */
  stop: () => void;
  /** 放棄這次收音：立即關麥克風，不觸發 onFinal（取消用）。 */
  cancel: () => void;
}

/** 最長收音時間：避免忘了關一直聽 */
const MAX_MS = 90_000;
/** 開始後多久都沒講話就結束（要給人開口的時間，比 silenceMs 長） */
const FIRST_SPEECH_MS = 8000;
/**
 * 呼叫 stop() 後等瀏覽器 onend 的上限。iPad Safari 常常 stop 後不回 onend，
 * 會一直卡在「正在聽」，超過這時間就自己收尾。
 */
const STOP_GRACE_MS = 1200;

/** 兩段之間補標點：前一段沒標點結尾才加「，」 */
function joinText(base: string, add: string): string {
  if (!base) return add;
  if (!add) return base;
  return /[，。,.!?！？、\s]$/.test(base) ? base + add : `${base}，${add}`;
}

/**
 * 手機（尤其 Android Chrome）一停頓就結束辨識，句子常被切掉；
 * 這裡在瀏覽器結束一段後自動接續下一段、把文字累加，
 * 直到使用者按停止、停頓超過 silenceMs、或連兩段都沒聽到聲音才結束。
 */
export function useSpeech(options: UseSpeechOptions = {}): UseSpeechResult {
  const { lang = "zh-TW", onInterim, onFinal, onError, silenceMs = 3000 } = options;
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  /** 這次收音的狀態；null＝沒在聽 */
  const sessRef = useRef<{
    base: string;
    active: boolean;
    startedAt: number;
    emptyRuns: number;
    silenceTimer: ReturnType<typeof setTimeout> | null;
    /** 強制收尾（不等瀏覽器 onend）；帶 false＝不送出結果 */
    finish: (emit?: boolean) => void;
  } | null>(null);

  // 用 ref 保存最新 callback，避免每次 render 重建辨識器。
  const cbRef = useRef({ onInterim, onFinal, onError });
  useEffect(() => {
    cbRef.current = { onInterim, onFinal, onError };
  });

  useEffect(() => {
    // 掛載時偵測瀏覽器能力一次（與外部平台 API 同步的合法情境）。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupported(getRecognitionCtor() != null);
  }, []);

  /** 請瀏覽器停止；等不到 onend 就自己收尾 */
  const stopSession = useCallback(() => {
    const sess = sessRef.current;
    if (!sess) return;
    sess.active = false;
    if (sess.silenceTimer) clearTimeout(sess.silenceTimer);
    sess.silenceTimer = setTimeout(() => sess.finish(), STOP_GRACE_MS);
    try {
      recRef.current?.stop();
    } catch {
      sess.finish();
    }
  }, []);

  const stop = stopSession;

  const cancel = useCallback(() => {
    const sess = sessRef.current;
    if (sess) sess.finish(false);
    else setListening(false);
  }, []);

  const start = useCallback(
    (prefix = "") => {
      const Ctor = getRecognitionCtor();
      if (!Ctor) {
        cbRef.current.onError?.("unsupported");
        return;
      }
      // 若已有進行中的收音，先放棄（不送出）。
      sessRef.current?.finish(false);

      /** 目前這段還沒併進 base 的文字（強制收尾時一併收下） */
      let pending = "";
      const finish = (emit = true) => {
        if (sessRef.current !== sess) return;
        if (sess.silenceTimer) clearTimeout(sess.silenceTimer);
        sessRef.current = null;
        const rec = recRef.current;
        recRef.current = null;
        if (rec) {
          rec.onresult = null;
          rec.onerror = null;
          rec.onend = null;
          try {
            rec.abort();
          } catch {
            /* ignore */
          }
        }
        setListening(false);
        const text = joinText(sess.base, pending.trim());
        if (emit && text) cbRef.current.onFinal?.(text);
      };
      const sess = {
        base: prefix.trim(),
        active: true,
        startedAt: Date.now(),
        emptyRuns: 0,
        silenceTimer: null as ReturnType<typeof setTimeout> | null,
        finish,
      };
      sessRef.current = sess;

      /** 講話中一直重設；停頓超過 ms 就結束 */
      const armSilence = (ms = silenceMs) => {
        if (sess.silenceTimer) clearTimeout(sess.silenceTimer);
        sess.silenceTimer = setTimeout(() => {
          if (sessRef.current === sess) stopSession();
        }, ms);
      };

      const run = () => {
        const rec = new Ctor();
        rec.lang = lang;
        rec.continuous = false;
        rec.interimResults = true;
        rec.maxAlternatives = 1;

        let finalText = "";
        let interim = "";
        rec.onresult = (e) => {
          interim = "";
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const res = e.results[i];
            const text = res[0]?.transcript ?? "";
            if (res.isFinal) finalText += text;
            else interim += text;
          }
          pending = finalText + interim;
          const combined = joinText(sess.base, pending.trim());
          if (combined) cbRef.current.onInterim?.(combined);
          if (sess.active) armSilence();
        };
        rec.onerror = (e) => {
          const code = e.error || "error";
          // 沒聽到聲音／被中止：交給 onend 決定要不要接續
          if (code === "no-speech" || code === "aborted") return;
          cbRef.current.onError?.(code);
          // 出錯後 iPad 不一定會回 onend，一樣限時收尾
          if (sessRef.current === sess) stopSession();
        };
        rec.onend = () => {
          if (sessRef.current !== sess) return;
          // 有些瀏覽器結束前沒把最後的中間結果轉成 final，一併收下
          const heard = (finalText || interim).trim();
          sess.base = joinText(sess.base, heard);
          pending = "";
          sess.emptyRuns = heard ? 0 : sess.emptyRuns + 1;
          const keepGoing =
            sess.active && sess.emptyRuns < 2 && Date.now() - sess.startedAt < MAX_MS;
          if (!keepGoing) {
            finish();
            return;
          }
          try {
            run();
          } catch {
            finish();
          }
        };

        recRef.current = rec;
        rec.start();
      };

      try {
        run();
        setListening(true);
        // 一開始就計時：iPad 沒講話時可能永遠不回事件，不能只靠 onend
        armSilence(Math.max(silenceMs, FIRST_SPEECH_MS));
      } catch {
        sessRef.current = null;
        setListening(false);
        cbRef.current.onError?.("start-failed");
      }
    },
    [lang, silenceMs, stopSession],
  );

  // 卸載時清理。
  useEffect(() => {
    return () => {
      sessRef.current?.finish(false);
    };
  }, []);

  return { supported, listening, start, stop, cancel };
}
