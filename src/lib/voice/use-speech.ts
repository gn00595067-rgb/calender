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
  /** 收到（可能是中間結果的）文字時觸發。 */
  onInterim?: (text: string) => void;
  /** 一段語音辨識完成（最終文字）時觸發。 */
  onFinal?: (text: string) => void;
  /** 發生錯誤時觸發（例如未授權麥克風、無聲）。 */
  onError?: (code: string) => void;
}

export interface UseSpeechResult {
  /** 此瀏覽器是否支援 Web Speech API。 */
  supported: boolean;
  /** 是否正在聆聽。 */
  listening: boolean;
  /** 開始聆聽。 */
  start: () => void;
  /** 停止聆聽（會觸發最終結果）。 */
  stop: () => void;
}

export function useSpeech(options: UseSpeechOptions = {}): UseSpeechResult {
  const { lang = "zh-TW", onInterim, onFinal, onError } = options;
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);

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

  const stop = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      cbRef.current.onError?.("unsupported");
      return;
    }
    // 若已有進行中的辨識器，先中止。
    try {
      recRef.current?.abort();
    } catch {
      /* ignore */
    }

    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    let finalText = "";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const text = res[0]?.transcript ?? "";
        if (res.isFinal) finalText += text;
        else interim += text;
      }
      const combined = (finalText + interim).trim();
      if (combined) cbRef.current.onInterim?.(combined);
    };
    rec.onerror = (e) => {
      cbRef.current.onError?.(e.error || "error");
    };
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
      const text = finalText.trim();
      if (text) cbRef.current.onFinal?.(text);
    };

    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
      cbRef.current.onError?.("start-failed");
    }
  }, [lang]);

  // 卸載時清理。
  useEffect(() => {
    return () => {
      try {
        recRef.current?.abort();
      } catch {
        /* ignore */
      }
    };
  }, []);

  return { supported, listening, start, stop };
}
