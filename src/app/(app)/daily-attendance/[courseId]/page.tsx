import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, UserRound, X } from "lucide-react";

import { MonthStateBoxes, MonthStateChip } from "@/components/attendance/month-state";
import { Button } from "@/components/ui/button";
import { requireNavAccess } from "@/lib/authz";
import { colomboNow, to12Hour } from "@/lib/colombo-time";
import { classAttendanceDetail, courseScopeFor } from "@/lib/reports";

export const metadata = { title: "Class attendance" };

/**
 * One class, student by student — who came, and who owes.
 *
 * Read-only, and it computes nothing here: the mark is the row the counter
 * wrote, and the payment state is `courseMonthStates`, the same function the
 * Daily Attendance cards count with, so a card's four boxes and these chips can
 * never disagree. Attended students come first (earliest arrival first), then
 * the absent A to Z. A teacher reaching this page is narrowed to their own
 * courses by `courseScopeFor` inside the library, so asking for someone else's
 * course is a 404 rather than someone else's roster.
 */

function toStr(v: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(v) ? v[0] : v;
  return raw && raw !== "" ? raw : undefined;
}

export default async function ClassAttendancePage({
  params,
  searchParams,
}: PageProps<"/daily-attendance/[courseId]">) {
  const user = await requireNavAccess("/daily-attendance");

  const { courseId: raw } = await params;
  const courseId = Number(raw);
  if (!Number.isInteger(courseId) || courseId <= 0) notFound();

  const query = await searchParams;
  const today = colomboNow().date;
  const asked = toStr(query.date);
  const date = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : today;

  const report = await classAttendanceDetail(courseId, date, await courseScopeFor(user));
  if (!report.found) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{report.course}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {report.teacher} · {report.date}
          </p>
        </div>
        <Button asChild variant="outline" className="gap-1.5">
          <Link href={`/daily-attendance?date=${report.date}`}>
            <ArrowLeft className="size-4" aria-hidden />
            All classes
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <span className="rounded-lg border px-3 py-2 text-sm">
          Present <span className="font-semibold tabular-nums">{report.present}</span>
        </span>
        <span className="rounded-lg border px-3 py-2 text-sm">
          Absent <span className="font-semibold tabular-nums">{report.absent}</span>
        </span>
        <span className="text-muted-foreground rounded-lg border px-3 py-2 text-sm">
          Enrolled <span className="tabular-nums">{report.students.length}</span>
        </span>
      </div>

      <div className="space-y-1.5">
        <MonthStateBoxes counts={report.counts} />
        <p className="text-muted-foreground text-xs">Payments: {report.monthLabel}.</p>
      </div>

      {report.students.length === 0 ? (
        <p className="text-muted-foreground rounded-xl border p-6 text-center text-sm">
          Nobody is actively enrolled in this class.
        </p>
      ) : (
        <ul className="space-y-2">
          {report.students.map((s) => (
            // A card per student, not a table row: on a phone a row has no room
            // for a photo, a name, two chips and a time side by side.
            <li key={s.studentId} className="bg-card space-y-2 rounded-xl border p-3">
              <div className="flex items-center gap-3">
                <span className="bg-muted size-14 shrink-0 overflow-hidden rounded-xl border">
                  {s.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.photoUrl} alt="" className="size-full object-cover" />
                  ) : (
                    <span className="text-muted-foreground grid size-full place-items-center">
                      <UserRound className="size-6" aria-hidden />
                    </span>
                  )}
                </span>

                <span className="min-w-0 flex-1">
                  <Link
                    href={`/students/${s.studentId}`}
                    className="block truncate font-medium hover:underline"
                  >
                    {s.name}
                  </Link>
                  <span className="text-muted-foreground block truncate font-mono text-xs">
                    {s.cardNumber ?? "no card number"}
                  </span>
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {s.present ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-900">
                    <Check className="size-3.5 shrink-0" aria-hidden />
                    Present{s.arrivedAt ? ` · ${to12Hour(s.arrivedAt)}` : ""}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-md bg-slate-200 px-2 py-1 text-xs font-bold text-slate-800">
                    <X className="size-3.5 shrink-0" aria-hidden />
                    Absent
                  </span>
                )}
                <MonthStateChip state={s.monthState} />
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="text-muted-foreground text-xs">
        Attended first, by arrival time; then the absent, A to Z. The attendance mark
        is the one taken at the counter, and the payment state is for {report.monthLabel}
        — overdue means last month is unpaid too.
      </p>
    </div>
  );
}
