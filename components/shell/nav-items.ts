import type { LucideIcon } from "lucide-react";
import {
  LayoutList,
  Search,
  UserCheck,
  SlidersHorizontal,
  FolderKanban,
  ScrollText,
  Settings,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  shortDescription: string;
  icon: LucideIcon;
}

/**
 * Exact seven top-level destinations defined in Spec Section 4.1.
 * Do not add extra top-level navigation items.
 */
export const PRIMARY_NAV_ITEMS: NavItem[] = [
  {
    href: "/",
    label: "Overview",
    shortDescription: "Recommended jobs and pending actions",
    icon: LayoutList,
  },
  {
    href: "/discover",
    label: "Discover jobs",
    shortDescription: "Search, filter, source, and inspect jobs",
    icon: Search,
  },
  {
    href: "/profile",
    label: "Career profile",
    shortDescription: "Verified history, projects, skills, and evidence",
    icon: UserCheck,
  },
  {
    href: "/search-profiles",
    label: "Search profiles",
    shortDescription: "Role-specific preferences and ranking rules",
    icon: SlidersHorizontal,
  },
  {
    href: "/applications",
    label: "Applications",
    shortDescription: "Preparing, ready, applied, and outcomes",
    icon: FolderKanban,
  },
  {
    href: "/resumes",
    label: "Resumes",
    shortDescription: "Tailored drafts and immutable exports",
    icon: ScrollText,
  },
  {
    href: "/settings",
    label: "Settings",
    shortDescription: "AI CLI, sources, defaults, backup, and diagnostics",
    icon: Settings,
  },
];

export function resolveNavItem(pathname: string): NavItem {
  if (pathname === "/") {
    return PRIMARY_NAV_ITEMS[0];
  }
  const match = PRIMARY_NAV_ITEMS.find(
    (item) => item.href !== "/" && pathname.startsWith(item.href)
  );
  return match ?? PRIMARY_NAV_ITEMS[0];
}
