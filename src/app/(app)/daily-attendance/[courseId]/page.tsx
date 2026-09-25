import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { requireNavAccess } from "@/lib/authz";
import { colomboNow } from "@/lib/colombo-time";
import { classAttendanceDetail, courseScopeFor } from "@/lib/reports";

export const metadata = { title: "Class attendance" };

/**
 * One class, student by student — who came, and who owes.
 *
 * Read-only, and it computes nothing: the mark is the row the counter wrote,
 * and the paid/not-paid colour is `studentArrears`, the same verdict the
 * counter shows on a tap. A teacher reaching this page is narrowed to their own
 * courses by `courseScopeFor` inside the library, so asking for someone else's
 * course is a 404 rather than someone else's roster.
 */

/** The four states, in the counter's colours — same words, same meaning. */
const ARREARS: Record<string, { block: string; word: string }> = {
  green: { block: "bg-emerald-600 text-white", word: "PAID UP" },
  red: { block: "bg-red-600 text-white", word: "OWES THIS MONTH" },
  darkred: { block: "bg-red-900 text-white", word: "IN ARREARS" },
  grey: { block: "bg-neutral-500 text-white", word: "FREE TIER" },
};

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

      <div className="flex flex-wrap gap-3">
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

      {report.students.length === 0 ? (
        <p className="text-muted-foreground rounded-xl border p-6 text-center text-sm">
          Nobody is actively enrolled in this class.
        </p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {report.students.map((s) => {
            const a = ARREARS[s.arrears.status] ?? ARREARS.grey;
            return (
              <li key={s.studentId} className="flex items-center gap-3 p-3">
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
                  <span
                    className={`mt-1 inline-block rounded-md px-2 py-0.5 text-xs font-bold tracking-wide ${a.block}`}
                  >
                    {a.word}
                    {s.arrears.status === "red" || s.arrears.status === "darkred"
                      ? ` · ${s.arrears.label}`
                      : ""}
                  </span>
                </span>

                <span
                  className={`shrink-0 rounded-lg px-3 py-2 text-sm font-semibold ${
                    s.present
                      ? "bg-emerald-100 text-emerald-900"
                      : "bg-amber-100 text-amber-900"
                  }`}
                >
                  {s.present ? "Present" : "Absent"}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-muted-foreground text-xs">
        Absent first. The attendance mark is the one taken at the counter, and the
        paid colour is the same verdict the counter shows on a tap.
      </p>
    </div>
  );
}
