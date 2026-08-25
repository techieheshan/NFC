import { notFound } from "next/navigation";

import { auth } from "@/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { navItemByHref } from "@/config/nav";

/**
 * Phase 0 stand-in for every module screen.
 *
 * It also carries the route-level role guard: the nav config already knows who
 * may see each module, so a role that can't see the menu entry can't reach the
 * URL by typing it either. Feature tags replace the body but should keep the
 * guard.
 */
export async function Placeholder({ href }: { href: string }) {
  const item = navItemByHref(href);
  if (!item) notFound();

  const session = await auth();
  if (!session?.user || !item.roles.includes(session.user.role)) {
    notFound();
  }

  const Icon = item.icon;

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader className="flex flex-row items-center gap-3">
          <span className="bg-secondary text-secondary-foreground grid size-10 shrink-0 place-items-center rounded-lg">
            <Icon className="size-5" aria-hidden />
          </span>
          <CardTitle className="text-xl">{item.label} — coming soon</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          <p>
            This module has no functionality yet. Phase 0 ships the foundation
            only: schema, auth, and this navigation shell.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
