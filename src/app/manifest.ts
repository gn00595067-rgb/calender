import type { MetadataRoute } from "next";
import { APP_NAME } from "@/lib/constants";

/** 讓手機可「加入主畫面」；iPhone 要從主畫面開啟才收得到推播 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: "家庭與工作行事曆",
    start_url: "/calendar",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#1d4ed8",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
