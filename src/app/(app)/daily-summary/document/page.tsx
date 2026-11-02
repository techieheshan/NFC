import { notFound, redirect } from "next/navigation";

import { requireNavAccess } from "@/lib/authz";
import { computeCashFlow } from "@/lib/cash-flow";
import { decimalToCents } from "@/lib/cents";
import { colomboNow } from "@/lib/colombo-time";
import { resolveRange } from "@/lib/daily-summary-dates";

import { loadDayBundle, loadRangeBundle } from "../bundle";
import { parseTypedState, typedQuery } from "../typed-state";
import { DocumentView } from "./document-view";
import { sinhala } from "./fonts";
import { buildDocModel } from "./model";

export const metadata = { title: "Daily Summary" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * The Daily Summary as paper: fixed A4 sheets (see `document-view.tsx`).
 *
 * A normal page route, like the payslip voucher — nothing is portalled, so there is nothing to unmount before the
 * print preview has composed the page (the receipt's old blank-preview bug). ADMIN and STAFF only (the same nav
 * guard as the Daily Summary itself); a TEACHER gets the not-found screen.
 *
 *   ?date=YYYY-MM-DD&bf=…&b=…&prep=…&chk=…   one day: needs both signatures, shows the cash book
 *   ?from=…&to=…                             several days: no cash book, no signatures
 *   &auto=print | pdf                        run that action as soon as the sheets are ready
 *
 * Everything in the URL is hostile input: dates are validated, amounts re-parsed as cents, and the signer ids
 * are only looked up in the lists the server offers — Checked by in the ADMIN-only list, so a staff id in `chk`
 * resolves to nobody and the document is not built.
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
  const typed = parseTypedState(q, b.signers);
  if (typed.bringForwardInvalid) {
    // An amount in the address that is not a real amount must not print as 0.00: back to the day screen, with a message.
    const back = typedQuery({ bringForwardCents: 0, bank: typed.bank, preparedId: typed.prepared?.id, checkedId: typed.checked?.id });
    back.set("date", b.date);
    back.set("notice", "bf");
    redirect(`/daily-summary?${back.toString()}`);
  }
  const flow = computeCashFlow({
    bringForward: typed.bringForwardCents,
    collected: decimalToCents(b.report.totalCollected),
    deductions: decimalToCents(b.report.deductions.total),
    bank: typed.bank,
  });
  const blocked = !typed.prepared || !typed.checked
    ? "Choose Prepared by and Checked by (an admin) first. Go back and choose them."
    : flow.overdrawn
      ? "The money taken to the bank is more than the drawer should hold. Go back and correct it."
      : null;

  const model = buildDocModel({
    report: b.report,
    cancelled: b.cancelled,
    generated: now,
    generatedBy: b.generatedBy,
    day: {
      staff: b.staff,
      bringForwardCents: typed.bringForwardCents,
      bank: typed.bank,
      preparedBy: typed.prepared?.name ?? null,
      checkedBy: typed.checked?.name ?? null,
    },
  });
  const back = typedQuery({
    bringForwardCents: typed.bringForwardCents,
    bank: typed.bank,
    preparedId: typed.prepared?.id,
    checkedId: typed.checked?.id,
  });
  back.set("date", b.date);

  return (
    <div className={sinhala.variable}>
      <DocumentView
        model={model}
        filename={`xenon-daily-summary-${b.date}_${b.date}.pdf`}
        backHref={`/daily-summary?${back.toString()}`}
        auto={auto}
        blocked={blocked}
      />
    </div>
  );
}
