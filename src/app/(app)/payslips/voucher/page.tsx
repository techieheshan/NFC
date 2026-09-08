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
 *
 * Deliberately NOT the admin payslip screen. This sheet is read across a
 * counter and signed, so it is set at a size that survives that, and it carries
 * only what a teacher checks: how many cards, at which tiers, and how the
 * collected money became their salary. The per-course breakdown stays on
 * /payslips, where the same numbers are already available in full.
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

      <div id="voucher" className="space-y-6 rounded-xl border bg-white p-8 text-black">
        <header className="flex items-start justify-between gap-4 border-b pb-4">
          <div>
            <p className="text-2xl font-bold tracking-widest">XENON</p>
            <p>Institute</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold">Payslip voucher</p>
            <p>{monthLabel}</p>
          </div>
        </header>

        <section className="grid gap-1 text-lg">
          <div className="flex gap-3">
            <span className="w-28 shrink-0 font-medium">Teacher</span>
            <span className="font-semibold">{teacher.name}</span>
          </div>
          {teacher.nic && (
            <div className="flex gap-3">
              <span className="w-28 shrink-0 font-medium">NIC</span>
              <span>{teacher.nic}</span>
            </div>
          )}
          {teacher.phone && (
            <div className="flex gap-3">
              <span className="w-28 shrink-0 font-medium">Phone</span>
              <span>{teacher.phone}</span>
            </div>
          )}
        </section>

        {!slip || Number(slip.totalCollected) === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-lg">
            No collections recorded for {teacher.name} in {monthLabel}.
          </p>
        ) : (
          <>
            <section className="border-y py-4 text-lg">
              <div className="flex justify-between gap-4">
                <span className="font-medium">Cards</span>
                <span className="tabular-nums">
                  {slip.payingStudents} {slip.payingStudents === 1 ? "student" : "students"}
                </span>
              </div>
              {slip.tierCounts.length > 0 && (
                <p className="mt-1 text-right">
                  {/* Tier names come from the reference table, so a new tier
                      appears here on its own. */}
                  {slip.tierCounts.map((t) => `${t.students} ${t.label.toLowerCase()}`).join(", ")}
                </p>
              )}
            </section>

            <section className="space-y-2 text-xl">
              <Row label="Collected" value={slip.totalCollected} />
              <Row label="Institute share" value={slip.totalInstituteShare} />
              <Row label="Teacher share" value={slip.totalTeacherShare} />
              <Row label="Advances taken" value={`-${slip.advances}`} />
              <div className="flex justify-between border-t-2 border-black pt-3 text-2xl font-bold">
                <span>Final salary</span>
                <span className="tabular-nums">{slip.finalSalary}</span>
              </div>
            </section>
          </>
        )}

        <footer className="border-t pt-4">
          <div className="mt-10 flex justify-between gap-8 text-base">
            <span className="w-56 border-t pt-1 text-center">Teacher signature</span>
            <span className="w-56 border-t pt-1 text-center">Issued by</span>
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
