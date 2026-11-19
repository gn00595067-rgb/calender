import {
  CalendarDays,
  LayoutDashboard,
  Search,
  BarChart3,
  Users,
  Share2,
  FolderCog,
  Download,
  Coins,
  Wallet,
  Car,
  BellRing,
  Hash,
  GraduationCap,
  ClipboardCheck,
  Printer,
  Briefcase,
  NotebookPen,
  Sparkles,
  MapPin,
  Timer,
  CalendarPlus,
  Inbox,
  CalendarSearch,
  School,
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
  { href: "/weekly-free", label: "逐週查空檔", icon: CalendarSearch },
  { href: "/week-sheet", label: "週行程表", icon: Printer },
  { href: "/search", label: "搜尋", icon: Search },
  { href: "/recent", label: "新增紀錄", icon: ClipboardCheck },
  { href: "/learning", label: "學習回饋", icon: GraduationCap },
  { href: "/classrooms", label: "教室資料", icon: School },
  { href: "/tutoring", label: "家教填報", icon: NotebookPen },
  { href: "/reports", label: "報表結算", icon: BarChart3 },
  { href: "/work", label: "工作效益", icon: Briefcase },
  { href: "/driver", label: "司機行程", icon: Car },
  { href: "/overtime", label: "司機加班", icon: Timer },
];

/** 只看空檔的人：幫排行程（0030） */
export const PROPOSE_NAV: NavItem = { href: "/propose", label: "幫排行程", icon: CalendarPlus };
/** 逐週查空檔（只看空檔的人也能用） */
export const WEEKLY_FREE_NAV: NavItem = { href: "/weekly-free", label: "逐週查空檔", icon: CalendarSearch };
/** 員工（家庭老師）：自己的工作紀錄與週報（0031） */
export const MY_WORK_NAV: NavItem = { href: "/my-work", label: "我的工作", icon: Briefcase };
/** 擁有者：審核別人提議的行程（0030） */
export const PROPOSALS_NAV: NavItem = { href: "/proposals", label: "待審核", icon: Inbox };

export const SETTINGS_NAV: NavItem[] = [
  { href: "/settings/notifications", label: "手機通知", icon: BellRing },
  { href: "/settings/calendars", label: "分類管理", icon: FolderCog },
  { href: "/settings/shares", label: "分享與權限", icon: Share2 },
  { href: "/settings/contacts", label: "人物管理", icon: Users },
  { href: "/settings/categories", label: "費用類別", icon: Coins },
  { href: "/settings/tags", label: "標籤管理", icon: Hash },
  { href: "/settings/habits", label: "使用習慣", icon: Sparkles },
  { href: "/settings/places", label: "常用地點", icon: MapPin },
  { href: "/settings/prepaid", label: "預繳帳戶", icon: Wallet },
  { href: "/settings/import", label: "匯入 Google 行事曆", icon: Download },
];
