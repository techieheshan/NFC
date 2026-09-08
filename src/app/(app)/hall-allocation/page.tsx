import Link from "next/link";

import { Button } from "@/components/ui/button";
import { requireNavAccess } from "@/lib/authz";
import { colomboNow } from "@/lib/colombo-time";
import { db } from "@/lib/db";
import { classesForDate } from "@/lib/halls";

import { AllocationScreen } from "./allocation-screen";

export const metadata = { title: "Hall Allocation" };

const FIELD = "border-input bg-background h-9 rounded-md border px-3 py-1 text-sm shadow-xs";

export default async function HallAllocationPage({
  searchParams,
}: PageProps<"/hall-allocation">) {
  // ADMIN + STAFF from the nav config; every action re-checks.
  await requireNavAccess("/hall-allocation");

  const params = await searchParams;
  const raw = Array.isArray(params.date) ? params.date[0] : params.date;
  // Colombo, not the server clock — "today" on the wall is what staff mean.
  const today = colomboNow().date;
  const date = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : today;

  const [classes, halls] = await Promise.all([
    classesForDate(date),
    db.hall.findMany({
      where: { active: true },
      select: { id: true, name: true, icon: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const dateFilter = (
    <form className="bg-muted/40 flex flex-wrap items-end gap-3 rounded-xl border p-4">
      <div className="space-y-1.5">
        <label htmlFor="date" className="block text-sm font-medium">Day</label>
        <input id="date" name="date" type="date" className={FIELD} defaultValue={date} />
      </div>
      <Button type="submit" variant="secondary">Show</Button>
      {date !== today && (
        <Button asChild variant="ghost"><Link href="/hall-allocation">Today</Link></Button>
      )}
    </form>
  );

  return (
    // Keyed on the date: a new day is a fresh grid, never last day's rows
    // synced into state.
    <div className="mx-auto max-w-3xl">
      <AllocationScreen
        key={date}
        date={date}
        today={today}
        classes={classes}
        halls={halls}
        dateFilter={dateFilter}
      />
    </div>
  );
}
