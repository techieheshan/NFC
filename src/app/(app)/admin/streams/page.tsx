import { requireNavAccess } from "@/lib/authz";
import { db } from "@/lib/db";
import { streamsWithSubjects } from "@/lib/streams";

import { StreamsScreen } from "./streams-screen";

export const metadata = { title: "Streams & subjects" };

export default async function StreamsPage() {
  // ADMIN + STAFF, from the nav config; the save action re-checks with
  // requireSetupAccess.
  await requireNavAccess("/admin/streams");

  const [streams, subjects] = await Promise.all([
    streamsWithSubjects(),
    db.subject.findMany({
      where: { active: true },
      select: { id: true, label: true },
      orderBy: { label: "asc" },
    }),
  ]);

  return <StreamsScreen streams={streams} subjects={subjects} />;
}
