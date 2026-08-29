import Link from "next/link";

import { Button } from "@/components/ui/button";
import { requireNavAccess } from "@/lib/authz";
import { colomboNow } from "@/lib/colombo-time";

import { loadDailyAttendance } from "./actions";
import { AttendanceReportScreen } from "./attendance-report-screen";

export const metadata = { title: "Daily Attendance" };

const FIELD = "border-input bg-background h-9 rounded-md border px-3 py-1 text-sm shadow-xs";

function toStr(v: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(v) ? v[0] : v;
  return raw && raw !== "" ? raw : undefined;
}

export default async function DailyAttendancePage({
  searchParams,
}: PageProps<"/daily-attendance">) {
  // ADMIN, STAFF and TEACHER may all reach this; the action scopes a teacher
  // to their own courses.
  await requireNavAccess("/daily-attendance");

  const params = await searchParams;
  const today = colomboNow().date;
  const date = toStr(params.date) ?? today;

  const report = await loadDailyAttendance(date);

  const filterUi = (
    <form method="get" className="bg-muted/40 flex flex-wrap items-end gap-3 rounded-xl border p-4">
      <div className="space-y-1.5">
        <label htmlFor="date" className="block text-sm font-medium">Day</label>
        <input id="date" name="date" type="date" className={FIELD} defaultValue={report.date} />
      </div>
      <Button type="submit" variant="secondary">Show</Button>
      {report.date !== today && (
        <Button asChild variant="ghost">
          <Link href="/daily-attendance">Today</Link>
        </Button>
      )}
    </form>
  );

  return <AttendanceReportScreen report={report} filterUi={filterUi} />;
}
