import { notFound, redirect } from "next/navigation";

import { requireNavAccess } from "@/lib/authz";
import { computeCashFlow } from "@/lib/cash-flow";
import { decimalToCents } from "@/lib/cents";
import { colomboNow } from "@/lib/colombo-time";
import { resolveRange } from "@/lib/daily-summary-dates";
import { liveFromBundle } from "@/lib/saved-day/live";
import { loadSavedDayAs } from "@/lib/saved-day/store";

import { loadDayBundle, loadRangeBundle } from "../bundle";
import { noticeKeys } from "../notices";
import { parseTypedState, typedQuery } from "../typed-state";
import { DocumentView } from "./document-view";
import { sinhala } from "./fonts";
import { buildDocModel } from "./model";

export const metadata = { title: "Daily Summary" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * The Daily Summary as paper: fixed A4 sheets (see `document-view.tsx`).
 *
 * A normal page route, like the payslip voucher — nothing is portalled, so there is nothing to unmount before the print preview has
 * composed the page (the receipt's old blank-preview bug). ADMIN and STAFF only (the same nav guard as the Daily Summary itself); a
 * TEACHER gets the not-found screen.
 *
 *   ?date=YYYY-MM-DD   one day. A SAVED day is printed from the saved version (the frozen figures, the stored bank rows, the frozen
 *                      names, "Saved, version N", and the change log from version 2); any other day is a DRAFT built from the live
 *                      data and the bring-forward and bank lines typed in the address (`bf`, `b`), "Draft, not saved".
 *   ?from=…&to=…       several days: no cash book, no signatures, never saved
 *   &auto=print | pdf  run that action as soon as the sheets are ready
 *
 * Printing needs no signatures: a draft has empty signature boxes, a saved day shows Prepared by (version 1's Done by) and, once an
 * admin has checked it, Checked by; otherwise "Not checked". Everything in the URL is hostile input: dates are validated and amounts
 * re-parsed as cents. The PDF is never stored: it is drawn from this page whenever someone prints or downloads.
 */
export default async function DocumentPage({ searchParams }: PageProps<"/daily-summary/document">) {
  const user = await requireNavAccess("/daily-summary");
  if (user.role === "TEACHER") notFound();

  const q = await searchParams;
  const auto = first(q.auto) === "print" ? "print" : first(q.auto) === "pdf" ? "pdf" : null;
  const now = colomboNow();

  const rawFrom = first(q.from);
  const rawTo = first(q.to);
  const range = rawFrom !== undefined || rawTo !== undefined ? resolveRange(rawFrom, rawTo, now.date) : null;
  const isRange = range !== null && range.from !== range.to;

  if (isRange) {
    const b = await loadRangeBundle(range.from, range.to);
    const model = buildDocModel({ report: b.report, cancelled: b.cancelled, generated: now, generatedBy: b.generatedBy, byDay: b.byDay });
    return (
      <div className={sinhala.variable}>
        <DocumentView
          model={model}
          filename={`xenon-daily-summary-${b.from}_${b.to}.pdf`}
          backHref={`/daily-summary/range?from=${b.from}&to=${b.to}`}
          auto={auto}
          blocked={null}
        />
      </div>
    );
  }

  const b = await loadDayBundle(first(q.date) ?? range?.from);
  const read = await loadSavedDayAs(user, b.date, liveFromBundle(b));
  const filename = `xenon-daily-summary-${b.date}_${b.date}.pdf`;

  if (read.saved) {
    // A saved day is printed from what was saved, never from the live data.
    const sv = read.saved;
    const first1 = sv.log[0];
    const model = buildDocModel({
      report: sv.snapshot.report,
      cancelled: sv.snapshot.cancelled,
      generated: now,
      generatedBy: b.generatedBy,
      day: {
        staff: sv.snapshot.staff,
        bringForwardCents: sv.cash.bringForward,
        bank: sv.bank.map((l) => ({ cents: l.cents, time: l.time, slip: l.slip, note: l.note })),
        preparedBy: sv.preparedBy.name,
        checkedBy: sv.check?.checkedByName ?? null,
        saved: {
          version: sv.version,
          savedAtIso: first1.savedAt,
          savedBy: first1.doneByName,
          lastEditedAtIso: sv.version >= 2 ? sv.savedAt : null,
          lastEditedBy: sv.version >= 2 ? sv.doneBy.name : null,
          overBankedBy: sv.overBankedBy,
          log: sv.log,
        },
      },
    });
    return (
      <div className={sinhala.variable}>
        <DocumentView model={model} filename={filename} backHref={`/daily-summary?date=${b.date}`} auto={auto} blocked={null} />
      </div>
    );
  }

  // A draft: the live figures and what is typed in the address.
  const typed = parseTypedState(q, b.signers);
  if (typed.bringForwardInvalid || typed.bankLinesInvalid) {
    // Something in the address could not be used (a bring-forward that is not an amount, a junk or an 11th bank line). The document must
    // not print a quietly smaller number: back to the day screen, with a notice. What WAS valid comes back with the user.
    const back = typedQuery({ bringForwardCents: typed.bringForwardCents, bank: typed.bank });
    back.set("date", b.date);
    for (const key of noticeKeys(typed, undefined)) back.append("notice", key);
    redirect(`/daily-summary?${back.toString()}`);
  }
  const flow = computeCashFlow({
    bringForward: typed.bringForwardCents,
    collected: decimalToCents(b.report.totalCollected),
    deductions: decimalToCents(b.report.deductions.total),
    bank: typed.bank,
  });
  const blocked = flow.overdrawn ? "The money taken to the bank is more than the drawer should hold. Go back and correct it." : null;

  const model = buildDocModel({
    report: b.report,
    cancelled: b.cancelled,
    generated: now,
    generatedBy: b.generatedBy,
    day: { staff: b.staff, bringForwardCents: typed.bringForwardCents, bank: typed.bank, preparedBy: null, checkedBy: null },
  });
  const back = typedQuery({ bringForwardCents: typed.bringForwardCents, bank: typed.bank });
  back.set("date", b.date);

  return (
    <div className={sinhala.variable}>
      <DocumentView model={model} filename={filename} backHref={`/daily-summary?${back.toString()}`} auto={auto} blocked={blocked} />
    </div>
  );
}
