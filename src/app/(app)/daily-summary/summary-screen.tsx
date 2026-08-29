"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Download, Wallet } from "lucide-react";

import { downloadReportPdf } from "@/components/reports/report-pdf";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { DailySummary } from "@/lib/reports";

export function SummaryScreen({
  report,
  filterUi,
}: {
  report: DailySummary;
  filterUi: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  const rangeLabel =
    report.from === report.to ? report.from : `${report.from} to ${report.to}`;

  const exportPdf = () => {
    setBusy(true);
    startTransition(async () => {
      try {
        await downloadReportPdf({
          filename: `xenon-daily-summary-${report.from}_${report.to}.pdf`,
          title: "Xenon — Daily Summary",
          subtitle: `Collected ${rangeLabel} (Asia/Colombo). Cancelled payments excluded.`,
          tables: [
            {
              title: "Per course",
              head: ["Course", "Teacher", "Registered", "Full", "Half", "25%", "Not paid", "Free", "Amount"],
              body: report.courses.map((c) => [
                c.course, c.teacher, c.registered, c.paidFull, c.paidHalf,
                c.paidQuarter, c.notPaid, c.free, c.amount,
              ]),
            },
            {
              title: "Other income",
              head: ["Line", "Count", "Total"],
              body: [
                ["Admission", report.admission.count, report.admission.total],
                ["Smart card", report.smartCard.count, report.smartCard.total],
                ["Class fees", "—", report.classTotal],
              ],
            },
            {
              title: "Totals",
              head: ["Item", "Amount"],
              body: [
                ["Total collected", report.totalCollected],
                ["Teacher advances", `-${report.deductions.teacherAdvances}`],
                ["Xenon expenses", `-${report.deductions.xenonExpenses}`],
                ["Net", report.net],
              ],
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
          <h1 className="text-2xl font-semibold tracking-tight">Daily Summary</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Money collected {rangeLabel} · Asia/Colombo · cancelled excluded
          </p>
        </div>
        <Button onClick={exportPdf} disabled={busy} className="gap-2">
          <Download className="size-4" aria-hidden />
          {busy ? "Preparing…" : "Download PDF"}
        </Button>
      </div>

      {filterUi}

      {report.courses.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <Wallet className="text-muted-foreground mx-auto size-8" aria-hidden />
          <p className="mt-3 font-medium">Nothing to show</p>
          <p className="text-muted-foreground mt-1 text-sm">No courses or payments in this range.</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Course</TableHead>
                  <TableHead className="text-right">Registered</TableHead>
                  <TableHead className="text-right">Full</TableHead>
                  <TableHead className="text-right">Half</TableHead>
                  <TableHead className="text-right">25%</TableHead>
                  <TableHead className="text-right">Not paid</TableHead>
                  <TableHead className="text-right">Free</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.courses.map((c) => (
                  <TableRow key={c.courseId}>
                    <TableCell className="max-w-72">
                      <div className="truncate font-medium" title={c.course}>{c.course}</div>
                      <div className="text-muted-foreground text-xs">{c.teacher}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{c.registered}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.paidFull}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.paidHalf}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.paidQuarter}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.notPaid}</TableCell>
                    <TableCell className="text-muted-foreground text-right tabular-nums">{c.free}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{c.amount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <p className="text-muted-foreground text-xs">
            Each row reconciles: Registered = Full + Half + 25% paid, plus Not paid, plus Free.
            {unreconciled > 0 && (
              <span className="text-destructive ml-1 inline-flex items-center gap-1">
                <AlertTriangle className="size-3" aria-hidden />
                {unreconciled} row(s) do not — a payment used a tier outside Full/Half/25%.
              </span>
            )}
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 rounded-xl border p-4">
              <p className="text-sm font-medium">Other income</p>
              <Line label={`Admission (${report.admission.count})`} value={report.admission.total} />
              <Line label={`Smart card (${report.smartCard.count})`} value={report.smartCard.total} />
              <Line label="Class fees" value={report.classTotal} />
            </div>

            <div className="space-y-2 rounded-xl border p-4">
              <p className="text-sm font-medium">Totals</p>
              <Line label="Total collected" value={report.totalCollected} />
              <Line label="Teacher advances" value={`-${report.deductions.teacherAdvances}`} muted />
              <Line label="Xenon expenses" value={`-${report.deductions.xenonExpenses}`} muted />
              <div className="flex justify-between border-t pt-2 text-base font-semibold">
                <span>Net</span>
                <span className="tabular-nums">{report.net}</span>
              </div>
              <p className="text-muted-foreground text-xs">
                Staff advances sit inside Xenon expenses and are counted once.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Line({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`flex justify-between text-sm ${muted ? "text-muted-foreground" : ""}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
