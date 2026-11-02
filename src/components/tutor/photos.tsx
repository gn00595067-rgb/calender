"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, ImagePlus, X } from "lucide-react";
import { useSignedUrls } from "@/lib/client/tutor";
import type { Photo } from "@/lib/tutor";

/** 表單裡某一區的照片：原本的（kept）、要刪的（removed 路徑）、新加的檔案（added） */
export interface PhotoState {
  kept: Photo[];
  removed: string[];
  added: File[];
}

export function initPhotos(all: Photo[], section: Photo["section"]): PhotoState {
  return { kept: all.filter((p) => p.section === section), removed: [], added: [] };
}

/**
 * 照片欄位：可直接拍照或從相簿選多張；已上傳的點 × 標記刪除（存檔時才真的刪）。
 */
export function PhotoField({ state, onChange }: { state: PhotoState; onChange: (s: PhotoState) => void }) {
  const camRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  const visible = state.kept.filter((p) => !state.removed.includes(p.path));
  const urls = useSignedUrls(visible.map((p) => p.path)).data;
  // 新選的照片預覽網址；換掉或卸載時釋放
  const previews = useMemo(() => state.added.map((f) => URL.createObjectURL(f)), [state.added]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  const add = (files: FileList | null) => {
    if (!files?.length) return;
    // 不依 type 過濾：電腦上的 HEIC 常是空字串，交給上傳時判斷並提示
    onChange({ ...state, added: [...state.added, ...Array.from(files)] });
  };

  return (
    <div className="space-y-2">
      {(visible.length > 0 || state.added.length > 0) && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {visible.map((p) => (
            <Thumb
              key={p.path}
              src={urls?.get(p.path)}
              onRemove={() => onChange({ ...state, removed: [...state.removed, p.path] })}
            />
          ))}
          {previews.map((u, i) => (
            <Thumb
              key={u}
              src={u}
              isNew
              onRemove={() => onChange({ ...state, added: state.added.filter((_, j) => j !== i) })}
            />
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => camRef.current?.click()}
          className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border border-dashed text-sm hover:bg-accent"
        >
          <Camera className="size-4" />
          拍照
        </button>
        <button
          type="button"
          onClick={() => pickRef.current?.click()}
          className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border border-dashed text-sm hover:bg-accent"
        >
          <ImagePlus className="size-4" />
          從相簿選
        </button>
      </div>
      <input
        ref={camRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          add(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={pickRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          add(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function Thumb({ src, isNew, onRemove }: { src?: string; isNew?: boolean; onRemove: () => void }) {
  return (
    <div className="relative aspect-square overflow-hidden rounded-lg border bg-muted">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- 私有暫時網址／本機預覽，不走 next/image
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        <div className="size-full animate-pulse" />
      )}
      {isNew && (
        <span className="absolute bottom-1 left-1 rounded bg-primary px-1 text-[10px] text-primary-foreground">新</span>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label="移除這張"
        className="absolute right-1 top-1 inline-flex size-7 items-center justify-center rounded-full bg-black/60 text-white"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

/** 唯讀照片格：點了開大圖 */
export function PhotoGrid({ paths }: { paths: string[] }) {
  const urls = useSignedUrls(paths).data;
  const [big, setBig] = useState<string | null>(null);
  if (!paths.length) return null;
  return (
    <>
      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
        {paths.map((p) => {
          const u = urls?.get(p);
          return (
            <button
              key={p}
              type="button"
              onClick={() => u && setBig(u)}
              className="aspect-square overflow-hidden rounded-md border bg-muted"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- 私有暫時網址 */}
              {u ? <img src={u} alt="" className="size-full object-cover" /> : null}
            </button>
          );
        })}
      </div>
      {big && (
        <button
          type="button"
          onClick={() => setBig(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3"
          aria-label="關閉"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- 私有暫時網址 */}
          <img src={big} alt="" className="max-h-full max-w-full object-contain" />
        </button>
      )}
    </>
  );
}
