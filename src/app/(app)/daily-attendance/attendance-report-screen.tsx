"use client";

import Link from "next/link";

import { useState, useTransition } from "react";
import { AlertTriangle, ChevronRight, ClipboardList, Download } from "lucide-react";

import { MonthStateBoxes } from "@/components/attendance/month-state";
import { downloadReportPdf } from "@/components/reports/report-pdf";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
              head: ["Course", "Teacher", "Session", "Attended", "Absent", "Total", `Paid ${report.monthLabel}`, "Not paid", "Overdue", "Free"],
              body: report.courses.map((c) => [
                c.course, c.teacher, c.sessions.join(" + "),
                c.attended, c.absent, c.total,
                c.states.paid, c.states.notPaid, c.states.overdue, c.states.free,
              ]),
            },
          ],
        });
      } finally {
        setBusy(false);
      }
    });
  };

  const unreconciled = report.courses.filter((c) => !c.statesReconcile).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Daily Attendance</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {report.date} ({report.dayLabel})
            {report.scoped && " · your courses only"}
          </p>
          <p className="text-muted-foreground text-xs">
            Attendance: selected day. Payments: {report.monthLabel}.
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
          {/*
            One card per course instead of a seven-column table: the table made a
            phone scroll sideways. Same cards in a grid on wider screens, so there
            is one layout to keep right rather than two.
          */}
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {report.courses.map((c) => (
              <li key={c.courseId}>
                {/* The whole card opens that class's own list: who came, who did
                    not, and who owes. */}
                <Link
                  href={`/daily-attendance/${c.courseId}?date=${report.date}`}
                  className="bg-card hover:border-primary focus-visible:ring-ring block min-h-12 space-y-3 rounded-xl border p-4 transition-colors focus-visible:ring-2 focus-visible:outline-none"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-lg leading-snug font-semibold break-words">{c.course}</p>
                      <p className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-sm">
                        {c.teacher}
                        {c.sessions.includes("additional") && (
                          <Badge variant="outline">Additional</Badge>
                        )}
                      </p>
                    </div>
                    <ChevronRight className="text-muted-foreground mt-1 size-5 shrink-0" aria-hidden />
                  </div>

                  <p className="text-sm tabular-nums">
                    Attended <span className="font-semibold">{c.attended}</span>
                    <span className="text-muted-foreground"> · </span>
                    Absent <span className="font-semibold">{c.absent}</span>
                    <span className="text-muted-foreground"> · </span>
                    Total <span className="font-semibold">{c.total}</span>
                  </p>

                  <MonthStateBoxes counts={c.states} />
                </Link>
              </li>
            ))}
          </ul>

          <p className="text-muted-foreground text-xs">
            Total = Paid + Not paid + Overdue + Free. Overdue means this month and
            last month are both unpaid. Free enrolments generate no payment row, so
            they are counted separately rather than as debtors.
            {unreconciled > 0 && (
              <span className="text-destructive ml-1 inline-flex items-center gap-1">
                <AlertTriangle className="size-3" aria-hidden />
                {unreconciled} card(s) do not add up.
              </span>
            )}
          </p>
        </>
      )}
    </div>
  );
}
