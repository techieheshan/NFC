import Link from "next/link";
import { KeyRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { requireNavAccess } from "@/lib/authz";
import { getAllSettings } from "@/lib/settings";

import { SettingsScreen } from "./settings-screen";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  // ADMIN only, from the nav config. Every write action re-checks it.
  const user = await requireNavAccess("/settings");

  const rows = await getAllSettings();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          The institute&apos;s configurable values, in one place. Nothing here is
          hardcoded in the app — these rows are what it reads.
        </p>
      </div>
      <SettingsScreen rows={rows} />

      {/* Your own password lives here, not on the top bar: the terminal's
          header is touched all day and a stray tap must not land on a password
          screen. Changing someone ELSE's password is User Roles; a forced
          change still routes to the same page on its own. */}
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
        <div>
          <h2 className="font-medium">Your password</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Change the password for <span className="font-medium">{user.username}</span>.
            Signing in again everywhere is required afterwards.
          </p>
        </div>
        <Button asChild variant="outline" className="gap-2">
          <Link href="/change-password">
            <KeyRound className="size-4" aria-hidden />
            Change my password
          </Link>
        </Button>
      </section>
    </div>
  );
}
