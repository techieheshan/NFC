"use client";

import { useState } from "react";
import { Download } from "lucide-react";

import { downloadReportPdf } from "@/components/reports/report-pdf";
import { Button } from "@/components/ui/button";
import { HallIcon } from "@/lib/hall-icons";
import type { TimetableReport } from "@/lib/report-timetable";

/** Hall × day. Read down a column for a day, across a row for a room. */
export function TimetableScreen({
  report,
  subtitle,
}: {
  report: TimetableReport;
  subtitle: string;
}) {
  const [exporting, setExporting] = useState(false);
  const rows = [...report.rows, ...(report.unassigned ? [report.unassigned] : [])];

  async function exportPdf() {
    setExporting(true);
    try {
      await downloadReportPdf({
        filename: `xenon-timetable-${report.from}.pdf`,
        title: "Timetable by hall",
        subtitle,
        tables: [
          {
            head: ["Hall", ...report.days.map((d) => `${d.label.slice(0, 3)} ${d.date.slice(8)}`)],
            body: rows.map((r) => [
              r.hall?.name ?? "No hall",
              ...r.cells.map((list) =>
                list.length === 0
                  ? "—"
                  : list
                      .map((c) => `${c.startTime}-${c.endTime} ${c.course} (${c.teacher})`)
                      .join("\n"),
              ),
            ]),
          },
        ],
      });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {report.total} {report.total === 1 ? "class" : "classes"} this week
          {report.unassigned && ` · ${report.unassigned.total} with no hall`}
        </p>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={exportPdf} disabled={exporting}>
          <Download className="size-3.5" aria-hidden />
          {exporting ? "Preparing…" : "Download PDF"}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-4xl text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="p-2 font-medium">Hall</th>
              {report.days.map((d) => (
                <th key={d.date} className="p-2 font-medium">
                  {d.label}
                  <span className="text-muted-foreground block text-xs font-normal">{d.date}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.hall?.id ?? "none"} className="align-top">
                <th scope="row" className="p-2 text-left font-medium whitespace-nowrap">
                  <span className="flex items-center gap-2">
                    {r.hall ? (
                      <HallIcon icon={r.hall.icon} className="size-4" />
                    ) : null}
                    {r.hall?.name ?? "No hall"}
                  </span>
                  <span className="text-muted-foreground block text-xs font-normal">{r.total}/week</span>
                </th>
                {r.cells.map((list, i) => (
                  <td key={report.days[i].date} className="p-2">
                    {list.length === 0 ? (
                      <span className="text-muted-foreground/40">·</span>
                    ) : (
                      <ul className="space-y-1.5">
                        {list.map((c) => (
                          <li key={c.key}>
                            <span className="block tabular-nums">{c.startTime}–{c.endTime}</span>
                            <span className="block">{c.course}</span>
                            <span className="text-muted-foreground block text-xs">
                              {c.teacher}
                              {c.overridden && " · moved here for the day"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="text-muted-foreground p-4" colSpan={8}>
                  No classes this week.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
