import { colomboNow, to12Hour } from "@/lib/colombo-time";
import type { Payslip } from "@/lib/payslips";

/**
 * One teacher's payslip, on one A4 page.
 *
 * The body is a per-line table — course, billing month, cards, rate, gross —
 * which is how the old paper slips read and how teachers check them: cards ×
 * rate is arithmetic they can do in their head. What the old slips could not
 * show is the split, because the institute's cut here is PER COURSE (20 / 25 /
 * 30 …), not one flat rate, so every line also carries its own institute and
 * teacher share.
 *
 * No money is computed here. Every figure comes from `buildPayslips` — the same
 * `paidAt` month basis and the same frozen `instituteSharePercentApplied` the
 * payslips screen uses, so the sheet cannot drift from the screen.
 *
 * `break-after-page` is what makes "all teachers" one PDF of standalone sheets:
 * each sheet is self-contained, so a teacher is handed their own page and
 * nothing of anyone else's.
 */
export function PayslipSheet({
  slip,
  teacher,
  monthLabel,
  range,
  last = false,
}: {
  slip: Payslip;
  teacher: { name: string; nic: string | null; phone: string | null };
  monthLabel: string;
  /** "2026-08-01 → 2026-08-31", the cash-basis window the figures cover. */
  range: string;
  last?: boolean;
}) {
  const now = colomboNow();
  const empty = slip.lines.length === 0;

  return (
    <section
      className={`payslip-sheet bg-white p-8 text-black ${last ? "" : "break-after-page"}`}
    >
      <header className="flex items-start justify-between gap-4 border-b-2 border-black pb-3">
        <div>
          <p className="text-2xl font-bold tracking-widest">XENON</p>
          <p className="text-sm">Institute</p>
        </div>
        <div className="text-right text-sm">
          <p className="text-lg font-semibold">Payslip — {monthLabel}</p>
          <p>{range}</p>
          <p className="text-xs">
            Generated {now.date} {to12Hour(now.time)} (Asia/Colombo)
          </p>
        </div>
      </header>

      <div className="mt-4 flex flex-wrap justify-between gap-4 text-sm">
        <div>
          <p className="text-xl font-semibold">{slip.teacher}</p>
          {teacher.nic && <p>NIC {teacher.nic}</p>}
          {teacher.phone && <p>{teacher.phone}</p>}
        </div>
        <div className="text-right">
          <p>
            <span className="font-medium">{slip.payingStudents}</span> students ·{" "}
            <span className="font-medium">{slip.lineCards}</span> cards
          </p>
          {slip.tierCounts.length > 0 && (
            <p className="text-xs">
              {slip.tierCounts.map((t) => `${t.students} ${t.label.toLowerCase()}`).join(", ")}
            </p>
          )}
        </div>
      </div>

      {empty ? (
        <p className="mt-6 rounded border border-dashed p-4 text-sm">
          No collections recorded for {slip.teacher} in {monthLabel}.
        </p>
      ) : (
        <table className="mt-4 w-full border-collapse text-[11px]">
          <thead>
            <tr className="border-y border-black text-left">
              <th className="py-1.5 pr-2 font-semibold">Course</th>
              <th className="px-2 py-1.5 font-semibold">Month</th>
              <th className="px-2 py-1.5 text-right font-semibold">Cards</th>
              <th className="px-2 py-1.5 text-right font-semibold">Rate</th>
              <th className="px-2 py-1.5 text-right font-semibold">Gross</th>
              <th className="px-2 py-1.5 text-right font-semibold">Inst %</th>
              <th className="px-2 py-1.5 text-right font-semibold">Institute</th>
              <th className="py-1.5 pl-2 text-right font-semibold">Teacher</th>
            </tr>
          </thead>
          <tbody>
            {slip.lines.map((l, i) => (
              <tr key={`${l.courseId}-${l.billingOrder}-${l.rate}-${i}`} className="border-b border-neutral-300">
                <td className="py-1 pr-2">{l.course}</td>
                <td className="px-2 py-1 whitespace-nowrap">{l.billingLabel}</td>
                <td className="px-2 py-1 text-right tabular-nums">{l.cards}</td>
                <td className="px-2 py-1 text-right tabular-nums">{l.rate}</td>
                <td className="px-2 py-1 text-right tabular-nums">{l.gross}</td>
                <td className="px-2 py-1 text-right tabular-nums">{l.sharePercent}%</td>
                <td className="px-2 py-1 text-right tabular-nums">{l.instituteShare}</td>
                <td className="py-1 pl-2 text-right tabular-nums">{l.teacherShare}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-black font-semibold">
              <td className="py-1.5 pr-2" colSpan={2}>Totals</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{slip.lineCards}</td>
              <td className="px-2 py-1.5" />
              <td className="px-2 py-1.5 text-right tabular-nums">{slip.totalCollected}</td>
              <td className="px-2 py-1.5" />
              <td className="px-2 py-1.5 text-right tabular-nums">{slip.totalInstituteShare}</td>
              <td className="py-1.5 pl-2 text-right tabular-nums">{slip.totalTeacherShare}</td>
            </tr>
          </tfoot>
        </table>
      )}

      <div className="mt-5 flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-56 flex-1 text-[11px]">
          <p className="font-semibold">Advances taken</p>
          {slip.advanceLines.length === 0 ? (
            <p className="text-neutral-600">None this month.</p>
          ) : (
            <table className="mt-1 w-full border-collapse">
              <tbody>
                {slip.advanceLines.map((a, i) => (
                  <tr key={i} className="border-b border-neutral-300">
                    <td className="py-1 pr-2 whitespace-nowrap">{a.date}</td>
                    <td className="py-1 pr-2">
                      {a.reason}
                      <span className="block text-neutral-600">authorized by {a.authorizedBy}</span>
                    </td>
                    <td className="py-1 text-right tabular-nums">{a.amount}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="py-1 pr-2" colSpan={2}>Total advances</td>
                  <td className="py-1 text-right tabular-nums">{slip.advances}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>

        <div className="w-72 shrink-0 space-y-1 text-sm">
          <Row label="Cards" value={String(slip.lineCards)} />
          <Row label="Gross collected" value={slip.totalCollected} />
          <Row label="Institute share" value={slip.totalInstituteShare} />
          <Row label="Teacher share" value={slip.totalTeacherShare} />
          <Row label="Advances taken" value={`-${slip.advances}`} />
          <div className="flex justify-between border-t-2 border-black pt-1.5 text-lg font-bold">
            <span>Final salary</span>
            <span className="tabular-nums">{slip.finalSalary}</span>
          </div>
        </div>
      </div>

      <footer className="mt-10 flex justify-between gap-8 text-xs">
        <span className="w-52 border-t border-black pt-1 text-center">Teacher signature</span>
        <span className="w-52 border-t border-black pt-1 text-center">Issued by</span>
      </footer>
    </section>
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
