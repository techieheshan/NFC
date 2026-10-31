import Link from "next/link";
import { Ban, CheckCircle2 } from "lucide-react";

import { to12Hour } from "@/lib/colombo-time";
import { friendlyDate } from "@/lib/friendly-date";
import { DETAIL_CAP, modeLabel, type DetailRow, type HalfNoChargeReport } from "@/lib/report-half-no-charge";

/**
 * The per-staff counts and the detail list. Everything shown is the server's: nothing is added up
 * here, and the per-staff figures are NOT derived from the (capped) list. Below 640 px the two
 * tables become stacked cards, so nothing scrolls sideways on a phone.
 */
export function HalfNoChargeScreen({ report }: { report: HalfNoChargeReport }) {
  if (report.rowCount === 0) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center">
        <p className="font-medium">Nothing recorded in {report.label}</p>
        <p className="text-muted-foreground mt-1 text-sm">
          No Half or No-charge months were recorded in this month with these filters.
        </p>
      </div>
    );
  }

  const share = (s: { months: number; all: number; percent: number }) => `${s.months} of ${s.all} (${s.percent}%)`;

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="font-medium">By staff — {report.label}</h2>

        {report.staff.length === 0 ? (
          <p className="text-muted-foreground text-sm">Everything in this filter is cancelled, so nothing is counted.</p>
        ) : (
          <>
            <div className="hidden overflow-hidden rounded-xl border sm:block">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="p-3 font-medium">Taken by</th>
                    <th className="p-3 text-right font-medium">Half months</th>
                    <th className="p-3 text-right font-medium">Half amount</th>
                    <th className="p-3 text-right font-medium">No-charge months</th>
                    <th className="p-3 text-right font-medium">Share of their months</th>
                  </tr>
                </thead>
                <tbody>
                  {report.staff.map((s) => (
                    <tr key={s.userId} className="border-t">
                      <td className="p-3 font-medium">{s.name}</td>
                      <td className="p-3 text-right tabular-nums">{s.half}</td>
                      <td className="p-3 text-right tabular-nums">{s.halfAmount}</td>
                      <td className="p-3 text-right tabular-nums">{s.noCharge}</td>
                      <td className="p-3 text-right tabular-nums">{share(s.share)}</td>
                    </tr>
                  ))}
                  <tr className="bg-muted/30 border-t font-semibold">
                    <td className="p-3">Total</td>
                    <td className="p-3 text-right tabular-nums">{report.totals.half}</td>
                    <td className="p-3 text-right tabular-nums">{report.totals.halfAmount}</td>
                    <td className="p-3 text-right tabular-nums">{report.totals.noCharge}</td>
                    <td className="p-3 text-right tabular-nums">
                      {report.totals.half + report.totals.noCharge} of {report.totals.all}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <ul className="space-y-2 sm:hidden">
              {report.staff.map((s) => (
                <li key={s.userId} className="rounded-xl border p-3 text-sm">
                  <p className="font-medium">{s.name}</p>
                  <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1">
                    <dt className="text-muted-foreground">Half months</dt>
                    <dd className="text-right tabular-nums">{s.half} · {s.halfAmount}</dd>
                    <dt className="text-muted-foreground">No-charge months</dt>
                    <dd className="text-right tabular-nums">{s.noCharge}</dd>
                    <dt className="text-muted-foreground">Share of their months</dt>
                    <dd className="text-right tabular-nums">{share(s.share)}</dd>
                  </dl>
                </li>
              ))}
              <li className="bg-muted/30 rounded-xl border p-3 text-sm font-semibold">
                <span className="flex justify-between">
                  <span>Total</span>
                  <span className="tabular-nums">
                    {report.totals.half} Half · {report.totals.noCharge} No charge
                  </span>
                </span>
              </li>
            </ul>
          </>
        )}

        <p className="text-muted-foreground text-xs">
          Counts and totals cover every row in this filter. A No-charge month is saved as 0.00, so no waived
          value is shown. &ldquo;Share of their months&rdquo; is out of all the class months that person took
          in {report.label}, whatever the fee.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Newest first</h2>

        <div className="hidden overflow-hidden rounded-xl border sm:block">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="p-3 font-medium">Recorded</th>
                <th className="p-3 font-medium">Receipt</th>
                <th className="p-3 font-medium">Student</th>
                <th className="p-3 font-medium">Course · month</th>
                <th className="p-3 font-medium">Mode</th>
                <th className="p-3 text-right font-medium">Amount</th>
                <th className="p-3 font-medium">Taken by</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.id} className={`border-t align-top ${r.cancelled ? "text-muted-foreground bg-muted/30" : ""}`}>
                  <td className="p-3 whitespace-nowrap">{recorded(r)}</td>
                  <td className="p-3 whitespace-nowrap"><ReceiptLink row={r} /></td>
                  <td className="p-3">
                    <span className="block break-words">{r.student}</span>
                    <span className="text-muted-foreground block text-xs">{r.cardNumber ?? "no card"}</span>
                  </td>
                  <td className="p-3">
                    <span className="block break-words">{r.course}</span>
                    {r.billing && <span className="text-muted-foreground block text-xs">{r.billing}</span>}
                  </td>
                  <td className="p-3"><Chips row={r} /></td>
                  <td className={`p-3 text-right tabular-nums ${r.cancelled ? "line-through" : ""}`}>{r.amount}</td>
                  <td className="p-3">{r.takenBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ul className="space-y-2 sm:hidden">
          {report.rows.map((r) => (
            <li key={r.id} className={`rounded-xl border p-3 text-sm ${r.cancelled ? "text-muted-foreground bg-muted/30" : "bg-white"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <ReceiptLink row={r} />
                <Chips row={r} />
                <span className="flex-1" />
                <span className={`font-semibold tabular-nums ${r.cancelled ? "line-through" : ""}`}>{r.amount}</span>
              </div>
              <p className="mt-1 break-words">
                {r.student}
                {r.cardNumber ? ` · ${r.cardNumber}` : ""}
              </p>
              <p className="text-muted-foreground break-words">
                {r.course}
                {r.billing ? ` · ${r.billing}` : ""}
              </p>
              <p className="text-muted-foreground text-xs">
                {recorded(r)} · taken by {r.takenBy}
              </p>
            </li>
          ))}
        </ul>

        {report.cancelledCount > 0 && (
          <p className="text-muted-foreground text-xs">
            {report.cancelledCount} cancelled {report.cancelledCount === 1 ? "row is" : "rows are"} shown greyed and counted nowhere.
          </p>
        )}
        {report.capped && (
          <p className="rounded-xl border border-[#E8851C] bg-[#FFF4E5] px-4 py-3 text-sm text-[#4A2600]">
            Showing the newest {DETAIL_CAP} of {report.rowCount} rows. The counts and totals above cover all{" "}
            {report.rowCount}. Choose one person or one kind to narrow the list.
          </p>
        )}
      </section>
    </div>
  );
}

const recorded = (r: DetailRow) => `${friendlyDate(r.date)} ${to12Hour(r.at)}`;

function ReceiptLink({ row }: { row: DetailRow }) {
  return (
    <Link href={`/receipts?key=${encodeURIComponent(row.receiptKey)}&cancelled=1`} className="inline-flex min-h-11 min-w-11 items-center font-mono font-semibold text-[#4C1D95] underline-offset-2 hover:underline sm:min-h-0 sm:min-w-0">
      {row.receipt}
    </Link>
  );
}

/** The mode, and — on a cancelled row — Cancelled: each a word with an icon, never colour alone. */
function Chips({ row }: { row: DetailRow }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {row.mode === "NO_CHARGE" ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-[#2E9E5B] bg-[#D6F2DF] px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-[#0B4A24]">
          <CheckCircle2 className="size-3" aria-hidden />
          {modeLabel("NO_CHARGE")}
        </span>
      ) : (
        <span className="rounded-full bg-[#F1EBFD] px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-[#4C1D95]">{modeLabel("HALF")}</span>
      )}
      {row.cancelled && (
        <span className="inline-flex items-center gap-1 rounded-full border border-[#C0362C] bg-[#FDE7E5] px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-[#7A1A12]">
          <Ban className="size-3" aria-hidden />
          Cancelled
        </span>
      )}
    </span>
  );
}
