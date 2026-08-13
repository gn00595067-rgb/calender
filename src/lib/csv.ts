"use client";

/** 將單一儲存格轉為 CSV 安全字串 */
function cell(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * 產生 CSV 並於瀏覽器下載。
 * 加上 UTF-8 BOM，確保 Excel 開啟中文不亂碼。
 */
export function downloadCsv(
  filename: string,
  rows: (string | number | null | undefined)[][],
): void {
  const body = rows.map((r) => r.map(cell).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + body], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
