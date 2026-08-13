import {
  CalendarDays,
  LayoutDashboard,
  Search,
  BarChart3,
  Users,
  Share2,
  FolderCog,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const MAIN_NAV: NavItem[] = [
  { href: "/calendar", label: "行事曆", icon: CalendarDays },
  { href: "/digest", label: "區間總覽", icon: LayoutDashboard },
  { href: "/search", label: "搜尋", icon: Search },
  { href: "/reports", label: "報表結算", icon: BarChart3 },
];

export const SETTINGS_NAV: NavItem[] = [
  { href: "/settings/calendars", label: "分類管理", icon: FolderCog },
  { href: "/settings/shares", label: "分享與權限", icon: Share2 },
  { href: "/settings/contacts", label: "人物管理", icon: Users },
];
