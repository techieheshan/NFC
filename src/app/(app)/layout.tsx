import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { AppShell } from "@/components/shell/app-shell";

/**
 * Everything inside the (app) group is behind the shell and behind auth.
 * Middleware already redirects anonymous visitors; this second check is what
 * makes `session.user` non-null for the whole subtree.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <AppShell role={session.user.role} username={session.user.username}>
      {children}
    </AppShell>
  );
}
