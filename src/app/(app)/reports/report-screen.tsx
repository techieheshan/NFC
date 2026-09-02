"use client";

import { useState } from "react";
import { Download } from "lucide-react";

import { downloadReportPdf } from "@/components/reports/report-pdf";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { StudentListReport } from "@/lib/report-student-list";

const STATUS: Record<string, { label: string; className: string }> = {
  paid: { label: "Paid", className: "bg-emerald-100 text-emerald-900 border-emerald-300" },
  "not-paid": { label: "Not paid", className: "bg-red-100 text-red-900 border-red-300" },
  free: { label: "Free", className: "bg-muted text-muted-foreground border-border" },
};

/**
 * Results half of the student list report. The PDF is built from these same
 * server-scoped rows, so a teacher's export is their own course and nothing
 * else — there is no second, wider fetch behind the button.
 */
export function ReportScreen({ report }: { report: StudentListReport }) {
  const [exporting, setExporting] = useState(false);

  async function exportPdf() {
    if (!report.course) return;
    setExporting(true);
    try {
      await downloadReportPdf({
        filename: `xenon-student-list-${report.year}-${String(report.month).padStart(2, "0")}.pdf`,
        title: "Student list — paid / not paid",
        subtitle: `${report.course.name} · ${report.course.teacher} · ${report.label} (Asia/Colombo)`,
        tables: [
          {
            head: ["Student", "Card number", "Status"],
            body: report.rows.map((r) => [r.name, r.cardNumber ?? "—", STATUS[r.status].label]),
          },
          {
            title: "Totals",
            head: ["Registered", "Paid", "Not paid", "Free"],
            body: [[
              report.totals.registered, report.totals.paid,
              report.totals.notPaid, report.totals.free,
            ]],
          },
        ],
      });
    } finally {
      setExporting(false);
    }
  }

  if (!report.course) {
    return (
      <p className="bg-secondary text-secondary-foreground rounded-lg px-4 py-3 text-sm">
        {report.blocked
          ? "This login is not linked to a teacher record, so it has no courses."
          : "Pick a course and a month."}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">{report.course.name}</h2>
          <p className="text-muted-foreground text-sm">
            {report.course.teacher} · {report.label}
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={exportPdf} disabled={exporting}>
          <Download className="size-3.5" aria-hidden />
          {exporting ? "Preparing…" : "Download PDF"}
        </Button>
      </div>

      {report.rows.length === 0 ? (
        <p className="text-muted-foreground rounded-xl border p-4 text-sm">
          Nobody is actively enrolled in this course.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground border-b text-left">
              <tr>
                <th className="p-3 font-medium">Student</th>
                <th className="p-3 font-medium">Card number</th>
                <th className="p-3 text-right font-medium">{report.label}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {report.rows.map((r) => (
                <tr key={r.studentId}>
                  <td className="p-3">{r.name}</td>
                  <td className="p-3 font-mono text-xs">{r.cardNumber ?? "—"}</td>
                  <td className="p-3 text-right">
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS[r.status].className}`}>
                      {STATUS[r.status].label}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-muted/40 border-t">
              <tr>
                <td className="p-3 font-medium" colSpan={3}>
                  <span className="flex flex-wrap items-center gap-3">
                    <span>Registered {report.totals.registered}</span>
                    <Badge variant="secondary">Paid {report.totals.paid}</Badge>
                    <Badge variant="destructive">Not paid {report.totals.notPaid}</Badge>
                    <Badge variant="outline">Free {report.totals.free}</Badge>
                    <span className="text-muted-foreground text-xs">
                      {report.totals.reconciles
                        ? "Registered = Paid + Not paid + Free ✓"
                        : "TOTALS DO NOT RECONCILE"}
                    </span>
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
