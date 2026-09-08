import { requireNavAccess } from "@/lib/authz";
import { db } from "@/lib/db";

import { HallsScreen } from "./halls-screen";

export const metadata = { title: "Halls" };

export default async function HallsPage() {
  // ADMIN + STAFF, from the nav config; every action re-checks with
  // requireSetupAccess.
  await requireNavAccess("/admin/halls");

  const rows = await db.hall.findMany({
    select: { id: true, name: true, icon: true, active: true },
    // Active first, then alphabetical — deactivated rooms sink but stay visible.
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });

  return <HallsScreen rows={rows} />;
}
