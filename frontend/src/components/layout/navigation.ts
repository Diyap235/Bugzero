import {
  Activity,
  BarChart3,
  FileText,
  GitBranch,
  History,
  Search,
  Settings,
} from "lucide-react";

export const WORKSPACE_NAV_ITEMS = [
  { name: "Overview", href: "/dashboard", icon: Activity },
  { name: "Repositories", href: "/repositories", icon: GitBranch },
  { name: "Findings", href: "/findings", icon: Search },
  { name: "Health", href: "/health", icon: BarChart3 },
  { name: "History", href: "/history", icon: History },
  { name: "Reports", href: "/reports", icon: FileText },
  { name: "Settings", href: "/settings", icon: Settings },
] as const;

export const WORKSPACE_ROUTE_SEGMENTS = new Set([
  ...WORKSPACE_NAV_ITEMS.map(({ href }) => href),
  "/analysis",
]);
