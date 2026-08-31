"use client";

import { useState } from "react";
import Link from "next/link";
import { Download, IdCard, Receipt, UserRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { to12Hour } from "@/lib/colombo-time";
import type { PaymentHit, StudentHit } from "@/lib/search";
import { downloadReportPdf } from "@/components/reports/report-pdf";

/**
 * Results half of Search. The filters live on the server page as a plain GET
 * form, so a search is a fresh render and this component is keyed on the filter
 * signature — no props synced into state (AGENTS.md rule 17).
 */
export function SearchResults({
  tab,
  students,
  payments,
  searched,
  filterSummary,
}: {
  tab: "students" | "payments";
  students: StudentHit[];
  payments: PaymentHit[];
  searched: boolean;
  /** Rendered into the PDF header so an export says what it is. */
  filterSummary: string;
}) {
  const [exporting, setExporting] = useState(false);

  async function exportPdf() {
    setExporting(true);
    try {
      await downloadReportPdf({
        filename:
          tab === "students"
            ? `xenon-students-${new Date().toISOString().slice(0, 10)}.pdf`
            : `xenon-payments-${new Date().toISOString().slice(0, 10)}.pdf`,
        title: tab === "students" ? "Student search" : "Payment search",
        subtitle: filterSummary,
        tables:
          tab === "students"
            ? [
                {
                  head: ["Name", "Card number", "Grade", "Phone", "School", "Admission", "Enrolments"],
                  body: students.map((s) => [
                    s.name,
                    s.cardNumber ?? "—",
                    s.grade ?? "—",
                    s.phone ?? "—",
                    s.school ?? "—",
                    s.admissionPaid ? "Paid" : "Owing",
                    s.enrolments.join("; ") || "—",
                  ]),
                },
              ]
            : [
                {
                  head: ["Date", "Student", "Card number", "Kind", "Course", "Amount", "Taken by", "Status"],
                  body: payments.map((p) => [
                    `${p.date} ${to12Hour(p.at)}`,
                    p.student,
                    p.cardNumber ?? "—",
                    p.kind,
                    p.course ?? "—",
                    p.amount,
                    p.takenBy,
                    p.cancelled ? "CANCELLED" : "Valid",
                  ]),
                },
              ],
      });
    } finally {
      setExporting(false);
    }
  }

  const rows = tab === "students" ? students.length : payments.length;

  if (!searched) {
    return (
      <p className="bg-secondary text-secondary-foreground rounded-lg px-4 py-3 text-sm">
        {tab === "students"
          ? "Enter a card number (the last few digits are enough), a name, a school, a grade or an NIC."
          : "Enter a student, a date range, a course or a payment kind."}
      </p>
    );
  }

  if (rows === 0) {
    return (
      <p className="bg-secondary text-secondary-foreground rounded-lg px-4 py-3 text-sm">
        Nothing matched those filters.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {rows} {rows === 1 ? "result" : "results"}
          {rows === 100 ? " (showing the first 100 — narrow the filters)" : ""}
        </p>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={exportPdf} disabled={exporting}>
          <Download className="size-3.5" aria-hidden />
          {exporting ? "Preparing…" : "Download PDF"}
        </Button>
      </div>

      {tab === "students" ? (
        <ul className="divide-y rounded-xl border">
          {students.map((s) => (
            <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {s.name}
                  {s.grade && <Badge variant="outline">{s.grade}</Badge>}
                  <Badge variant={s.admissionPaid ? "secondary" : "destructive"}>
                    {s.admissionPaid ? "Admission paid" : "Admission owing"}
                  </Badge>
                </p>
                <p className="text-muted-foreground text-sm">
                  <span className="font-mono">{s.cardNumber ?? "no card number"}</span>
                  {s.phone ? ` · ${s.phone}` : ""}
                  {s.school ? ` · ${s.school}` : ""}
                </p>
                <p className="text-muted-foreground mt-1 text-sm">
                  {s.enrolments.length > 0 ? s.enrolments.join(" · ") : "No active enrolments"}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button asChild size="sm" variant="outline" className="gap-1.5">
                  <Link href={`/students/${s.id}`}>
                    <IdCard className="size-3.5" aria-hidden />
                    Profile
                  </Link>
                </Button>
                <Button asChild size="sm" variant="outline" className="gap-1.5">
                  <Link href={`/registration?studentId=${s.id}`}>
                    <UserRound className="size-3.5" aria-hidden />
                    Edit
                  </Link>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="divide-y rounded-xl border">
          {payments.map((p) => (
            <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {p.student}
                  <Badge variant="outline">{p.kind}</Badge>
                  {p.cancelled && <Badge variant="destructive">Cancelled</Badge>}
                </p>
                <p className="text-muted-foreground text-sm">
                  {p.course ?? "—"}
                </p>
                <p className="text-muted-foreground text-sm">
                  {p.date} {to12Hour(p.at)} · <span className="font-mono">{p.cardNumber ?? "no card"}</span> · taken by {p.takenBy}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-lg font-semibold tabular-nums">{p.amount}</span>
                <Button asChild size="sm" variant="outline" className="gap-1.5">
                  <Link href={`/receipts?key=${encodeURIComponent(p.receiptKey)}&cancelled=1`}>
                    <Receipt className="size-3.5" aria-hidden />
                    Receipt
                  </Link>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
