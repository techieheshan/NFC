import { requireNavAccess } from "@/lib/authz";
import { getAllSettings } from "@/lib/settings";

import { SettingsScreen } from "./settings-screen";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  // ADMIN only, from the nav config. Every write action re-checks it.
  await requireNavAccess("/settings");

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
    </div>
  );
}
