import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { navFor } from "@/config/nav";

/**
 * Main Dashboard — the tile grid.
 *
 * On the terminal this IS the whole menu (there is no sidebar under `lg`); on
 * desktop it doubles as quick-launch next to the sidebar. Tiles are big, plain
 * links: no client JS, tap targets sized for a phone held one-handed.
 */
export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const tiles = navFor(session.user.role, "terminal");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Welcome back, {session.user.username}.
        </p>
      </div>

      {tiles.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No modules are assigned to your role yet.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {tiles.map((item) => (
            <li key={item.key}>
              {/*
                Square, thumb-sized tiles on the terminal; capped height once
                there's room for a sidebar, where tiles are only quick-launch.
              */}
              <Link
                href={item.href}
                className="border-border bg-card hover:border-primary hover:bg-accent focus-visible:ring-ring flex aspect-square flex-col items-center justify-center gap-3 rounded-xl border p-4 text-center transition-colors focus-visible:ring-2 focus-visible:outline-none sm:aspect-auto sm:min-h-36"
              >
                <span className="bg-primary/10 text-primary grid size-12 place-items-center rounded-full">
                  <item.icon className="size-6" aria-hidden />
                </span>
                <span className="text-sm leading-tight font-medium">{item.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
