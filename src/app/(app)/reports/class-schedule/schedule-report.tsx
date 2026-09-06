"use client";

import { useState } from "react";
import { Download } from "lucide-react";

import { downloadReportPdf } from "@/components/reports/report-pdf";
import { Button } from "@/components/ui/button";
import { formatTime } from "@/lib/schedule-time";
import type { ScheduleReport } from "@/lib/report-class-schedule";

/** Renders the schedule the server already scoped; the PDF uses the same rows. */
export function ScheduleScreen({ report, subtitle }: { report: ScheduleReport; subtitle: string }) {
  const [exporting, setExporting] = useState(false);

  async function exportPdf() {
    setExporting(true);
    try {
      await downloadReportPdf({
        filename: `xenon-class-schedule-${new Date().toISOString().slice(0, 10)}.pdf`,
        title: "Weekly class schedule",
        subtitle,
        tables: report.days
          .filter((d) => d.entries.length > 0)
          .map((d) => ({
            title: `${d.label} — ${d.entries.length} ${d.entries.length === 1 ? "class" : "classes"}`,
            head: ["Time", "Course", "Teacher", "Attendance window"],
            body: d.entries.map((e) => [
              `${formatTime(e.startTime)}–${formatTime(e.endTime)}`,
              e.course,
              e.teacher,
              `${formatTime(e.opens)}–${formatTime(e.closes)}`,
            ]),
          })),
      });
    } finally {
      setExporting(false);
    }
  }

  if (report.total === 0) {
    return (
      <p className="bg-secondary text-secondary-foreground rounded-lg px-4 py-3 text-sm">
        {report.blocked
          ? "This login is not linked to a teacher record, so it has no classes."
          : "No active schedules match."}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {report.total} active {report.total === 1 ? "class" : "classes"} a week
        </p>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={exportPdf} disabled={exporting}>
          <Download className="size-3.5" aria-hidden />
          {exporting ? "Preparing…" : "Download PDF"}
        </Button>
      </div>

      {report.days.map((d) => (
        <section key={d.day} className="rounded-xl border">
          <header className="flex items-center justify-between border-b p-3">
            <h2 className="font-medium">{d.label}</h2>
            <span className="text-muted-foreground text-sm">
              {d.entries.length === 0 ? "no classes" : `${d.entries.length}`}
            </span>
          </header>
          {d.entries.length === 0 ? (
            <p className="text-muted-foreground p-3 text-sm">Nothing scheduled.</p>
          ) : (
            <ul className="divide-y">
              {d.entries.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <span className="min-w-0">
                    <span className="block font-medium">{e.course}</span>
                    <span className="text-muted-foreground block text-sm">{e.teacher}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block tabular-nums">
                      {formatTime(e.startTime)}–{formatTime(e.endTime)}
                    </span>
                    <span className="text-muted-foreground block text-xs tabular-nums">
                      attendance {formatTime(e.opens)}–{formatTime(e.closes)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
