import type { UserRole } from "@prisma/client";
import {
  Banknote,
  BookOpen,
  CalendarClock,
  ClipboardList,
  GraduationCap,
  LayoutDashboard,
  Layers,
  Receipt,
  ScanLine,
  School,
  Search,
  Settings,
  ShieldCheck,
  Undo2,
  UserPlus,
  Users,
  UsersRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";

/**
 * THE menu. One config, filtered by role — never a second copy per role.
 *
 * `surfaces` decides where an item can appear:
 *   "terminal" — the mobile / POS tile dashboard
 *   "desktop"  — the left sidebar
 * `roles` decides who may see it at all. ADMIN is listed explicitly on every
 * item rather than special-cased, so "who sees what" is readable in one place.
 * `group` optionally buckets sidebar items under a heading.
 */
export type NavSurface = "terminal" | "desktop";

export type NavItem = {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  roles: UserRole[];
  surfaces: NavSurface[];
  group?: string;
};

const ALL_ROLES: UserRole[] = ["ADMIN", "STAFF", "TEACHER"];
const OPERATIONAL: UserRole[] = ["ADMIN", "STAFF"];
const ADMIN_ONLY: UserRole[] = ["ADMIN"];
const ADMIN_AND_TEACHER: UserRole[] = ["ADMIN", "TEACHER"];

/** Sidebar group headings, in render order. Ungrouped items come first. */
export const NAV_GROUPS = ["Setup"] as const;

export const NAV_ITEMS: NavItem[] = [
  {
    key: "dashboard",
    label: "Main Dashboard",
    href: "/",
    icon: LayoutDashboard,
    roles: ALL_ROLES,
    surfaces: ["desktop"],
  },

  // --- Operational / terminal modules -------------------------------------
  {
    key: "attendance",
    label: "Attendance",
    href: "/attendance",
    icon: ScanLine,
    roles: OPERATIONAL,
    surfaces: ["terminal", "desktop"],
  },
  {
    key: "payment",
    label: "Payment",
    href: "/payment",
    icon: Banknote,
    roles: OPERATIONAL,
    surfaces: ["terminal", "desktop"],
  },
  {
    key: "registration",
    label: "Registration",
    href: "/registration",
    icon: UserPlus,
    roles: OPERATIONAL,
    surfaces: ["terminal", "desktop"],
  },
  {
    key: "search",
    label: "Search",
    href: "/search",
    icon: Search,
    roles: OPERATIONAL,
    // Desktop too: the filtered lookup and its PDF export are back-office work,
    // not just a counter tile.
    surfaces: ["terminal", "desktop"],
  },
  {
    key: "daily-summary",
    label: "Daily Summary",
    href: "/daily-summary",
    icon: Wallet,
    // Institute-wide money: deductions, net, every teacher's collections.
    // Teachers are deliberately excluded — their view is the Payslip.
    roles: OPERATIONAL,
    surfaces: ["terminal", "desktop"],
  },
  {
    key: "my-students",
    label: "My Students",
    href: "/my-students",
    icon: UsersRound,
    // All three: a TEACHER is narrowed to their own courses server-side, the
    // same way Daily Attendance is. See src/lib/roster.ts.
    roles: ALL_ROLES,
    surfaces: ["desktop", "terminal"],
  },
  {
    key: "daily-attendance",
    label: "Daily Attendance",
    href: "/daily-attendance",
    icon: ClipboardList,
    // TEACHER is included on purpose: the report scopes itself to their own
    // courses server-side. See src/lib/reports.ts.
    roles: ALL_ROLES,
    surfaces: ["terminal", "desktop"],
  },

  // --- Setup: the backbone reference data everything else enrolls into ----
  // ADMIN + STAFF. Deliberately NOT visible to TEACHER.
  {
    key: "subjects",
    label: "Subjects",
    href: "/admin/subjects",
    icon: BookOpen,
    roles: OPERATIONAL,
    surfaces: ["desktop"],
    group: "Setup",
  },
  {
    key: "grades",
    label: "Grades",
    href: "/admin/grades",
    icon: School,
    roles: OPERATIONAL,
    surfaces: ["desktop"],
    group: "Setup",
  },
  {
    key: "teachers",
    label: "Teachers",
    href: "/admin/teachers",
    icon: GraduationCap,
    roles: OPERATIONAL,
    surfaces: ["desktop"],
    group: "Setup",
  },
  {
    key: "courses",
    label: "Classes / Courses",
    href: "/admin/courses",
    icon: Layers,
    roles: OPERATIONAL,
    surfaces: ["desktop"],
    group: "Setup",
  },
  {
    key: "combine-payment",
    label: "Combine Payment",
    href: "/admin/combos",
    icon: Layers,
    roles: OPERATIONAL,
    surfaces: ["desktop"],
    group: "Setup",
  },
  {
    key: "schedules",
    label: "Schedules",
    href: "/admin/schedules",
    icon: CalendarClock,
    roles: OPERATIONAL,
    surfaces: ["desktop"],
    group: "Setup",
  },

  // --- Back-office / desktop modules --------------------------------------
  {
    key: "user-roles",
    label: "User Roles",
    href: "/user-roles",
    icon: ShieldCheck,
    roles: ADMIN_ONLY,
    surfaces: ["desktop"],
  },
  {
    key: "students",
    label: "Students",
    href: "/students",
    icon: Users,
    roles: OPERATIONAL,
    surfaces: ["desktop"],
  },
  {
    key: "staff",
    label: "Staff",
    href: "/staff",
    icon: UsersRound,
    roles: ADMIN_ONLY,
    surfaces: ["desktop"],
  },
  {
    key: "receipts",
    label: "Receipts & Cancel",
    href: "/receipts",
    icon: Undo2,
    // ADMIN + STAFF on purpose: reprinting a receipt is counter work. The
    // cancel control inside is ADMIN-only, enforced on the action as well as
    // hidden in the UI — one screen beats two that share a lookup.
    roles: OPERATIONAL,
    surfaces: ["desktop", "terminal"],
  },

  // --- Shared across both shells ------------------------------------------
  {
    key: "reports",
    label: "Reports",
    href: "/reports",
    icon: ClipboardList,
    roles: ADMIN_AND_TEACHER,
    surfaces: ["desktop", "terminal"],
  },
  {
    key: "payslips",
    label: "Payslips",
    href: "/payslips",
    icon: Receipt,
    // All three: ADMIN sees everything, STAFF sees slips without the institute
    // profit block, TEACHER sees only their own last-completed month.
    roles: ALL_ROLES,
    surfaces: ["desktop", "terminal"],
  },
  {
    key: "expenses",
    label: "Expenses",
    href: "/expenses",
    icon: Receipt,
    roles: OPERATIONAL,
    surfaces: ["desktop", "terminal"],
  },
  {
    key: "settings",
    label: "Settings",
    href: "/settings",
    icon: Settings,
    roles: ADMIN_ONLY,
    surfaces: ["desktop", "terminal"],
  },
];

export function navFor(role: UserRole, surface: NavSurface): NavItem[] {
  return NAV_ITEMS.filter(
    (item) => item.roles.includes(role) && item.surfaces.includes(surface),
  );
}

/**
 * Sidebar items bucketed for rendering: ungrouped first (heading `null`), then
 * each group in NAV_GROUPS order. Empty buckets are dropped, so a role that
 * can't see any Setup item never sees the heading either.
 */
export function navSectionsFor(
  role: UserRole,
): { heading: string | null; items: NavItem[] }[] {
  const items = navFor(role, "desktop");

  return [
    { heading: null, items: items.filter((i) => !i.group) },
    ...NAV_GROUPS.map((heading) => ({
      heading: heading as string,
      items: items.filter((i) => i.group === heading),
    })),
  ].filter((section) => section.items.length > 0);
}

/** Every route the shell links to — used to keep placeholder pages honest. */
export function navItemByHref(href: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => item.href === href);
}
