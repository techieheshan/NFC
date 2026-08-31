import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Pencil, UserRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireNavAccess } from "@/lib/authz";
import { to12Hour } from "@/lib/colombo-time";
import { loadStudentProfile, type MonthCell } from "@/lib/student-profile";
import type { ArrearsStatus } from "@/lib/student-arrears";

export const metadata = { title: "Student profile" };

/** The one place the arrears colour is turned into pixels. */
const ARREARS_STYLE: Record<ArrearsStatus, { className: string; word: string }> = {
  green: { className: "bg-emerald-100 text-emerald-900 border-emerald-300", word: "Up to date" },
  amber: { className: "bg-amber-100 text-amber-900 border-amber-300", word: "Owes this month" },
  red: { className: "bg-red-100 text-red-900 border-red-300", word: "In arrears" },
  grey: { className: "bg-muted text-muted-foreground border-border", word: "Free tier" },
};

const CELL: Record<MonthCell, string> = {
  paid: "bg-emerald-500",
  owed: "bg-red-500",
  free: "bg-muted-foreground/30",
  before: "bg-transparent border border-dashed",
};

export default async function StudentProfilePage({ params }: PageProps<"/students/[id]">) {
  // ADMIN + STAFF, from the nav config on the parent route. TEACHER is excluded
  // deliberately: this screen shows a student's whole payment history.
  await requireNavAccess("/students");

  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const profile = await loadStudentProfile(id);
  if (!profile) notFound();

  const { student, arrears } = profile;
  const badge = ARREARS_STYLE[arrears.status];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Button asChild variant="ghost">
          <Link href="/search?tab=students">← Search</Link>
        </Button>
        <Button asChild variant="outline" className="gap-1.5">
          <Link href={`/registration?studentId=${student.id}`}>
            <Pencil className="size-3.5" aria-hidden />
            Edit in registration
          </Link>
        </Button>
      </div>

      {/* --- header --- */}
      <section className="flex flex-wrap items-start gap-5 rounded-xl border p-5">
        <div className="bg-muted size-28 shrink-0 overflow-hidden rounded-xl border">
          {student.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={student.photoUrl} alt="" className="size-full object-cover" />
          ) : (
            // Photos are optional, so every surface needs this fallback.
            <div className="text-muted-foreground grid size-full place-items-center text-center">
              <span>
                <UserRound className="mx-auto size-8" aria-hidden />
                <span className="mt-1 block px-1 text-[10px] leading-tight">
                  {student.cardNumber ?? "no card"}
                </span>
              </span>
            </div>
          )}
        </div>

        <div className="min-w-56 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{student.name}</h1>
            <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${badge.className}`}>
              {badge.word}
              {arrears.status !== "green" && arrears.status !== "grey" && ` · ${arrears.label}`}
            </span>
          </div>

          <dl className="text-muted-foreground grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <Field label="Card number" value={student.cardNumber} mono />
            <Field label="Card UID" value={student.cardUid} mono />
            <Field label="Grade" value={student.grade} />
            <Field label="School" value={student.school} />
            <Field label="Phone" value={student.phone} />
            <Field label="NIC" value={student.nic} />
          </dl>

          <Badge variant={student.admissionPaid ? "secondary" : "destructive"}>
            {student.admissionPaid ? "Admission paid" : "Admission owing"}
          </Badge>
        </div>
      </section>

      {/* --- enrolments --- */}
      <section className="rounded-xl border">
        <h2 className="border-b p-4 font-medium">Enrolled classes</h2>
        {profile.enrolments.length === 0 ? (
          <p className="text-muted-foreground p-4 text-sm">No enrolments.</p>
        ) : (
          <ul className="divide-y">
            {profile.enrolments.map((e) => (
              <li key={e.courseId} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="font-medium">{e.course}</p>
                  <p className="text-muted-foreground text-sm">{e.teacher}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Badge variant="outline">{e.feeTier}</Badge>
                  {e.status === "DROPPED" && <Badge variant="secondary">Dropped</Badge>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* --- month-by-month --- */}
      <section className="rounded-xl border">
        <div className="border-b p-4">
          <h2 className="font-medium">Payment history</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            By billing month, so a July fee paid in August clears July. Green paid,
            red owed, grey free, dashed before enrolment.
          </p>
        </div>
        {profile.history.length === 0 ? (
          <p className="text-muted-foreground p-4 text-sm">No active enrolments to bill.</p>
        ) : (
          <div className="overflow-x-auto p-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="pb-2 pr-3 text-left font-medium">Course</th>
                  {profile.months.map((m) => (
                    <th key={m.label} className="px-1 pb-2 text-center text-xs font-medium">
                      {m.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {profile.history.map((row) => (
                  <tr key={row.courseId}>
                    <td className="py-1.5 pr-3">{row.course}</td>
                    {row.cells.map((c, i) => (
                      <td key={i} className="px-1 py-1.5">
                        <span
                          title={`${profile.months[i].label}: ${c}`}
                          className={`mx-auto block size-4 rounded ${CELL[c]}`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* --- payments --- */}
      <section className="rounded-xl border">
        <h2 className="border-b p-4 font-medium">Payments taken</h2>
        {profile.payments.length === 0 ? (
          <p className="text-muted-foreground p-4 text-sm">Nothing paid yet.</p>
        ) : (
          <ul className="divide-y text-sm">
            {profile.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{p.kind}</Badge>
                    {p.billing && <span className="text-muted-foreground">{p.billing}</span>}
                    {p.cancelled && <Badge variant="destructive">Cancelled</Badge>}
                  </span>
                  <span className="text-muted-foreground block truncate">{p.course ?? "—"}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className={`block tabular-nums ${p.cancelled ? "line-through opacity-60" : "font-medium"}`}>
                    {p.amount}
                  </span>
                  <span className="text-muted-foreground block text-xs">{p.date}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* --- attendance --- */}
      <section className="rounded-xl border">
        <h2 className="border-b p-4 font-medium">Recent attendance</h2>
        {profile.attendance.length === 0 ? (
          <p className="text-muted-foreground p-4 text-sm">No attendance recorded.</p>
        ) : (
          <ul className="divide-y text-sm">
            {profile.attendance.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 p-3">
                <span className="flex min-w-0 items-center gap-2">
                  <CheckCircle2 className="size-4 shrink-0 text-emerald-600" aria-hidden />
                  <span className="truncate">{a.course}</span>
                </span>
                <span className="text-muted-foreground shrink-0 tabular-nums">
                  {a.date} {to12Hour(a.at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0">{label}</dt>
      <dd className={mono ? "font-mono" : ""}>{value ?? "—"}</dd>
    </div>
  );
}
