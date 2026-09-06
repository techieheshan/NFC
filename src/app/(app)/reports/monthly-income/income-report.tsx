"use client";

import { useState } from "react";
import { Download } from "lucide-react";

import { downloadReportPdf } from "@/components/reports/report-pdf";
import { Button } from "@/components/ui/button";
import type { MonthlyIncome } from "@/lib/report-monthly-income";

/**
 * One month, sliced. Every slice is derived from the same rows the total is, so
 * the reconciliation line below is a real check rather than decoration.
 */
export function IncomeScreen({ report }: { report: MonthlyIncome }) {
  const [exporting, setExporting] = useState(false);

  async function exportPdf() {
    setExporting(true);
    try {
      await downloadReportPdf({
        filename: `xenon-income-${report.year}-${String(report.month).padStart(2, "0")}.pdf`,
        title: `Monthly income — ${report.label}`,
        subtitle: `By date received (Asia/Colombo) · cancelled excluded · total ${report.total}`,
        tables: [
          {
            title: "Totals",
            head: ["Class fees", "Admission", "Smart card", "Month total"],
            body: [[report.classTotal, report.admission.total, report.smartCard.total, report.total]],
          },
          {
            title: "Day by day",
            head: ["Day", "Collected"],
            body: report.days.map((d) => [d.label, d.total]),
          },
          {
            title: "By teacher (gross collected on their courses)",
            head: ["Teacher", "Collected"],
            body: [
              ...report.byTeacher.map((t) => [t.teacher, t.total]),
              ...(report.unattributed === "0.00"
                ? []
                : [["Not attributed to a course", report.unattributed]]),
            ],
          },
          {
            title: "By course",
            head: ["Course", "Teacher", "Collected"],
            body: report.byCourse.map((c) => [c.course, c.teacher, c.total]),
          },
          {
            title: "By teacher × day",
            head: ["Teacher", ...report.days.map((d) => d.label), "Total"],
            body: report.matrix.map((m) => [m.teacher, ...m.byDay, m.total]),
          },
        ],
      });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border p-4">
        <div>
          <p className="text-muted-foreground text-sm">Total collected in {report.label}</p>
          <p className="text-3xl font-semibold tabular-nums">{report.total}</p>
          <p className="text-muted-foreground mt-1 text-xs">
            By date received (Asia/Colombo), cancelled excluded.{" "}
            {report.reconciles ? "Day totals sum to the month ✓" : "DAY TOTALS DO NOT RECONCILE"}
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={exportPdf} disabled={exporting}>
          <Download className="size-3.5" aria-hidden />
          {exporting ? "Preparing…" : "Download PDF"}
        </Button>
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        <Tile label="Class fees" value={report.classTotal} />
        <Tile label={`Admission (${report.admission.count})`} value={report.admission.total} />
        <Tile label={`Smart card (${report.smartCard.count})`} value={report.smartCard.total} />
      </section>

      <Section title="Day by day">
        <div className="overflow-x-auto p-3">
          <table className="text-sm">
            <tbody>
              <tr>
                {report.days.map((d) => (
                  <th key={d.date} className="text-muted-foreground px-2 pb-1 text-xs font-medium">
                    {d.label}
                  </th>
                ))}
              </tr>
              <tr>
                {report.days.map((d) => (
                  <td
                    key={d.date}
                    className={`px-2 py-1 text-right tabular-nums ${d.total === "0.00" ? "text-muted-foreground/40" : ""}`}
                  >
                    {d.total}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="By teacher — gross collected on their courses">
        <ul className="divide-y text-sm">
          {report.byTeacher.map((t) => (
            <li key={t.teacherId} className="flex justify-between gap-3 p-3">
              <span>{t.teacher}</span>
              <span className="tabular-nums">{t.total}</span>
            </li>
          ))}
          {report.unattributed !== "0.00" && (
            <li className="text-muted-foreground flex justify-between gap-3 p-3">
              <span>Not attributed to a course</span>
              <span className="tabular-nums">{report.unattributed}</span>
            </li>
          )}
          {report.byTeacher.length === 0 && <li className="text-muted-foreground p-3">No class fees.</li>}
        </ul>
      </Section>

      <Section title="By course">
        <ul className="divide-y text-sm">
          {report.byCourse.map((c) => (
            <li key={c.courseId} className="flex justify-between gap-3 p-3">
              <span className="min-w-0">
                <span className="block truncate">{c.course}</span>
                <span className="text-muted-foreground block text-xs">{c.teacher}</span>
              </span>
              <span className="shrink-0 tabular-nums">{c.total}</span>
            </li>
          ))}
          {report.byCourse.length === 0 && <li className="text-muted-foreground p-3">No class fees.</li>}
        </ul>
      </Section>

      <Section title="By teacher × day">
        <div className="overflow-x-auto p-3">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground text-left">
              <tr>
                <th className="p-2 font-medium">Teacher</th>
                {report.days.map((d) => (
                  <th key={d.date} className="p-1 text-right text-xs font-medium">{d.label}</th>
                ))}
                <th className="p-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {report.matrix.map((m) => (
                <tr key={m.teacherId}>
                  <td className="p-2 whitespace-nowrap">{m.teacher}</td>
                  {m.byDay.map((v, i) => (
                    <td key={i} className={`p-1 text-right tabular-nums ${v === "0.00" ? "text-muted-foreground/30" : ""}`}>
                      {v === "0.00" ? "·" : v}
                    </td>
                  ))}
                  <td className="p-2 text-right font-medium tabular-nums">{m.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border p-4">
      <p className="text-muted-foreground text-sm">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
    </div>
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
