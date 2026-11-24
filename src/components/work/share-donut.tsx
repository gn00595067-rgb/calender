"use client";

import { useState } from "react";

/**
 * 各大項時數佔比（環形圖，Peggy 11/24：看投入在哪裡最多）。
 * 4 大項＋未分類，最多 6 塊；顏色固定順序（已用 dataviz 驗證器跑過亮／暗兩組），
 * 旁邊一定有文字標籤與百分比，不只靠顏色辨識；滑過顯示時數。
 */
const LIGHT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#4a3aa7"];
const DARK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#9085e9"];

export function ShareDonut({ parts }: { parts: { label: string; hours: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = parts.filter((p) => p.hours > 0).slice(0, 6);
  const total = shown.reduce((s, p) => s + p.hours, 0);
  if (total <= 0) return null;
  const R = 52;
  const C = 2 * Math.PI * R;
  const GAP = shown.length > 1 ? 2 : 0; // 區塊之間留 2px 底色縫
  // 每塊的起點（前面各塊長度的累計）
  const lens = shown.map((p) => (p.hours / total) * C);
  const starts = lens.map((_, i) => lens.slice(0, i).reduce((a, b) => a + b, 0));
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border bg-card p-4 sm:flex-row sm:items-center">
      <style>{`.donut-seg{stroke:var(--seg-l)} @media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .donut-seg{stroke:var(--seg-d)}} :root[data-theme="dark"] .donut-seg{stroke:var(--seg-d)}`}</style>
      <svg viewBox="0 0 140 140" className="size-36 shrink-0" role="img" aria-label="各大項時數佔比">
        <g transform="rotate(-90 70 70)">
          {shown.map((p, i) => {
            const len = lens[i];
            return (
              <circle
                key={p.label}
                className="donut-seg cursor-default"
                style={{ ["--seg-l" as string]: LIGHT[i], ["--seg-d" as string]: DARK[i], opacity: hover == null || hover === i ? 1 : 0.35 }}
                cx="70"
                cy="70"
                r={R}
                fill="none"
                strokeWidth={hover === i ? 22 : 18}
                strokeDasharray={`${Math.max(0, len - GAP)} ${C}`}
                strokeDashoffset={-starts[i]}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              >
                <title>{`${p.label}：${p.hours.toFixed(1)} 小時（${((p.hours / total) * 100).toFixed(1)}%）`}</title>
              </circle>
            );
          })}
        </g>
        <text x="70" y="66" textAnchor="middle" className="fill-foreground text-[15px] font-bold">
          {hover == null ? `${total.toFixed(1)}h` : `${((shown[hover].hours / total) * 100).toFixed(0)}%`}
        </text>
        <text x="70" y="84" textAnchor="middle" className="fill-muted-foreground text-[10px]">
          {hover == null ? "總時數" : shown[hover].label}
        </text>
      </svg>
      <ul className="grid w-full gap-1.5 text-sm">
        {shown.map((p, i) => (
          <li
            key={p.label}
            className="flex items-center gap-2"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span
              className="donut-seg size-3 shrink-0 rounded-sm border-[6px]"
              style={{ ["--seg-l" as string]: LIGHT[i], ["--seg-d" as string]: DARK[i], borderColor: "var(--seg-l)" }}
            />
            <span className="flex-1 text-foreground">{p.label}</span>
            <span className="tabular-nums text-muted-foreground">{p.hours.toFixed(1)}h</span>
            <span className="w-14 text-right font-semibold tabular-nums text-foreground">
              {((p.hours / total) * 100).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
