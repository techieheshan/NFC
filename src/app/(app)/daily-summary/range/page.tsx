import Link from "next/link";
import { ChevronDown, ChevronUp, Download, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { requireNavAccess } from "@/lib/authz";
import { decimalToCents, formatDeduction, formatMoney } from "@/lib/cents";
import { dayLabelShort } from "@/lib/daily-summary-dates";

import { loadRangeBundle } from "../bundle";
import { cancelledLine, deductionKind } from "../document/model";
import { ADMISSION_NOTE, ofWhichLines, smartCardLabel } from "../extra-lines";

export const metadata = { title: "Daily Summary, several days" };

const FIELD = "border-input bg-background h-11 w-full rounded-md border px-3 text-base shadow-xs";
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * "Several days": a quick look, view only. The cash book, the bank lines and the signatures belong to ONE day
 * (rule 24), so there are none here; the document for a range has neither. Dates are validated (a real day in
 * 2000..2100, else today; a range longer than a year is cut), and the per-day figures come from ONE helper
 * that is proven equal to `dailySummary()` for every day.
 */
export default async function RangePage({ searchParams }: PageProps<"/daily-summary/range">) {
  await requireNavAccess("/daily-summary");

  const q = await searchParams;
  const b = await loadRangeBundle(first(q.from), first(q.to));
  const r = b.report;
  const lines = ofWhichLines(r);
  const cancelled = cancelledLine(b.cancelled);
  const withPayments = r.courses.filter((c) => c.paidFull + c.paidHalf + c.paidQuarter > 0 || decimalToCents(c.amount) > 0);
  const noPayments = r.courses.filter((c) => !withPayments.includes(c));
  const docQuery = `from=${b.from}&to=${b.to}`;
  const btn = "flex h-12 items-center justify-center gap-2 rounded-md text-base font-medium";

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Daily Summary</h1>

      <form method="get" className="bg-muted/40 grid grid-cols-2 gap-3 rounded-xl border p-3">
        <div>
          <label htmlFor="from" className="block text-sm font-medium">From</label>
          <input id="from" name="from" type="date" className={`${FIELD} mt-1`} defaultValue={b.from} />
        </div>
        <div>
          <label htmlFor="to" className="block text-sm font-medium">To</label>
          <input id="to" name="to" type="date" className={`${FIELD} mt-1`} defaultValue={b.to} />
        </div>
        <Button type="submit" variant="secondary" className="col-span-2 h-11">Apply</Button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={`/daily-summary?date=${b.to}`} className="text-primary text-sm font-medium underline-offset-4 hover:underline">One day</Link>
        <span className="bg-muted text-muted-foreground rounded-full px-3 py-1 text-sm font-medium">Range, view only</span>
      </div>
      {b.clamped && <p role="status" className="text-sm text-amber-800">That range is longer than a year, so it was cut to {dayLabelShort(b.from)} – {dayLabelShort(b.to)}.</p>}

      <p className="text-muted-foreground text-sm">{dayLabelShort(b.from)} – {dayLabelShort(b.to)}</p>

      <section aria-label="Totals" className="grid grid-cols-1 gap-3 rounded-xl border p-4">
        <Hero label="Total collected" value={formatMoney(r.totalCollected)} />
        <Hero label="Deductions" value={formatDeduction(r.deductions.total)} />
        <Hero label="Net" value={formatMoney(r.net)} strong />
      </section>

      <section aria-label="Day by day" className="rounded-xl border">
        <h2 className="px-4 pt-3 text-sm font-semibold">Day by day</h2>
        <ul className="divide-y">
          {b.byDay.days.map((d) => (
            <li key={d.date} className="flex items-center justify-between gap-3 px-4 py-2">
              <span className="min-w-0">
                <span className="block text-sm font-medium">{dayLabelShort(d.date)}</span>
                <span className="text-muted-foreground block text-xs">Collected {formatMoney(d.collected)} · Deductions {formatDeduction(d.deductions)}</span>
              </span>
              <span className="shrink-0 text-lg font-semibold tabular-nums">{formatMoney(d.net)}</span>
            </li>
          ))}
          <li className="bg-primary/10 flex items-center justify-between gap-3 px-4 py-3">
            <span className="min-w-0">
              <span className="block text-sm font-semibold">Total</span>
              <span className="text-muted-foreground block text-xs">Collected {formatMoney(b.byDay.total.collected)} · Deductions {formatDeduction(b.byDay.total.deductions)}</span>
            </span>
            <span className="shrink-0 text-lg font-semibold tabular-nums">{formatMoney(b.byDay.total.net)}</span>
          </li>
        </ul>
      </section>

      <section className="space-y-1 rounded-xl border p-4">
        <h2 className="pb-1 text-sm font-semibold">Other income and totals</h2>
        <Row label="Class fees" value={formatMoney(r.classTotal)} />
        {lines.map((l) => <Row key={l.key} sub label={l.label} value={l.total} />)}
        <Row label={`Admission (${r.admission.count})`} value={formatMoney(r.admission.total)} />
        <p className="text-muted-foreground pl-4 text-xs">{ADMISSION_NOTE}</p>
        <Row label={smartCardLabel(r.smartCard.count)} value={formatMoney(r.smartCard.total)} />
        <Row strong label="Total collected" value={formatMoney(r.totalCollected)} />
        {cancelled && <p className="text-muted-foreground pt-1 text-xs">{cancelled}</p>}
      </section>

      <section className="space-y-1 rounded-xl border p-4">
        <h2 className="pb-1 text-sm font-semibold">Deductions</h2>
        <Row label="Teacher advances" value={formatDeduction(r.deductions.teacherAdvances)} />
        <Row label="Xenon expenses" value={formatDeduction(r.deductions.xenonExpenses)} />
        <p className="text-muted-foreground pt-1 text-xs">Staff advances are inside Xenon expenses.</p>
        <details className="group pt-2">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm font-medium [&::-webkit-details-marker]:hidden">
            <span>Every deduction ({r.deductionLines.length})</span>
            <ChevronDown className="text-muted-foreground size-4 group-open:hidden" aria-hidden />
            <ChevronUp className="text-muted-foreground hidden size-4 group-open:block" aria-hidden />
          </summary>
          <ul className="space-y-2 pb-1">
            {r.deductionLines.map((d, i) => (
              <li key={i} className="text-sm">
                <span className="flex justify-between gap-3"><span className="min-w-0 break-words">{d.person ? `${d.person} — ` : ""}{d.reason}</span><span className="shrink-0 tabular-nums">{formatMoney(d.amount)}</span></span>
                <span className="text-muted-foreground block text-xs">{d.date} · {deductionKind(d)} · Authorised by {d.authorizedBy}</span>
              </li>
            ))}
          </ul>
        </details>
      </section>

      <section className="rounded-xl border px-4">
        <details className="group">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between text-sm font-semibold [&::-webkit-details-marker]:hidden">
            <span>By course</span>
            <ChevronDown className="text-muted-foreground size-4 group-open:hidden" aria-hidden />
            <ChevronUp className="text-muted-foreground hidden size-4 group-open:block" aria-hidden />
          </summary>
          <ul className="space-y-3 pb-3">
            {withPayments.map((c) => (
              <li key={c.courseId} className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block break-words text-sm font-medium">{c.course}</span>
                  <span className="text-muted-foreground block break-words text-xs">{c.teacher}</span>
                  <span className="text-muted-foreground block text-xs">{c.paidFull + c.paidHalf + c.paidQuarter} paid · Full {c.paidFull}{c.paidHalf > 0 ? ` · Half ${c.paidHalf}` : ""} · 25% {c.paidQuarter} · {c.free} free</span>
                </span>
                <span className="shrink-0 text-sm font-medium tabular-nums">{formatMoney(c.amount)}</span>
              </li>
            ))}
            {noPayments.length > 0 && <li className="text-muted-foreground break-words text-xs">No payments: {noPayments.map((c) => c.course).join(", ")}</li>}
          </ul>
        </details>
      </section>

      <p className="text-muted-foreground text-sm">A range is a quick look. The cash book and signatures belong to a single day.</p>

      <div className="grid grid-cols-2 gap-3 pb-6">
        <Link href={`/daily-summary/document?${docQuery}&auto=print`} className={`${btn} border-input bg-background border`}><Printer className="size-5" aria-hidden />Print</Link>
        <Link href={`/daily-summary/document?${docQuery}&auto=pdf`} className={`${btn} bg-primary text-primary-foreground`}><Download className="size-5" aria-hidden />Download PDF</Link>
      </div>
    </div>
  );
}

function Hero({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-sm">{label}</span>
      <span className={`tabular-nums ${strong ? "text-2xl font-semibold" : "text-lg font-semibold"}`}>{value}</span>
    </div>
  );
}

function Row({ label, value, sub, strong }: { label: string; value: string; sub?: boolean; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 text-sm ${sub ? "text-muted-foreground pl-4" : ""} ${strong ? "border-t pt-1 font-semibold" : ""}`}>
      <span className="min-w-0 break-words">{label}</span>
      <span className="shrink-0 tabular-nums">{value}</span>
    </div>
  );
}
