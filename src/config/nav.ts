import type { UserRole } from "@prisma/client";
import {
  Banknote,
  BookOpen,
  CalendarClock,
  DoorOpen,
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
  /** A different label for one role. `navFor` resolves it, so no consumer cares. */
  labelByRole?: Partial<Record<UserRole, string>>;
  href: string;
  icon: LucideIcon;
  roles: UserRole[];
  surfaces: NavSurface[];
  group?: string;
};

const ALL_ROLES: UserRole[] = ["ADMIN", "STAFF", "TEACHER"];
const OPERATIONAL: UserRole[] = ["ADMIN", "STAFF"];
const ADMIN_ONLY: UserRole[] = ["ADMIN"];

export const NAV_ITEMS: NavItem[] = [
  // The order below IS the order on every surface — the dashboard tiles, the
  // burger menu and the desktop sidebar all read this one array top to bottom,
  // filtered by role and surface. Reorder here and nowhere else.
  //
  // Daily counter work first; User Roles and Hall Allocation deliberately last.
  // `dashboard` is the home link, not a module, so it stays pinned on top.
  {
    key: "dashboard",
    label: "Main Dashboard",
    href: "/",
    icon: LayoutDashboard,
    roles: ALL_ROLES,
    surfaces: ["desktop"],
  },
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
    key: "daily-attendance",
    label: "Daily Attendance",
    href: "/daily-attendance",
    icon: ClipboardList,
    // TEACHER is included on purpose: the report scopes itself to their own
    // courses server-side. See src/lib/reports.ts.
    roles: ALL_ROLES,
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
    key: "schedules",
    label: "Class Schedule",
    href: "/admin/schedules",
    icon: CalendarClock,
    // Daily work, not setup: staff add a one-off class in the middle of the
    // day, from the terminal. ADMIN + STAFF for both the recurring schedule and
    // additional classes; TEACHER never.
    roles: OPERATIONAL,
    surfaces: ["terminal", "desktop"],
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
    key: "reports",
    label: "Reports",
    href: "/reports",
    icon: ClipboardList,
    // All three: the student list is teacher-facing, and staff hand it out.
    // A TEACHER is narrowed to their own courses server-side.
    roles: ALL_ROLES,
    surfaces: ["desktop", "terminal"],
  },

  // --- Everything else, in the order it has always read ----------------------
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
    // STAFF reprint here, and the menu should not advertise a control they do not
    // have: they read "Receipts", the admin who can void a payment reads the long
    // form. The label is a courtesy — the guard is `requireRole(["ADMIN"])` inside
    // `cancelTransaction`, and the button is gated by `canCancel` on the page.
    label: "Receipts",
    labelByRole: { ADMIN: "Receipts & Cancel" },
    href: "/receipts",
    icon: Undo2,
    // ADMIN + STAFF on purpose: reprinting a receipt is counter work. The
    // cancel control inside is ADMIN-only, enforced on the action as well as
    // hidden in the UI — one screen beats two that share a lookup.
    roles: OPERATIONAL,
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
    key: "settings",
    label: "Settings",
    href: "/settings",
    icon: Settings,
    roles: ADMIN_ONLY,
    surfaces: ["desktop", "terminal"],
  },

  // --- Setup: the backbone reference data everything else enrolls into ----
  // ADMIN + STAFF. Deliberately NOT visible to TEACHER. Grouped under one heading
  // in the sidebar and burger.
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
    key: "streams",
    label: "Streams & Subjects",
    href: "/admin/streams",
    icon: Layers,
    roles: OPERATIONAL,
    surfaces: ["desktop"],
    group: "Setup",
  },
  {
    key: "halls",
    label: "Halls",
    href: "/admin/halls",
    icon: DoorOpen,
    roles: OPERATIONAL,
    surfaces: ["desktop"],
    group: "Setup",
  },

  // --- Last on purpose ----------------------------------------------------
  {
    key: "user-roles",
    label: "User Roles",
    href: "/user-roles",
    icon: ShieldCheck,
    roles: ADMIN_ONLY,
    surfaces: ["desktop"],
  },
  {
    key: "hall-allocation",
    label: "Hall Allocation",
    href: "/hall-allocation",
    icon: DoorOpen,
    // Changes hour to hour, so it is on the same footing as Attendance and
    // Payment: ADMIN + STAFF, on both surfaces. TEACHER is blocked — they read
    // rooms off the timetable, they do not reassign them.
    roles: OPERATIONAL,
    surfaces: ["terminal", "desktop"],
  },
];

export function navFor(role: UserRole, surface: NavSurface): NavItem[] {
  return NAV_ITEMS.filter(
    (item) => item.roles.includes(role) && item.surfaces.includes(surface),
  ).map((item) => ({ ...item, label: item.labelByRole?.[role] ?? item.label }));
}

export type NavSection = { key: string; heading: string | null; items: NavItem[] };

/**
 * Sidebar / burger items bucketed for rendering, in the ORDER OF NAV_ITEMS.
 *
 * A section is a contiguous run of items that share a `group`, so a group sits
 * exactly where its first item sits and anything after it — User Roles and Hall
 * Allocation — really is last. (This used to hoist every ungrouped item above
 * the Setup group, which made "last" impossible to express.) A role that can't
 * see any item in a run never sees its heading either.
 */
export function navSectionsFor(role: UserRole): NavSection[] {
  const sections: NavSection[] = [];

  for (const item of navFor(role, "desktop")) {
    const heading = item.group ?? null;
    const last = sections[sections.length - 1];
    if (last && last.heading === heading) {
      last.items.push(item);
    } else {
      sections.push({ key: `${heading ?? "_"}:${sections.length}`, heading, items: [item] });
    }
  }

  return sections;
}

/** Every route the shell links to — used to keep placeholder pages honest. */
export function navItemByHref(href: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => item.href === href);
}
