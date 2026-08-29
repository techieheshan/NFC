"use client";

import { useState, useTransition } from "react";
import { Download, Lock, Receipt } from "lucide-react";

import { downloadReportPdf } from "@/components/reports/report-pdf";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

import type { PayslipView } from "./actions";

export function PayslipsScreen({
  view,
  filterUi,
}: {
  view: PayslipView;
  filterUi: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const { report, canSeeInstitute, scopedToOwnSlip, lockedMonthLabel } = view;

  const exportPdf = () => {
    setBusy(true);
    startTransition(async () => {
      try {
        const tables = report.slips.flatMap((s) => [
          {
            title: `${s.teacher} — ${report.label}`,
            head: ["Course", "Share %", "Paying students", "Collected", "Institute share", "Teacher share"],
            body: [
              ...s.courses.map((c) => [
                c.course, `${c.sharePercent}%`, c.payingStudents,
                c.collected, c.instituteShare, c.teacherShare,
              ]),
              ["TOTAL", "", "", s.totalCollected, s.totalInstituteShare, s.totalTeacherShare],
              ["Advances", "", "", "", "", `-${s.advances}`],
              ["FINAL SALARY", "", "", "", "", s.finalSalary],
            ],
          },
        ]);

        if (canSeeInstitute && report.institute) {
          const i = report.institute;
          tables.push({
            title: "Institute summary",
            head: ["Item", "Amount"],
            body: [
              ["Class fees collected", i.totalCollected],
              ["Institute share of class fees", i.totalInstituteShare],
              ["Teacher shares (paid out)", i.totalTeacherShare],
              ["Admission income (kept in full)", i.admissionIncome],
              ["Smart-card income (kept in full)", i.smartCardIncome],
              ["Teacher advances (not in profit)", i.teacherAdvances],
              ["Xenon expenses", `-${i.xenonExpenses}`],
              ["INSTITUTE PROFIT", i.instituteProfit],
            ],
          });
        }

        await downloadReportPdf({
          filename: `xenon-payslips-${report.year}-${String(report.month).padStart(2, "0")}.pdf`,
          title: scopedToOwnSlip ? "Xenon — Payslip" : "Xenon — Payslips",
          subtitle: `${report.label} · cash basis (paidAt) · Asia/Colombo`,
          tables,
        });
      } finally {
        setBusy(false);
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {scopedToOwnSlip ? "My payslip" : "Payslips"}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {report.label} · counted by when the money arrived
            {scopedToOwnSlip && lockedMonthLabel && (
              <span className="ml-1 inline-flex items-center gap-1">
                <Lock className="size-3" aria-hidden />
                last completed month only
              </span>
            )}
          </p>
        </div>
        <Button
          onClick={exportPdf}
          disabled={busy || report.slips.length === 0}
          className="gap-2"
        >
          <Download className="size-4" aria-hidden />
          {busy ? "Preparing…" : "Download PDF"}
        </Button>
      </div>

      {filterUi}

      {report.slips.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <Receipt className="text-muted-foreground mx-auto size-8" aria-hidden />
          <p className="mt-3 font-medium">Nothing for {report.label}</p>
          <p className="text-muted-foreground mt-1 text-sm">No teachers to show.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {report.slips.map((s) => (
            <div key={s.teacherId} className="overflow-hidden rounded-xl border">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-4 py-3">
                <p className="font-medium">{s.teacher}</p>
                <p className="text-sm">
                  Final salary{" "}
                  <span className="text-base font-semibold tabular-nums">{s.finalSalary}</span>
                </p>
              </div>

              {s.courses.length === 0 ? (
                <p className="text-muted-foreground px-4 py-4 text-sm">
                  No collections in {report.label}.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Course</TableHead>
                        <TableHead className="text-right">Share %</TableHead>
                        <TableHead className="text-right">Students</TableHead>
                        <TableHead className="text-right">Collected</TableHead>
                        <TableHead className="text-right">Institute</TableHead>
                        <TableHead className="text-right">Teacher</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {s.courses.map((c) => (
                        <TableRow key={c.courseId}>
                          <TableCell className="max-w-72 truncate" title={c.course}>
                            {c.course}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-right tabular-nums">
                            {c.sharePercent}%
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{c.payingStudents}</TableCell>
                          <TableCell className="text-right tabular-nums">{c.collected}</TableCell>
                          <TableCell className="text-muted-foreground text-right tabular-nums">
                            {c.instituteShare}
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {c.teacherShare}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              <div className="space-y-1 border-t px-4 py-3 text-sm">
                <Row label="Collected" value={s.totalCollected} />
                <Row label="Institute share" value={`-${s.totalInstituteShare}`} muted />
                <Row label="Teacher share" value={s.totalTeacherShare} />
                <Row label="Advances taken" value={`-${s.advances}`} muted />
                <div className="flex justify-between border-t pt-1.5 font-semibold">
                  <span>Final salary</span>
                  <span className="tabular-nums">{s.finalSalary}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {canSeeInstitute && report.institute && (
        <div className="space-y-2 rounded-xl border p-4">
          <div className="flex items-center gap-2">
            <p className="font-medium">Institute summary</p>
            <Badge variant="secondary">Admin only</Badge>
          </div>
          <Row label="Class fees collected" value={report.institute.totalCollected} />
          <Row label="Institute share of class fees" value={report.institute.totalInstituteShare} />
          <Row label="Teacher shares (paid out)" value={report.institute.totalTeacherShare} muted />
          <Row label="Admission income" value={report.institute.admissionIncome} />
          <Row label="Smart-card income" value={report.institute.smartCardIncome} />
          <Row label="Xenon expenses" value={`-${report.institute.xenonExpenses}`} muted />
          <div className="flex justify-between border-t pt-2 text-base font-semibold">
            <span>Institute profit</span>
            <span className="tabular-nums">{report.institute.instituteProfit}</span>
          </div>
          <p className="text-muted-foreground pt-1 text-xs">
            Profit = institute share of class fees + admission + smart-card
            income − Xenon expenses. Admission and smart-card money is kept whole
            (no teacher split). Teacher advances ({report.institute.teacherAdvances})
            are deliberately excluded — they reduce a teacher&apos;s own salary, not
            institute profit. Staff advances sit inside Xenon expenses, counted once.
          </p>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`flex justify-between ${muted ? "text-muted-foreground" : ""}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
