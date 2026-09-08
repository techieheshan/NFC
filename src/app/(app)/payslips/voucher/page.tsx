import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { requireNavAccess } from "@/lib/authz";
import { colomboNow } from "@/lib/colombo-time";
import { db } from "@/lib/db";
import { buildPayslips } from "@/lib/payslips";

import { PrintButton } from "./print-button";
import { PayslipSheet } from "./sheet";

export const metadata = { title: "Payslip" };

function toStr(v: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(v) ? v[0] : v;
  return raw && raw !== "" ? raw : undefined;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Payslips as paper: ONE A4 page per teacher.
 *
 * `?teacherId=` prints one teacher's sheet; omitting it prints every teacher
 * who has a slip for the month, one page each with a page break between them —
 * so a single print run produces a stack that can be handed out individually.
 *
 * ADMIN + STAFF only: staff hand slips out, which is the same reasoning that
 * lets them see individual slips but not institute profit. A TEACHER reaching
 * this URL gets a 404 — their own slip is the /payslips screen, and a
 * pick-any-teacher print is exactly what they must not have.
 *
 * The figures come from `buildPayslips` with `includeInstitute: false`, i.e.
 * the same frozen-percent computation the teacher's own view uses. There is no
 * second formula here to drift out of step, and institute profit is not merely
 * hidden from the sheet — it is never computed.
 */
export default async function VoucherPage({ searchParams }: PageProps<"/payslips/voucher">) {
  const user = await requireNavAccess("/payslips");
  if (user.role === "TEACHER") notFound();

  const params = await searchParams;
  const asked = toStr(params.month);
  const now = colomboNow();
  const [y, m] =
    asked && /^\d{4}-\d{2}$/.test(asked)
      ? asked.split("-").map(Number)
      : now.date.split("-").map(Number);

  const rawTeacher = toStr(params.teacherId);
  const teacherId = rawTeacher === undefined ? null : Number(rawTeacher);
  if (teacherId !== null && (!Number.isInteger(teacherId) || teacherId <= 0)) notFound();

  const teachers = await db.teacher.findMany({
    where: teacherId !== null ? { id: teacherId } : {},
    select: { id: true, name: true, nic: true, phone: true },
    orderBy: { name: "asc" },
  });
  if (teachers.length === 0) notFound();

  const report = await buildPayslips({
    year: y,
    month: m,
    teacherIds: teachers.map((t) => t.id),
    includeInstitute: false,
  });

  const monthLabel = `${MONTHS[m - 1]} ${y}`;
  const daysInMonth = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 0)).getUTCDate();
  const range = `${y}-${pad(m)}-01 → ${y}-${pad(m)}-${pad(daysInMonth)}`;

  // One sheet per teacher, in the report's order. A teacher with no collections
  // still gets a sheet when asked for by name (it says so), but the
  // all-teachers run only prints teachers who actually have one.
  const sheets = teachers
    .map((t) => ({ teacher: t, slip: report.slips.find((s) => s.teacherId === t.id) }))
    .filter((x) => x.slip !== undefined)
    .filter((x) => teacherId !== null || x.slip!.lines.length > 0);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 12mm; }
          body * { visibility: hidden !important; }
          #sheets, #sheets * { visibility: visible !important; }
          #sheets { position: absolute; left: 0; top: 0; width: 100%; }
          /* Each teacher's sheet stands alone on its own page. */
          .payslip-sheet { padding: 0 !important; }
          .break-after-page { break-after: page; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost">
          <Link href={`/payslips?month=${y}-${pad(m)}`}>← Back to payslips</Link>
        </Button>
        <div className="flex items-center gap-2">
          {teacherId !== null && (
            <Button asChild variant="outline">
              <Link href={`/payslips/voucher?month=${y}-${pad(m)}`}>All teachers</Link>
            </Button>
          )}
          <PrintButton />
        </div>
      </div>

      <p className="no-print text-muted-foreground text-sm">
        {sheets.length === 1
          ? "One A4 page."
          : `${sheets.length} sheets — one A4 page per teacher, page break between them.`}
      </p>

      <div id="sheets" className="space-y-6">
        {sheets.map((x, i) => (
          <div key={x.teacher.id} className="overflow-x-auto rounded-xl border">
            <PayslipSheet
              slip={x.slip!}
              teacher={x.teacher}
              monthLabel={monthLabel}
              range={range}
              last={i === sheets.length - 1}
            />
          </div>
        ))}
        {sheets.length === 0 && (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm">
            No teacher has collections in {monthLabel}.
          </p>
        )}
      </div>
    </div>
  );
}
