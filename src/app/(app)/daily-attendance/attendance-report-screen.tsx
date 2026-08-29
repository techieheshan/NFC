"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, ClipboardList, Download } from "lucide-react";

import { downloadReportPdf } from "@/components/reports/report-pdf";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { DailyAttendance } from "@/lib/reports";

export function AttendanceReportScreen({
  report,
  filterUi,
}: {
  report: DailyAttendance;
  filterUi: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  const exportPdf = () => {
    setBusy(true);
    startTransition(async () => {
      try {
        await downloadReportPdf({
          filename: `xenon-daily-attendance-${report.date}.pdf`,
          title: "Xenon — Daily Attendance",
          subtitle:
            `${report.date} (${report.dayLabel}) · attendance for the day, ` +
            `payment status for ${report.monthLabel}` +
            (report.scoped ? " · your courses only" : ""),
          tables: [
            {
              head: ["Course", "Teacher", "Session", "Attended", "Absent", "Total", `Paid ${report.monthLabel}`, "Not paid", "Free"],
              body: report.courses.map((c) => [
                c.course, c.teacher, c.sessions.join(" + "),
                c.attended, c.absent, c.total, c.paid, c.notPaid, c.free,
              ]),
            },
          ],
        });
      } finally {
        setBusy(false);
      }
    });
  };

  const unreconciled = report.courses.filter((c) => !c.reconciles).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Daily Attendance</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {report.date} ({report.dayLabel})
            {report.scoped && " · your courses only"}
          </p>
        </div>
        <Button
          onClick={exportPdf}
          disabled={busy || report.courses.length === 0}
          className="gap-2"
        >
          <Download className="size-4" aria-hidden />
          {busy ? "Preparing…" : "Download PDF"}
        </Button>
      </div>

      {filterUi}

      {/* The two halves of this table answer different questions — say so. */}
      <p className="bg-secondary text-secondary-foreground rounded-lg px-4 py-3 text-sm">
        <strong>Attended / absent / total</strong> are for the selected day.{" "}
        <strong>Paid / not paid / free</strong> are the monthly status for{" "}
        <strong>{report.monthLabel}</strong>.
      </p>

      {report.courses.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <ClipboardList className="text-muted-foreground mx-auto size-8" aria-hidden />
          <p className="mt-3 font-medium">No classes on this day</p>
          <p className="text-muted-foreground mt-1 text-sm">
            {report.scoped
              ? "None of your courses had a session."
              : "No active schedule for this weekday and no additional classes."}
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Course</TableHead>
                  <TableHead className="text-right">Attended</TableHead>
                  <TableHead className="text-right">Absent</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Not paid</TableHead>
                  <TableHead className="text-right">Free</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.courses.map((c) => (
                  <TableRow key={c.courseId}>
                    <TableCell className="max-w-72">
                      <div className="truncate font-medium" title={c.course}>{c.course}</div>
                      <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
                        {c.teacher}
                        {c.sessions.includes("additional") && (
                          <Badge variant="outline">Additional</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{c.attended}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.absent}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.total}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.paid}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.notPaid}</TableCell>
                    <TableCell className="text-muted-foreground text-right tabular-nums">{c.free}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <p className="text-muted-foreground text-xs">
            Total = Paid + Not paid + Free. Free enrolments generate no payment row,
            so they are counted separately rather than as debtors.
            {unreconciled > 0 && (
              <span className="text-destructive ml-1 inline-flex items-center gap-1">
                <AlertTriangle className="size-3" aria-hidden />
                {unreconciled} row(s) do not reconcile.
              </span>
            )}
          </p>
        </>
      )}
    </div>
  );
}
