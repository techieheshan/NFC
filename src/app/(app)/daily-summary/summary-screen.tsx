"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Download, Wallet } from "lucide-react";

import { downloadReportPdf } from "@/components/reports/report-pdf";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { DailySummary } from "@/lib/reports";

import type { Signer } from "./actions";

const FIELD = "border-input bg-background h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs";

/**
 * The cash-book lines are entered fresh each day, not stored: nothing here is
 * persisted, the three inputs simply flow into the PDF that gets signed and
 * filed — hence no new table. Money uses the same plain-number arithmetic, at
 * 2dp, as the report it extends (lib/reports).
 */
const money = (n: number) => n.toFixed(2);
const num = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function SummaryScreen({
  report,
  signers,
  filterUi,
}: {
  report: DailySummary;
  signers: { prepared: Signer[]; checked: Signer[] };
  filterUi: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  // Cash-book: typed each day, never carried over automatically.
  const [broughtForward, setBroughtForward] = useState("");
  const [preparedBy, setPreparedBy] = useState("");
  const [checkedBy, setCheckedBy] = useState("");

  const bf = num(broughtForward);
  const drawerTotal = money(bf + num(report.totalCollected) - num(report.deductions.total));

  const prepared = signers.prepared.find((u) => u.id === preparedBy);
  const checked = signers.checked.find((u) => u.id === checkedBy);
  // Mandatory: an unsigned cash-book is not a cash-book.
  const signed = Boolean(prepared && checked);

  const rangeLabel =
    report.from === report.to ? report.from : `${report.from} to ${report.to}`;

  const exportPdf = () => {
    // Belt and braces: the button is already disabled until both are chosen.
    if (!prepared || !checked) return;
    setBusy(true);
    startTransition(async () => {
      try {
        await downloadReportPdf({
          filename: `xenon-daily-summary-${report.from}_${report.to}.pdf`,
          title: "Xenon — Daily Summary",
          subtitle:
            `Collected ${rangeLabel} (Asia/Colombo). Cancelled payments excluded. ` +
            `Prepared by ${prepared!.name} · Checked by ${checked!.name}`,
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
              title: "Deductions — what and on whose authority",
              head: ["Date", "Kind", "Person", "Reason", "Authorized by", "Amount"],
              body: report.deductionLines.map((d) => [
                d.date,
                d.kind === "TEACHER_ADVANCE" ? "Teacher advance" : d.isStaffAdvance ? "Staff advance" : "Xenon",
                d.person ?? "—",
                d.reason,
                d.authorizedBy,
                d.amount,
              ]),
            },
            {
              title: "Cash book",
              head: ["Item", "Amount"],
              body: [
                ["Bring-forward", money(bf)],
                ["Total collected", report.totalCollected],
                ["Deductions", `-${report.deductions.total}`],
                ["Drawer total (expected cash)", drawerTotal],
                ["Prepared by", prepared!.name],
                ["Checked by", checked!.name],
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
        <div className="text-right">
          <Button onClick={exportPdf} disabled={busy || !signed} className="gap-2">
            <Download className="size-4" aria-hidden />
            {busy ? "Preparing…" : "Download PDF"}
          </Button>
          {!signed && (
            <p className="text-muted-foreground mt-1.5 text-xs">
              Choose Prepared by and Checked by first.
            </p>
          )}
        </div>
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
              {report.deductionLines.length > 0 && (
                <ul className="space-y-1.5 border-t pt-2">
                  {report.deductionLines.map((d, i) => (
                    <li key={i} className="text-xs">
                      <span className="flex justify-between gap-2">
                        <span className="min-w-0 truncate">
                          {d.person ? `${d.person} — ` : ""}
                          {d.reason}
                        </span>
                        <span className="tabular-nums">{d.amount}</span>
                      </span>
                      <span className="text-muted-foreground block">
                        {d.kind === "TEACHER_ADVANCE" ? "Teacher advance" : d.isStaffAdvance ? "Staff advance" : "Xenon"}
                        {" · authorized by "}
                        {d.authorizedBy}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}

      {/* Cash book — the drawer question, not the profit question. Outside the
          empty-state branch on purpose: a day with no payments still has cash
          in the drawer and still gets signed. */}
      <div className="space-y-4 rounded-xl border p-4">
        <div>
          <h2 className="font-medium">Cash book</h2>
          <p className="text-muted-foreground text-sm">
            Entered fresh each day and printed on the report — nothing here is saved
            or carried forward.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <label htmlFor="bf" className="block text-sm font-medium">Bring-forward</label>
            <input
              id="bf"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              placeholder="0.00"
              className={FIELD}
              value={broughtForward}
              onChange={(e) => setBroughtForward(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">Cash already in the drawer.</p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="prepared" className="block text-sm font-medium">
              Prepared by <span className="text-destructive">*</span>
            </label>
            <select
              id="prepared"
              className={FIELD}
              value={preparedBy}
              onChange={(e) => setPreparedBy(e.target.value)}
              aria-invalid={!prepared}
            >
              <option value="">Select staff…</option>
              {signers.prepared.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
            {signers.prepared.length === 0 && (
              <p className="text-destructive text-xs">No active staff account to prepare this.</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="checked" className="block text-sm font-medium">
              Checked by <span className="text-destructive">*</span>
            </label>
            <select
              id="checked"
              className={FIELD}
              value={checkedBy}
              onChange={(e) => setCheckedBy(e.target.value)}
              aria-invalid={!checked}
            >
              <option value="">Select admin or staff…</option>
              {signers.checked.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.role === "ADMIN" ? "Admin" : "Staff"})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-2 border-t pt-3">
          <Line label="Bring-forward" value={money(bf)} />
          <Line label="Collected" value={report.totalCollected} />
          <Line label="Deductions" value={`-${report.deductions.total}`} muted />
          <div className="flex justify-between border-t pt-2 text-base font-semibold">
            <span>Drawer total</span>
            <span className="tabular-nums">{drawerTotal}</span>
          </div>
          <p className="text-muted-foreground text-xs">
            Bring-forward + Collected &minus; Deductions = the cash that should be in
            the drawer. Net above is the institute&rsquo;s profit for the range — a
            different question.
          </p>
        </div>
      </div>
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
