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
    // Covers both "never signed in" and "session revoked since": the jwt
    // callback returns null for a deactivated account or a stale tokenVersion,
    // so this is where a revoked session actually ends.
    redirect("/login?revoked=1");
  }

  // The gate for a forced password change. It lives here rather than in the
  // proxy because the flag is read from the database in the jwt callback, which
  // only runs in Node — and here it covers every page in the app at once.
  if (session.user.mustChangePassword) {
    redirect("/change-password");
  }

  return (
    <AppShell role={session.user.role} username={session.user.username}>
      {children}
    </AppShell>
  );
}
