"use client";

import { useState } from "react";
import { AlertTriangle, Download } from "lucide-react";

import { downloadReportPdf } from "@/components/reports/report-pdf";
import { Button } from "@/components/ui/button";
import type { MonthlyIncome } from "@/lib/report-monthly-income";

/**
 * The month closed off on one screen: who earned what, what the institute kept,
 * and every rupee that left — each with the person who authorised it.
 *
 * Nothing is computed here beyond laying out what the server sent. The shares
 * are the payslip's shares and the profit line is the Payslips admin summary's
 * own figure, so this screen cannot disagree with either.
 */
export function IncomeScreen({ report }: { report: MonthlyIncome }) {
  const [exporting, setExporting] = useState(false);
  const i = report.institute;

  async function exportPdf() {
    setExporting(true);
    try {
      await downloadReportPdf({
        filename: `xenon-month-end-${report.year}-${String(report.month).padStart(2, "0")}.pdf`,
        title: `Month-end roll-up — ${report.label}`,
        subtitle: `By date received (Asia/Colombo) · cancelled excluded · profit ${i.instituteProfit}`,
        tables: [
          {
            title: "Per teacher",
            head: ["Teacher", "Students", "Collected", "Institute share", "Teacher share", "Advances", "Final salary"],
            body: report.byTeacher.map((t) => [
              t.teacher, t.students, t.collected, t.instituteShare, t.teacherShare, t.advances, t.finalSalary,
            ]),
          },
          {
            title: "Institute",
            head: ["Line", "Amount"],
            body: [
              ["Course collections", i.totalCollected],
              ["Teacher share (paid out)", i.totalTeacherShare],
              ["Institute share (kept)", i.totalInstituteShare],
              ["Admission income", i.admissionIncome],
              ["Smart-card income", i.smartCardIncome],
              ["Xenon expenses", `-${i.xenonExpenses}`],
              ["Institute profit", i.instituteProfit],
            ],
          },
          {
            title: "Teacher advances",
            head: ["Date", "Teacher", "Reason", "Authorized by", "Amount"],
            body: report.advances.length
              ? report.advances.map((a) => [a.date, a.teacher, a.reason, a.authorizedBy, a.amount])
              : [["—", "No advances this month", "", "", "0.00"]],
          },
          {
            title: "Xenon expenses",
            head: ["Date", "Reason", "Authorized by", "Staff advance", "Amount"],
            body: report.expenses.length
              ? report.expenses.map((e) => [
                  e.date, e.reason, e.authorizedBy, e.isStaffAdvance ? (e.staff ?? "yes") : "—", e.amount,
                ])
              : [["—", "No expenses this month", "", "", "0.00"]],
          },
        ],
      });
    } finally {
      setExporting(false);
    }
  }

  const broken = !report.reconciles.shares || !report.reconciles.profit;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border p-4">
        <div>
          <p className="text-muted-foreground text-sm">Institute profit for {report.label}</p>
          <p className="text-3xl font-semibold tabular-nums">{i.instituteProfit}</p>
          <p className="text-muted-foreground mt-1 text-xs">
            Institute share + admission + smart card − Xenon expenses. Teacher
            advances are not in it: they reduce a teacher&rsquo;s own salary, not
            institute profit.
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={exportPdf} disabled={exporting}>
          <Download className="size-3.5" aria-hidden />
          {exporting ? "Preparing…" : "Download PDF"}
        </Button>
      </div>

      {broken && (
        <p className="border-destructive/40 bg-destructive/10 text-destructive flex items-center gap-2 rounded-lg border px-4 py-3 text-sm">
          <AlertTriangle className="size-4" aria-hidden />
          {!report.reconciles.shares
            ? "Teacher shares + institute keep do not equal course collections."
            : "The profit line does not rebuild from its parts."}
        </p>
      )}

      <Section title="Per teacher — the same figures as their payslip">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground border-b text-left">
              <tr>
                <th className="p-3 font-medium">Teacher</th>
                <th className="p-3 text-right font-medium">Students</th>
                <th className="p-3 text-right font-medium">Collected</th>
                <th className="p-3 text-right font-medium">Institute</th>
                <th className="p-3 text-right font-medium">Teacher</th>
                <th className="p-3 text-right font-medium">Advances</th>
                <th className="p-3 text-right font-medium">Final salary</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {report.byTeacher.map((t) => (
                <tr key={t.teacherId}>
                  <td className="p-3">{t.teacher}</td>
                  <td className="p-3 text-right tabular-nums">{t.students}</td>
                  <td className="p-3 text-right tabular-nums">{t.collected}</td>
                  <td className="text-muted-foreground p-3 text-right tabular-nums">{t.instituteShare}</td>
                  <td className="p-3 text-right tabular-nums">{t.teacherShare}</td>
                  <td className="text-muted-foreground p-3 text-right tabular-nums">
                    {Number(t.advances) > 0 ? `-${t.advances}` : "—"}
                  </td>
                  <td className="p-3 text-right font-medium tabular-nums">{t.finalSalary}</td>
                </tr>
              ))}
              {report.byTeacher.length === 0 && (
                <tr><td className="text-muted-foreground p-3" colSpan={7}>No collections this month.</td></tr>
              )}
            </tbody>
            <tfoot className="bg-muted/40 border-t">
              <tr className="font-medium">
                <td className="p-3" colSpan={2}>Totals</td>
                <td className="p-3 text-right tabular-nums">{i.totalCollected}</td>
                <td className="p-3 text-right tabular-nums">{i.totalInstituteShare}</td>
                <td className="p-3 text-right tabular-nums">{i.totalTeacherShare}</td>
                <td className="p-3 text-right tabular-nums">{report.advancesTotal}</td>
                <td className="p-3" />
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="text-muted-foreground p-3 pt-0 text-xs">
          {report.reconciles.shares
            ? "Teacher shares + institute keep = course collections ✓"
            : "TOTALS DO NOT RECONCILE"}
          {report.roundingDelta !== "0.00" && (
            <>
              {" "}
              (rounding {report.roundingDelta}: each slip rounds its two halves
              separately)
            </>
          )}
        </p>
      </Section>

      <Section title="Institute">
        <ul className="divide-y text-sm">
          <Line label="Course collections" value={i.totalCollected} />
          <Line label="Teacher share (paid out)" value={i.totalTeacherShare} muted />
          <Line label="Institute share (kept)" value={i.totalInstituteShare} />
          <Line label="Admission income" value={i.admissionIncome} />
          <Line label="Smart-card income" value={i.smartCardIncome} />
          <Line label="Xenon expenses" value={`-${i.xenonExpenses}`} muted />
          <li className="flex justify-between gap-3 p-3 text-base font-semibold">
            <span>Institute profit</span>
            <span className="tabular-nums">{i.instituteProfit}</span>
          </li>
        </ul>
      </Section>

      <Section title={`Teacher advances — ${report.advancesTotal}`}>
        <ul className="divide-y text-sm">
          {report.advances.map((a, n) => (
            <li key={n} className="flex flex-wrap justify-between gap-2 p-3">
              <span className="min-w-0">
                <span className="block font-medium">{a.teacher}</span>
                <span className="text-muted-foreground block text-xs">
                  {a.date} · {a.reason} · authorized by {a.authorizedBy}
                </span>
              </span>
              <span className="tabular-nums">{a.amount}</span>
            </li>
          ))}
          {report.advances.length === 0 && (
            <li className="text-muted-foreground p-3">No advances this month.</li>
          )}
        </ul>
      </Section>

      <Section title={`Xenon expenses — ${report.expensesTotal}`}>
        <ul className="divide-y text-sm">
          {report.expenses.map((e, n) => (
            <li key={n} className="flex flex-wrap justify-between gap-2 p-3">
              <span className="min-w-0">
                <span className="block">{e.reason}</span>
                <span className="text-muted-foreground block text-xs">
                  {e.date} · authorized by {e.authorizedBy}
                  {e.isStaffAdvance ? ` · staff advance${e.staff ? ` to ${e.staff}` : ""}` : ""}
                </span>
              </span>
              <span className="tabular-nums">{e.amount}</span>
            </li>
          ))}
          {report.expenses.length === 0 && (
            <li className="text-muted-foreground p-3">No expenses this month.</li>
          )}
        </ul>
      </Section>
    </div>
  );
}

function Line({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <li className={`flex justify-between gap-3 p-3 ${muted ? "text-muted-foreground" : ""}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </li>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border">
      <h2 className="border-b p-3 font-medium">{title}</h2>
      {children}
    </section>
  );
}
