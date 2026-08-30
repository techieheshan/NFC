import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { requireNavAccess } from "@/lib/authz";
import { colomboNow } from "@/lib/colombo-time";
import { db } from "@/lib/db";
import { buildPayslips } from "@/lib/payslips";

import { PrintButton } from "./print-button";

export const metadata = { title: "Payslip voucher" };

function toStr(v: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(v) ? v[0] : v;
  return raw && raw !== "" ? raw : undefined;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * A single teacher's payslip, laid out to be handed over on paper.
 *
 * ADMIN + STAFF only: staff hand slips out, which is the same reasoning that
 * lets them see individual slips but not institute profit. A TEACHER reaching
 * this URL gets a 404 — their own slip is the /payslips screen, and a
 * pick-any-teacher print is exactly what they must not have.
 *
 * The figures come from `buildPayslips` with `includeInstitute: false`, i.e.
 * the same frozen-percent computation the teacher's own view uses. There is no
 * second formula here to drift out of step, and institute profit is not merely
 * hidden — it is never computed.
 */
export default async function VoucherPage({ searchParams }: PageProps<"/payslips/voucher">) {
  const user = await requireNavAccess("/payslips");
  if (user.role === "TEACHER") notFound();

  const params = await searchParams;
  const teacherId = Number(toStr(params.teacherId));
  const asked = toStr(params.month);
  const now = colomboNow();
  const [y, m] =
    asked && /^\d{4}-\d{2}$/.test(asked)
      ? asked.split("-").map(Number)
      : now.date.split("-").map(Number);

  if (!Number.isInteger(teacherId) || teacherId <= 0) notFound();

  const teacher = await db.teacher.findUnique({
    where: { id: teacherId },
    select: { id: true, name: true, nic: true, phone: true },
  });
  if (!teacher) notFound();

  const report = await buildPayslips({
    year: y,
    month: m,
    teacherIds: [teacher.id],
    includeInstitute: false,
  });
  const slip = report.slips[0];

  const monthLabel = `${MONTHS[m - 1]} ${y}`;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 14mm; }
          body * { visibility: hidden !important; }
          #voucher, #voucher * { visibility: visible !important; }
          #voucher { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost">
          <Link href={`/payslips?month=${y}-${String(m).padStart(2, "0")}`}>← Back to payslips</Link>
        </Button>
        <PrintButton />
      </div>

      <div id="voucher" className="space-y-5 rounded-xl border bg-white p-8 text-black">
        <header className="flex items-start justify-between gap-4 border-b pb-4">
          <div>
            <p className="text-xl font-bold tracking-widest">XENON</p>
            <p className="text-sm">Institute</p>
          </div>
          <div className="text-right text-sm">
            <p className="font-semibold">Payslip voucher</p>
            <p>{monthLabel}</p>
          </div>
        </header>

        <section className="grid gap-1 text-sm">
          <div className="flex gap-2">
            <span className="w-24 shrink-0 font-medium">Teacher</span>
            <span>{teacher.name}</span>
          </div>
          {teacher.nic && (
            <div className="flex gap-2">
              <span className="w-24 shrink-0 font-medium">NIC</span>
              <span>{teacher.nic}</span>
            </div>
          )}
          {teacher.phone && (
            <div className="flex gap-2">
              <span className="w-24 shrink-0 font-medium">Phone</span>
              <span>{teacher.phone}</span>
            </div>
          )}
        </section>

        {!slip || slip.courses.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm">
            No collections recorded for {teacher.name} in {monthLabel}.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left">
                <tr>
                  <th className="py-2 pr-2 font-medium">Course</th>
                  <th className="py-2 px-2 text-right font-medium">Share %</th>
                  <th className="py-2 px-2 text-right font-medium">Students</th>
                  <th className="py-2 px-2 text-right font-medium">Collected</th>
                  <th className="py-2 px-2 text-right font-medium">Institute</th>
                  <th className="py-2 pl-2 text-right font-medium">Teacher</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {slip.courses.map((c) => (
                  <tr key={c.courseId}>
                    <td className="py-2 pr-2">{c.course}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{c.sharePercent}%</td>
                    <td className="py-2 px-2 text-right tabular-nums">{c.payingStudents}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{c.collected}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{c.instituteShare}</td>
                    <td className="py-2 pl-2 text-right tabular-nums">{c.teacherShare}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {slip && (
          <section className="ml-auto w-full max-w-xs space-y-1 border-t pt-4 text-sm">
            <Row label="Total collected" value={slip.totalCollected} />
            <Row label="Institute share" value={slip.totalInstituteShare} />
            <Row label="Teacher share" value={slip.totalTeacherShare} />
            <Row label="Advances taken" value={`-${slip.advances}`} />
            <div className="flex justify-between border-t pt-2 text-base font-bold">
              <span>Final salary</span>
              <span className="tabular-nums">{slip.finalSalary}</span>
            </div>
          </section>
        )}

        <footer className="border-t pt-4 text-xs">
          <div className="mt-8 flex justify-between gap-8">
            <span className="w-48 border-t pt-1 text-center">Teacher signature</span>
            <span className="w-48 border-t pt-1 text-center">Issued by</span>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
