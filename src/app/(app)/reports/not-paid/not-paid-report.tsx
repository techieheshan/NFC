"use client";

import { useState } from "react";
import { Download } from "lucide-react";

import { downloadReportPdf } from "@/components/reports/report-pdf";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { NotPaidReport } from "@/lib/report-not-paid";

/** The collections work-list. The PDF is the same rows, same filters. */
export function NotPaidScreen({ report, subtitle }: { report: NotPaidReport; subtitle: string }) {
  const [exporting, setExporting] = useState(false);

  async function exportPdf() {
    setExporting(true);
    try {
      await downloadReportPdf({
        filename: `xenon-not-paid-${report.year}-${String(report.month).padStart(2, "0")}.pdf`,
        title: `Not paid — ${report.label}`,
        subtitle,
        tables: [
          {
            head: ["Student", "Card number", "Phone", "Course", "Teacher"],
            body: report.rows.map((r) => [
              r.student, r.cardNumber ?? "—", r.phone ?? "—", r.course, r.teacher,
            ]),
          },
          {
            title: "Non-payers per course",
            head: ["Course", "Teacher", "Not paid"],
            body: report.perCourse.map((c) => [c.course, c.teacher, c.count]),
          },
        ],
      });
    } finally {
      setExporting(false);
    }
  }

  if (report.total === 0) {
    return (
      <p className="bg-secondary text-secondary-foreground rounded-lg px-4 py-3 text-sm">
        Nobody owes {report.label} for this selection.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm">
          <Badge variant="destructive">{report.total} not paid</Badge>
          <span className="text-muted-foreground">for {report.label}</span>
        </p>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={exportPdf} disabled={exporting}>
          <Download className="size-3.5" aria-hidden />
          {exporting ? "Preparing…" : "Download PDF"}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="text-muted-foreground border-b text-left">
            <tr>
              <th className="p-3 font-medium">Student</th>
              <th className="p-3 font-medium">Card number</th>
              <th className="p-3 font-medium">Phone</th>
              <th className="p-3 font-medium">Course</th>
              <th className="p-3 font-medium">Teacher</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {report.rows.map((r) => (
              <tr key={`${r.studentId}:${r.courseId}`}>
                <td className="p-3">{r.student}</td>
                <td className="p-3 font-mono text-xs">{r.cardNumber ?? "—"}</td>
                <td className="p-3 tabular-nums">{r.phone ?? "—"}</td>
                <td className="p-3">{r.course}</td>
                <td className="text-muted-foreground p-3">{r.teacher}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="rounded-xl border">
        <h2 className="border-b p-3 font-medium">Non-payers per course</h2>
        <ul className="divide-y text-sm">
          {report.perCourse.map((c) => (
            <li key={c.courseId} className="flex items-center justify-between gap-3 p-3">
              <span className="min-w-0">
                <span className="block truncate">{c.course}</span>
                <span className="text-muted-foreground block text-xs">{c.teacher}</span>
              </span>
              <Badge variant="destructive">{c.count}</Badge>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
