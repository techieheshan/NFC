import Link from "next/link";
import { KeyRound } from "lucide-react";
import type { UserRole } from "@prisma/client";

import { NavLink } from "@/components/shell/nav-link";
import { SignOutButton } from "@/components/shell/sign-out-button";
import { navSectionsFor } from "@/config/nav";

const ROLE_LABEL: Record<UserRole, string> = {
  ADMIN: "Administrator",
  STAFF: "Staff",
  TEACHER: "Teacher",
};

/**
 * Responsive shell. Same tree at every width; CSS decides which half shows:
 *   < lg  — no sidebar, the dashboard renders as tiles (the terminal view)
 *   >= lg — persistent left sidebar (the WST-style desktop view)
 * Both sides read the SAME role-filtered nav config; there is no per-role menu.
 */
export function AppShell({
  role,
  username,
  children,
}: {
  role: UserRole;
  username: string;
  children: React.ReactNode;
}) {
  const sections = navSectionsFor(role);

  return (
    <div className="flex min-h-svh flex-col lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="bg-sidebar text-sidebar-foreground border-sidebar-border hidden border-r lg:flex lg:h-svh lg:flex-col lg:sticky lg:top-0">
        <div className="border-sidebar-border flex h-16 items-center gap-2 border-b px-5">
          <Wordmark />
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto p-3" aria-label="Main">
          {sections.map((section) => (
            <div key={section.heading ?? "_"}>
              {section.heading && (
                <p className="text-muted-foreground px-3 pb-1 text-xs font-semibold tracking-wide uppercase">
                  {section.heading}
                </p>
              )}
              <ul className="space-y-1">
                {section.items.map((item) => (
                  <li key={item.key}>
                    <NavLink href={item.href} label={item.label}>
                      <item.icon className="size-4 shrink-0" aria-hidden />
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-sidebar-border border-t px-5 py-4 text-xs">
          <p className="font-medium">{username}</p>
          <p className="text-muted-foreground">{ROLE_LABEL[role]}</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background/95 supports-[backdrop-filter]:bg-background/75 sticky top-0 z-10 flex h-16 items-center justify-between gap-3 border-b px-4 backdrop-blur lg:px-8">
          <div className="lg:hidden">
            <Wordmark />
          </div>
          <div className="hidden lg:block">
            <p className="text-muted-foreground text-sm">
              Signed in as <span className="text-foreground font-medium">{username}</span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="bg-secondary text-secondary-foreground rounded-full px-2.5 py-1 text-xs font-medium lg:hidden">
              {ROLE_LABEL[role]}
            </span>
            {/* Everyone can change their own password; the User Roles screen
                is admin-only and is for changing OTHER people's. */}
            <Link
              href="/change-password"
              title="Change my password"
              className="text-muted-foreground hover:text-foreground hover:bg-secondary grid size-9 place-items-center rounded-md"
            >
              <KeyRound className="size-4" aria-hidden />
              <span className="sr-only">Change my password</span>
            </Link>
            <SignOutButton />
          </div>
        </header>

        <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}

function Wordmark() {
  return (
    <Link href="/" className="flex items-center gap-2">
      <span className="bg-primary text-primary-foreground grid size-8 place-items-center rounded-md text-sm font-bold">
        X
      </span>
      <span className="text-lg font-semibold tracking-tight">Xenon</span>
    </Link>
  );
}
